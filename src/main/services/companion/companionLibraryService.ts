import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import type { Readable } from "stream";
import * as yauzl from "yauzl";
import db from "../../db/index.js";
import { naturalSort } from "../../utils/index.js";
import type {
  CompanionOperationResult,
  CompanionLibraryBook,
  CompanionLibraryImage,
  CompanionLibraryService,
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
}

export class DesktopLibraryService implements CompanionLibraryService {
  async deleteBook(bookId: number): Promise<CompanionOperationResult> {
    return handleDeleteBook(bookId);
  }

  async listBooks(): Promise<CompanionLibraryBook[]> {
    const books = (await db("Book")
      .select(
        "Book.*",
        db.raw("GROUP_CONCAT(DISTINCT Artist.name) as artists"),
        db.raw("GROUP_CONCAT(DISTINCT Tag.name) as tags"),
        db.raw("GROUP_CONCAT(DISTINCT Series.name) as series"),
        db.raw("GROUP_CONCAT(DISTINCT `Group`.name) as groups"),
        db.raw("GROUP_CONCAT(DISTINCT `Character`.name) as characters"),
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
      .groupBy("Book.id")
      .orderBy("Book.added_at", "desc")) as LibraryBookRow[];

    return books
      .filter((book) => book.sync_id)
      .map((book) => ({
        id: book.id,
        syncId: book.sync_id as string,
        title: book.title,
        pageCount: Math.max(0, book.page_count || 0),
        modifiedAt: getModifiedAt(book),
        currentPage: Math.max(0, book.current_page || 0),
        isFavorite: Boolean(book.is_favorite),
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
        coverUrl: `/v1/library/books/${book.id}/cover`,
      }));
  }

  async getPageCount(bookId: number): Promise<number | null> {
    const book = await db("Book")
      .select("page_count")
      .where("id", bookId)
      .first();
    return book ? Math.max(0, book.page_count || 0) : null;
  }

  async getCover(bookId: number): Promise<CompanionLibraryImage | null> {
    const book = await db("Book")
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
    const book = await db("Book").select("path").where("id", bookId).first();
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
