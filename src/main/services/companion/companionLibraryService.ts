import { createReadStream, createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { Transform, type Readable, type TransformCallback } from "stream";
import { pipeline } from "stream/promises";
import * as yauzl from "yauzl";
import type { Knex } from "knex";
import db from "../../db/index.js";
import { naturalSort } from "../../utils/index.js";
import type {
  CompanionOperationResult,
  CompanionLibraryBook,
  CompanionLibraryImage,
  CompanionLibraryPage,
  CompanionLibraryService,
  CompanionSeriesAssignment,
  CompanionSeriesAssignmentResult,
} from "./companionServer.js";
import { handleDeleteBook } from "../../handlers/bookHandler.js";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
]);
const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

interface LibraryBookRow {
  id: number;
  sync_id: string | null;
  title: string;
  path: string;
  page_count: number | null;
  added_at: string | null;
  file_mtime: number | null;
  current_page: number | null;
  is_favorite: number | boolean;
  is_read: number | boolean;
  is_hidden: number | boolean;
  custom_title: string | null;
  last_read_at: string | null;
  state_version: number | null;
  state_updated_at: string | null;
  hitomi_id: string | null;
  type: string | null;
  language_name_english: string | null;
  language_name_local: string | null;
  artists: string | null;
  groups: string | null;
  series: string | null;
  characters: string | null;
  tags: string | null;
  series_collection_name: string | null;
  series_order_index: number | null;
  series_state_updated_at: number | null;
  series_favorite: number | boolean | null;
}

export class DesktopLibraryService implements CompanionLibraryService {
  constructor(
    private readonly database: Knex = db,
    private readonly getDownloadPath: () => string = () => "",
  ) {}

  async saveSeriesAssignments(
    assignments: CompanionSeriesAssignment[],
  ): Promise<
    CompanionOperationResult<{
      updated: number;
      results: CompanionSeriesAssignmentResult[];
    }>
  > {
    const results = await this.database.transaction(async (trx) => {
      const items: CompanionSeriesAssignmentResult[] = [];
      for (const assignment of assignments) {
        const book = await trx("Book")
          .select(
            "Book.id",
            "Book.state_version",
            "Book.series_order_index",
            "Book.series_state_updated_at",
            "SeriesCollection.name as series_name",
          )
          .leftJoin(
            "SeriesCollection",
            "Book.series_collection_id",
            "SeriesCollection.id",
          )
          .where("sync_id", assignment.bookSyncId)
          .first();
        if (!book) {
          items.push({
            mutationId: assignment.mutationId ?? null,
            bookSyncId: assignment.bookSyncId,
            status: "not_found",
          });
          continue;
        }

        const currentName = book.series_name ?? null;
        const currentOrder = Math.max(0, (book.series_order_index || 1) - 1);
        const version = Number(book.state_version || 0);
        const currentModifiedAt = Number(book.series_state_updated_at || 0);
        const requestedName = assignment.name?.trim() || null;
        if (currentName === requestedName && currentOrder === assignment.order) {
          items.push({
            mutationId: assignment.mutationId ?? null,
            bookSyncId: assignment.bookSyncId,
            status: "already_applied",
            version,
            modifiedAt: currentModifiedAt,
            name: currentName,
            order: currentOrder,
          });
          continue;
        }
        if (
          assignment.baseVersion === undefined &&
          assignment.modifiedAt !== undefined &&
          assignment.modifiedAt <= currentModifiedAt
        ) {
          items.push({
            mutationId: assignment.mutationId ?? null,
            bookSyncId: assignment.bookSyncId,
            status: "conflict",
            version,
            modifiedAt: currentModifiedAt,
            name: currentName,
            order: currentOrder,
          });
          continue;
        }
        if (
          assignment.baseVersion !== undefined &&
          assignment.baseVersion !== version
        ) {
          items.push({
            mutationId: assignment.mutationId ?? null,
            bookSyncId: assignment.bookSyncId,
            status: "conflict",
            version,
            modifiedAt: currentModifiedAt,
            name: currentName,
            order: currentOrder,
          });
          continue;
        }

        const nextVersion = version + 1;
        const now = new Date().toISOString();
        const stateModifiedAt =
          assignment.baseVersion === undefined && assignment.modifiedAt !== undefined
            ? assignment.modifiedAt
            : Date.now();

        if (!requestedName) {
          await trx("Book").where("sync_id", assignment.bookSyncId).update({
            series_collection_id: null,
            series_order_index: null,
            series_state_updated_at: stateModifiedAt,
            state_version: nextVersion,
            state_updated_at: now,
          });
        } else {
          let series = await trx("SeriesCollection")
            .select("id")
            .where("name", requestedName)
            .first();
          if (!series) {
            const [id] = await trx("SeriesCollection").insert({
              name: requestedName,
              is_auto_generated: false,
              is_manually_edited: true,
              confidence_score: 1.0,
              created_at: trx.fn.now(),
              updated_at: trx.fn.now(),
            });
            series = { id };
          }
          await trx("Book")
            .where("sync_id", assignment.bookSyncId)
            .update({
              series_collection_id: series.id,
              series_order_index: assignment.order + 1,
              series_state_updated_at: stateModifiedAt,
              state_version: nextVersion,
              state_updated_at: now,
            });
        }
        items.push({
          mutationId: assignment.mutationId ?? null,
          bookSyncId: assignment.bookSyncId,
          status: "applied",
          version: nextVersion,
          modifiedAt: stateModifiedAt,
          name: requestedName,
          order: assignment.order,
        });
      }
      return items;
    });
    return {
      success: true,
      data: {
        updated: results.filter((item) => item.status === "applied").length,
        results,
      },
    };
  }

