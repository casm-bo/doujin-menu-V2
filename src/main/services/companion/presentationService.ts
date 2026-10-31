import { createHash, randomUUID } from "crypto";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import type { Knex } from "knex";
import {
  COVER_HASH,
  type GalleryPresentation,
  type PresentationChanges,
  type PresentationMutation,
  type PresentationMutationResult,
} from "../../../types/presentation.js";
import type { CompanionLibraryImage } from "./companionServer.js";
import { normalizeArtistName } from "../../utils/artistName.js";
import { normalizeTagName } from "../../utils/tagName.js";
import { notifyCompanionLibraryChanged } from "./companionSyncSignal.js";

export const seriesPresentationKey = (name: string) =>
  `sync:series_${digest(name)}`;
export const seriesCoverPresentationKey = (name: string) =>
  `sync:series_cover_${digest(name)}`;

interface Row {
  resource_key: string;
  payload: string;
  version: number;
  revision: number;
}
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
export const isPresentationCoverPath = (value: string) =>
  path.basename(path.dirname(value)) === "presentation-covers" &&
  /^[a-f0-9]{64}\.image$/.test(path.basename(value));

export class DesktopPresentationService {
  constructor(
    private readonly database: Knex,
    private readonly coverDirectory: string,
  ) {}

  async get(key: string): Promise<GalleryPresentation | null> {
    const row = await this.database<Row>("GalleryPresentation")
      .where("resource_key", key)
      .first();
    return row ? JSON.parse(row.payload) : null;
  }

  async getSeries(name: string) {
    const presentation = await this.get(seriesPresentationKey(name));
    const cover =
      (await this.get(seriesCoverPresentationKey(name))) ?? presentation;
    return {
      presentation,
      presentation_key: seriesPresentationKey(name),
      display_title: presentation?.title,
      coverPath: cover?.coverHash ? this.coverFile(cover.coverHash) : null,
    };
  }

  async changes(after = 0, limit = 200): Promise<PresentationChanges> {
    const rows = await this.database<Row>("GalleryPresentation")
      .where("revision", ">", after)
      .orderBy("revision")
      .limit(Math.min(limit, 200) + 1);
    const hasMore = rows.length > Math.min(limit, 200);
    const page = hasMore ? rows.slice(0, -1) : rows;
    return {
      values: page.map((row) => JSON.parse(row.payload) as GalleryPresentation),
      cursor: page.at(-1)?.revision ?? after,
      hasMore,
    };
  }

  async apply(
    deviceId: string,
    mutation: PresentationMutation,
  ): Promise<PresentationMutationResult> {
    if (
      mutation.value.coverHash &&
      !(await this.hasCover(mutation.value.coverHash))
    )
      throw new Error("Upload the cover before saving metadata");
    const requestHash = digest(JSON.stringify(mutation));
    const result = await this.database.transaction<PresentationMutationResult>(
      async (trx) => {
        const receipt = await trx("PresentationMutation")
          .where({ device_id: deviceId, mutation_id: mutation.mutationId })
          .first();
        if (receipt) {
          if (receipt.request_hash !== requestHash)
            throw new Error("Mutation ID was reused for a different edit");
          const result = JSON.parse(
            receipt.result,
          ) as PresentationMutationResult;
          return {
            ...result,
            status:
              result.status === "applied" ? "already_applied" : result.status,
          };
        }
        const previous = await trx<Row>("GalleryPresentation")
          .where("resource_key", mutation.value.key)
          .first();
        if ((previous?.version ?? 0) !== mutation.baseVersion) {
          if (!previous) throw new Error("Unknown metadata version");
          return {
            status: "conflict",
            value: JSON.parse(previous.payload) as GalleryPresentation,
          };
        }
        const value = await this.write(
          trx,
          mutation.value,
          (previous?.version ?? 0) + 1,
        );
        await this.applyToBooks(trx, value);
        const result: PresentationMutationResult = { status: "applied", value };
        await trx("PresentationMutation").insert({
          device_id: deviceId,
          mutation_id: mutation.mutationId,
          request_hash: requestHash,
          result: JSON.stringify(result),
        });
        return result;
      },
    );
    if (result.status === "applied")
      notifyCompanionLibraryChanged(true, result.value.key);
    return result;
  }

