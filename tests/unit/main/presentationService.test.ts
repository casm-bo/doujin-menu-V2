import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Knex } from "knex";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import {
  createTestDb,
  seedBook,
  truncateAll,
} from "../../../src/main/db/test-utils.js";
import { DesktopPresentationService } from "../../../src/main/services/companion/presentationService.js";
import {
  parsePresentationMutation,
  type GalleryPresentation,
} from "../../../src/types/presentation.js";

const value = (key = "hitomi:123"): GalleryPresentation => ({
  key,
  title: "Edited",
  coverHash: null,
  webtoon: true,
  version: 0,
  revision: 0,
  metadata: {
    hitomiId: key.startsWith("hitomi:") ? key.slice(7) : null,
    artists: ["Some Artist"],
    groups: [],
    series: ["Original IP"],
    characters: [],
    tags: [],
    galleryType: "manga",
    language: "English",
    publishedDate: "2026-10-01",
  },
});

describe("presentation storage and transfer", () => {
  let db: Knex;
  let directory: string;
  let service: DesktopPresentationService;
  beforeAll(async () => {
    db = await createTestDb();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "presentation-test-"));
    service = new DesktopPresentationService(db, directory);
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("applies once, reports conflicts and preserves separate episode membership", async () => {
    const book = await seedBook(db, { hitomi_id: "123" });
    const edit = { mutationId: "first", baseVersion: 0, value: value() };
    const first = await service.apply("phone", edit);
    expect(first.status).toBe("applied");
    expect((await service.apply("phone", edit)).status).toBe("already_applied");
    await expect(
      service.apply("phone", {
        ...edit,
        value: { ...edit.value, title: "Different" },
      }),
    ).rejects.toThrow("reused");
    expect(
      (await service.apply("pc", { ...edit, mutationId: "other" })).status,
    ).toBe("conflict");
    const stored = await db("Book").where("id", book.id).first();
    expect(stored).toMatchObject({
      title: "Edited",
      custom_title: "Edited",
      published_date: "2026-10-01",
      series_collection_id: null,
    });
    expect(await db("Tag").pluck("name")).toEqual(["webtoon"]);
    expect(first.value.metadata.tags).toEqual([]);
    expect((await service.changes()).values).toHaveLength(1);
  });

  it("stores online edits before import, preserves them on rescan, and captures desktop edits", async () => {
    const first = await service.apply("phone", {
      mutationId: "online",
      baseVersion: 0,
      value: value(),
    });
    expect(await db("Book").count("id as n").first()).toMatchObject({ n: 0 });
    const book = await seedBook(db, { hitomi_id: "123", title: "Raw scan" });
    await db.transaction((trx) => service.preserveScannedBook(trx, book.id));
    expect((await db("Book").where("id", book.id).first()).title).toBe(
      "Edited",
    );
    await db.transaction(async (trx) => {
      await trx("Book").where("id", book.id).update({ title: "PC edit" });
      await service.captureDesktopEdit(book.id, trx);
    });
    const delta = await service.changes(first.value.revision, 1);
    expect(delta.values[0]).toMatchObject({
      title: "PC edit",
      version: 2,
      metadata: { tags: [] },
    });
    expect(delta.hasMore).toBe(false);
  });

  it("serializes simultaneous same-base edits and pages changes without losing edits", async () => {
    const results = await Promise.all(
      ["a", "b"].map((mutationId) =>
        service.apply(mutationId, {
          mutationId,
          baseVersion: 0,
          value: value(),
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    await service.apply("a", {
      mutationId: "second",
      baseVersion: 0,
      value: value("hitomi:456"),
    });
    const first = await service.changes(0, 1);
    expect(first.hasMore).toBe(true);
    expect((await service.changes(first.cursor, 1)).values[0].key).toBe(
      "hitomi:456",
    );
  });

  it("validates binary covers and keeps content-addressed files immutable", async () => {
    const bytes = await sharp({
      create: { width: 10, height: 20, channels: 3, background: "blue" },
    })
      .png()
      .toBuffer();
    const hash = createHash("sha256").update(bytes).digest("hex");
    await service.putCover(hash, bytes);
    await service.putCover(hash, bytes);
    expect((await service.getCover(hash))?.contentType).toBe("image/png");
    await expect(service.putCover("a".repeat(64), bytes)).rejects.toThrow();
    await expect(service.putCover("../escape", bytes)).rejects.toThrow();
    const invalid = Buffer.from("not an image");
    await expect(
      service.putCover(
        createHash("sha256").update(invalid).digest("hex"),
        invalid,
      ),
    ).rejects.toThrow();
    const edited = { ...value(), coverHash: hash };
    await service.apply("phone", {
      mutationId: "cover",
      baseVersion: 0,
      value: edited,
    });
    const book = await seedBook(db, { hitomi_id: "123" });
    await db.transaction((trx) => service.preserveScannedBook(trx, book.id));
    expect((await db("Book").where("id", book.id).first()).cover_path).toBe(
      path.join(directory, `${hash}.image`),
    );
  });

  it("rejects malformed identities and overlong fields while allowing explicit empty facets", () => {
    const valid = { mutationId: "valid", baseVersion: 0, value: value() };
    expect(parsePresentationMutation(valid)?.value.metadata.tags).toEqual([]);
    expect(parsePresentationMutation({ ...valid, baseVersion: -1 })).toBeNull();
    expect(
      parsePresentationMutation({
        ...valid,
        value: { ...valid.value, key: "sync:../../file" },
      }),
    ).toBeNull();
    expect(
      parsePresentationMutation({
        ...valid,
        value: { ...valid.value, title: "x".repeat(501) },
      }),
    ).toBeNull();
  });
});