  async importBook({
    stream,
    fileName,
    syncId,
    contentLength,
  }: {
    stream: Readable;
    fileName: string;
    syncId: string;
    contentLength?: number;
  }): Promise<
    CompanionOperationResult<{
      status: "imported" | "already_exists";
      id: number;
      syncId: string;
      path: string;
    }>
  > {
    const existing = await this.database("Book")
      .select("id", "path", "sync_id")
      .where("sync_id", syncId)
      .first();
    if (existing) {
      stream.resume();
      return {
        success: true,
        data: {
          status: "already_exists",
          id: existing.id,
          syncId: existing.sync_id,
          path: existing.path,
        },
      };
    }

    const downloadPath = this.getDownloadPath().trim();
    if (!downloadPath) {
      stream.resume();
      return { success: false, error: "Desktop download path is not configured" };
    }
    if (contentLength !== undefined && contentLength > MAX_IMPORT_BYTES) {
      stream.resume();
      return { success: false, error: "Uploaded archive is too large" };
    }

    await fs.mkdir(downloadPath, { recursive: true });
    const safeName = sanitizeArchiveName(fileName);
    const finalPath = await availableArchivePath(downloadPath, safeName);
    const temporaryPath = path.join(downloadPath, `.${randomUUID()}.upload`);
    try {
      await pipeline(
        stream,
        new ByteLimitTransform(MAX_IMPORT_BYTES),
        createWriteStream(temporaryPath, { flags: "wx" }),
      );
      const stat = await fs.stat(temporaryPath);
      if (stat.size <= 0 || stat.size > MAX_IMPORT_BYTES) {
        throw new Error("Uploaded archive has an invalid size");
      }
      await validateArchive(temporaryPath);
      await fs.rename(temporaryPath, finalPath);
      const { scanFile } = await import("../../handlers/directoryHandler.js");
      await scanFile(finalPath);
      const imported = await this.database("Book")
        .select("id", "path", "sync_id")
        .where("path", finalPath)
        .first();
      if (!imported) throw new Error("Imported archive could not be registered");
      return {
        success: true,
        data: {
          status: "imported",
          id: imported.id,
          syncId: imported.sync_id || syncId,
          path: imported.path,
        },
      };
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      await fs.rm(finalPath, { force: true }).catch(() => undefined);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deleteBook(bookId: number): Promise<CompanionOperationResult> {
    return handleDeleteBook(bookId);
  }

  async listBooks(): Promise<CompanionLibraryBook[]>;
  async listBooks(
    cursor: number | undefined,
    requestedLimit: number | undefined,
  ): Promise<CompanionLibraryPage>;
  async listBooks(
    cursor?: number,
    requestedLimit?: number,
  ): Promise<CompanionLibraryBook[] | CompanionLibraryPage> {
    const paginated = cursor !== undefined || requestedLimit !== undefined;
    const limit = Math.min(Math.max(requestedLimit ?? 200, 1), 500);
    const books = (await this.database("Book")
      .select(
        "Book.*",
        this.database.raw("GROUP_CONCAT(DISTINCT Artist.name) as artists"),
        this.database.raw("GROUP_CONCAT(DISTINCT Tag.name) as tags"),
        this.database.raw("GROUP_CONCAT(DISTINCT Series.name) as series"),
        this.database.raw("GROUP_CONCAT(DISTINCT `Group`.name) as groups"),
        this.database.raw(
          "GROUP_CONCAT(DISTINCT `Character`.name) as characters",
        ),
        "SeriesCollection.name as series_collection_name",
        "SeriesCollection.is_favorite as series_favorite",
        "Book.series_order_index",
        "Book.series_state_updated_at",
      )
      .leftJoin("BookArtist", "Book.id", "BookArtist.book_id")
      .leftJoin("Artist", "BookArtist.artist_id", "Artist.id")
      .leftJoin("BookTag", "Book.id", "BookTag.book_id")
      .leftJoin("Tag", "BookTag.tag_id", "Tag.id")
      .leftJoin("BookSeries", "Book.id", "BookSeries.book_id")
      .leftJoin("Series", "BookSeries.series_id", "Series.id")
      .leftJoin("BookGroup", "Book.id", "BookGroup.book_id")
      .leftJoin("Group", "BookGroup.group_id", "Group.id")
      .leftJoin("BookCharacter", "Book.id", "BookCharacter.book_id")
      .leftJoin("Character", "BookCharacter.character_id", "Character.id")
      .leftJoin(
        "SeriesCollection",
        "Book.series_collection_id",
        "SeriesCollection.id",
      )
      .modify((query) => {
        if (cursor !== undefined) query.where("Book.id", "<", cursor);
      })
      .groupBy("Book.id")
      .orderBy("Book.id", "desc")
      .modify((query) => {
        if (paginated) query.limit(limit + 1);
      })) as LibraryBookRow[];

    const hasMore = books.length > limit;
    const page = hasMore ? books.slice(0, limit) : books;
    const mapped = page
      .filter((book) => book.sync_id)
      .map((book) => ({
        id: book.id,
        syncId: book.sync_id as string,
        title: book.title,
        pageCount: Math.max(0, book.page_count || 0),
        modifiedAt: getModifiedAt(book),
        currentPage: Math.max(0, book.current_page || 0),
        isFavorite: Boolean(book.is_favorite),
        isRead: Boolean(book.is_read),
        isHidden: Boolean(book.is_hidden),
        customTitle: book.custom_title ?? null,
        seriesFavorite: Boolean(book.series_favorite),
        lastReadAt: book.last_read_at ?? null,
        stateVersion: Math.max(0, book.state_version || 0),
        stateUpdatedAt: book.state_updated_at ?? null,
        hitomiId: book.hitomi_id ?? null,
        type: book.type ?? null,
        language:
          book.language_name_local ?? book.language_name_english ?? null,
        artists: metadataNames(book.artists),
        groups: metadataNames(book.groups),
        series: metadataNames(book.series),
        characters: metadataNames(book.characters),
        tags: metadataNames(book.tags),
        seriesCollection: {
          name: book.series_collection_name ?? null,
          order: Math.max(0, (book.series_order_index || 1) - 1),
          modifiedAt: Number(book.series_state_updated_at || 0),
        },
        coverUrl: `/v1/library/books/${book.id}/cover`,
      }));
    if (!paginated) return mapped;
    return {
      books: mapped,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      hasMore,
    };
  }

  async getPageCount(bookId: number): Promise<number | null> {
    const book = await this.database("Book")
      .select("page_count")
      .where("id", bookId)
      .first();
    return book ? Math.max(0, book.page_count || 0) : null;
  }

  async getCover(bookId: number): Promise<CompanionLibraryImage | null> {
    const book = await this.database("Book")
      .select("path", "cover_path")
      .where("id", bookId)
      .first();
    if (!book) return null;

    if (book.cover_path) {
      const cover = await imageFile(book.cover_path);
      if (cover) return cover;
    }
    return this.getPage(bookId, 0);
  }

  async getPage(
    bookId: number,
    pageIndex: number,
  ): Promise<CompanionLibraryImage | null> {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return null;
    const book = await this.database("Book")
      .select("path")
      .where("id", bookId)
      .first();
    if (!book?.path) return null;

    const stat = await fs.stat(book.path).catch(() => null);
    if (!stat) return null;
    if (stat.isDirectory()) {
      const files = (await fs.readdir(book.path))
        .filter((file) =>
          IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()),
        )
        .sort(naturalSort);
      const file = files[pageIndex];
      return file ? imageFile(path.join(book.path, file)) : null;
    }
    if (stat.isFile() && /\.(cbz|zip)$/i.test(book.path)) {
      return imageFromArchive(book.path, pageIndex);
    }
    return null;
  }
}

function getModifiedAt(book: LibraryBookRow): number {
  const cachedMtime = Number(book.file_mtime);
  if (Number.isFinite(cachedMtime) && cachedMtime > 0) return cachedMtime;
  const addedAt = Date.parse(book.added_at || "");
  return Number.isFinite(addedAt) ? addedAt : 0;
}

function metadataNames(value: string | null): { name: string }[] {
  return value ? value.split(",").map((name) => ({ name })) : [];
}

async function imageFile(
  filePath: string,
): Promise<CompanionLibraryImage | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return null;
  return {
    stream: createReadStream(filePath),
    contentType: getImageContentType(filePath),
    contentLength: stat.size,
  };
}