  async applyToBooks(
    trx: Knex.Transaction,
    value: GalleryPresentation,
  ): Promise<void> {
    if (value.key.startsWith("sync:series_")) return;
    const books = value.key.startsWith("hitomi:")
      ? await trx("Book").where("hitomi_id", value.key.slice(7)).select("id")
      : await trx("Book").where("sync_id", value.key.slice(5)).select("id");
    for (const book of books) await this.applyToBook(trx, book.id, value, true);
  }

  async applyToBook(
    trx: Knex.Transaction,
    bookId: number,
    value: GalleryPresentation,
    touchState = false,
  ): Promise<void> {
    await trx("Book")
      .where("id", bookId)
      .update({
        title: value.title,
        custom_title: value.title,
        type: value.metadata.galleryType,
        language_name_local: value.metadata.language,
        published_date: value.metadata.publishedDate,
        ...(touchState
          ? {
              state_version: trx.raw("coalesce(state_version, 0) + 1"),
              state_updated_at: trx.fn.now(),
              updated_by_device_id: "metadata",
            }
          : {}),
        ...(value.coverHash
          ? { cover_path: this.coverFile(value.coverHash) }
          : {}),
      });
    const relations = [
      ["Artist", "BookArtist", "artist_id", value.metadata.artists],
      ["Tag", "BookTag", "tag_id", value.metadata.tags],
      ["Series", "BookSeries", "series_id", value.metadata.series],
      ["Group", "BookGroup", "group_id", value.metadata.groups],
      ["Character", "BookCharacter", "character_id", value.metadata.characters],
    ] as const;
    for (const [entity, junction, foreignKey, values] of relations) {
      await trx(junction).where("book_id", bookId).delete();
      const names =
        entity === "Tag" && value.webtoon === true
          ? [...new Set([...values, "webtoon"])]
          : values;
      for (const name of names) {
        let row = await trx(entity).where("name", name).first();
        if (!row) {
          const [id] = await trx(entity).insert({ name });
          row = { id };
        }
        await trx(junction).insert({ book_id: bookId, [foreignKey]: row.id });
      }
    }
  }

  async preserveScannedBook(
    trx: Knex.Transaction,
    bookId: number,
  ): Promise<void> {
    const book = await trx("Book")
      .where("id", bookId)
      .select("hitomi_id", "sync_id")
      .first();
    if (!book) return;
    const key = book.hitomi_id
      ? `hitomi:${book.hitomi_id}`
      : `sync:${book.sync_id}`;
    const saved = await trx<Row>("GalleryPresentation")
      .where("resource_key", key)
      .first();
    if (saved)
      await this.applyToBook(
        trx,
        bookId,
        JSON.parse(saved.payload) as GalleryPresentation,
      );
  }

  async captureDesktopEdit(
    bookId: number,
    transaction?: Knex.Transaction,
  ): Promise<void> {
    const capture = async (trx: Knex.Transaction) => {
      const book = await trx("Book").where("id", bookId).first();
      if (!book || (!book.hitomi_id && !book.sync_id)) return;
      const key = book.hitomi_id
        ? `hitomi:${book.hitomi_id}`
        : `sync:${book.sync_id}`;
      const previous = await trx<Row>("GalleryPresentation")
        .where("resource_key", key)
        .first();
      const old = previous
        ? (JSON.parse(previous.payload) as GalleryPresentation)
        : null;
      async function names(
        entity: string,
        junction: string,
        foreignKey: string,
      ): Promise<string[]> {
        const rows = await trx(junction)
          .join(entity, `${junction}.${foreignKey}`, `${entity}.id`)
          .where(`${junction}.book_id`, bookId)
          .select(`${entity}.name`)
          .orderBy(`${entity}.name`);
        return rows.map((row) => row.name as string);
      }
      let tags = await names("Tag", "BookTag", "tag_id");
      if (old?.webtoon && !old.metadata.tags.includes("webtoon"))
        tags = tags.filter((tag) => tag !== "webtoon");
      await this.write(
        trx,
        {
          key,
          title: book.custom_title || book.title,
          coverHash: old?.coverHash ?? null,
          webtoon: old?.webtoon ?? null,
          version: previous?.version ?? 0,
          revision: 0,
          metadata: {
            hitomiId: book.hitomi_id ?? null,
            artists: await names("Artist", "BookArtist", "artist_id"),
            groups: await names("Group", "BookGroup", "group_id"),
            series: await names("Series", "BookSeries", "series_id"),
            characters: await names(
              "Character",
              "BookCharacter",
              "character_id",
            ),
            tags,
            galleryType: book.type ?? null,
            language:
              book.language_name_local ?? book.language_name_english ?? null,
            publishedDate: book.published_date ?? null,
          },
        },
        (previous?.version ?? 0) + 1,
      );
    };
    if (transaction) await capture(transaction);
    else await this.database.transaction(capture);
  }