async function imageFromArchive(
  archivePath: string,
  pageIndex: number,
): Promise<CompanionLibraryImage | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      { lazyEntries: true, autoClose: false },
      (openError, zipFile) => {
        if (openError || !zipFile) {
          reject(openError || new Error("Failed to open archive"));
          return;
        }

        const entries: yauzl.Entry[] = [];
        zipFile.on("entry", (entry) => {
          if (
            !entry.fileName.endsWith("/") &&
            IMAGE_EXTENSIONS.has(path.extname(entry.fileName).toLowerCase())
          ) {
            entries.push(entry);
          }
          zipFile.readEntry();
        });
        zipFile.once("error", reject);
        zipFile.once("end", () => {
          entries.sort((a, b) => naturalSort(a.fileName, b.fileName));
          const entry = entries[pageIndex];
          if (!entry) {
            zipFile.close();
            resolve(null);
            return;
          }
          zipFile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              zipFile.close();
              reject(streamError || new Error("Failed to read archive entry"));
              return;
            }
            stream.once("end", () => zipFile.close());
            stream.once("error", () => zipFile.close());
            resolve({
              stream: stream as Readable,
              contentType: getImageContentType(entry.fileName),
              contentLength: entry.uncompressedSize,
            });
          });
        });
        zipFile.readEntry();
      },
    );
  });
}

function getImageContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    case ".avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function sanitizeArchiveName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase() === ".zip" ? ".zip" : ".cbz";
  const stem = path
    .basename(fileName, path.extname(fileName))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 160);
  return `${stem || "android-import"}${extension}`;
}

async function availableArchivePath(directory: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let suffix = 0; suffix < 10_000; suffix++) {
    const candidate = path.join(
      directory,
      suffix === 0 ? fileName : `${stem} (${suffix})${extension}`,
    );
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not allocate an import file name");
}

async function validateArchive(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) {
        reject(error || new Error("Invalid ZIP/CBZ archive"));
        return;
      }
      let hasImage = false;
      archive.once("error", reject);
      archive.on("entry", (entry) => {
        if (IMAGE_EXTENSIONS.has(path.extname(entry.fileName).toLowerCase())) {
          hasImage = true;
        }
        archive.readEntry();
      });
      archive.once("end", () => {
        archive.close();
        if (hasImage) resolve();
        else reject(new Error("Archive does not contain a supported image"));
      });
      archive.readEntry();
    });
  });
}

class ByteLimitTransform extends Transform {
  private received = 0;

  constructor(private readonly maximum: number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.received += chunk.length;
    if (this.received > this.maximum) {
      callback(new Error("Uploaded archive is too large"));
      return;
    }
    callback(null, chunk);
  }
}