  private async write(
    trx: Knex.Transaction,
    input: GalleryPresentation,
    version: number,
  ): Promise<GalleryPresentation> {
    const row = await trx("GalleryPresentation")
      .max("revision as maximum")
      .first();
    const value = {
      ...input,
      metadata: {
        ...input.metadata,
        artists: [...new Set(input.metadata.artists.map(normalizeArtistName))],
        tags: [...new Set(input.metadata.tags.map(normalizeTagName))],
      },
      version,
      revision: Number(row?.maximum ?? 0) + 1,
    };
    await trx("GalleryPresentation")
      .insert({
        resource_key: value.key,
        payload: JSON.stringify(value),
        version,
        revision: value.revision,
      })
      .onConflict("resource_key")
      .merge();
    return value;
  }

  private coverFile(hash: string): string {
    if (!this.coverDirectory || !COVER_HASH.test(hash))
      throw new Error("Invalid cover identity");
    return path.join(this.coverDirectory, `${hash}.image`);
  }
  async hasCover(hash: string): Promise<boolean> {
    return fs.stat(this.coverFile(hash)).then(
      (info) => info.isFile(),
      () => false,
    );
  }
  async changeCover(key: string, title: string, source: Buffer) {
    const current = await this.get(key);
    if (!current && !key.startsWith("sync:series_cover_"))
      throw new Error("작품 정보를 찾을 수 없습니다.");
    const bytes = await sharp(source, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({
        width: 1600,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();
    const hash = digest(bytes);
    await this.putCover(hash, bytes);
    return this.apply("desktop", {
      mutationId: randomUUID(),
      baseVersion: current?.version ?? 0,
      value: {
        ...(current ?? {
          key,
          title,
          webtoon: null,
          version: 0,
          revision: 0,
          metadata: {
            hitomiId: null,
            artists: [],
            groups: [],
            series: [],
            characters: [],
            tags: [],
            galleryType: null,
            language: null,
            publishedDate: null,
          },
        }),
        coverHash: hash,
      },
    });
  }
  async putCover(hash: string, bytes: Buffer): Promise<void> {
    const target = this.coverFile(hash);
    if (
      bytes.length === 0 ||
      bytes.length > 5 * 1024 * 1024 ||
      digest(bytes) !== hash
    )
      throw new Error("Invalid cover content hash or size");
    const info = await sharp(bytes, { limitInputPixels: 4_194_304 }).metadata();
    if (
      !["jpeg", "png", "webp"].includes(info.format ?? "") ||
      !info.width ||
      !info.height ||
      info.width > 2048 ||
      info.height > 4096
    )
      throw new Error("Invalid cover image");
    await sharp(bytes, { limitInputPixels: 4_194_304 })
      .resize(1, 1)
      .raw()
      .toBuffer();
    await fs.mkdir(this.coverDirectory, { recursive: true });
    if (await this.hasCover(hash)) return;
    const temporary = `${target}.${randomUUID()}.part`;
    try {
      await fs.writeFile(temporary, bytes, { flag: "wx" });
      await fs.rename(temporary, target).catch(async (error) => {
        if (!(await this.hasCover(hash))) throw error;
      });
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }
  async getCover(hash: string): Promise<CompanionLibraryImage | null> {
    if (!COVER_HASH.test(hash) || !(await this.hasCover(hash))) return null;
    const source = this.coverFile(hash);
    const info = await sharp(source).metadata();
    return {
      stream: createReadStream(source),
      contentType: `image/${info.format === "jpeg" ? "jpeg" : info.format}`,
      contentLength: (await fs.stat(source)).size,
    };
  }
}
