import { randomUUID } from "crypto";
import type { Knex } from "knex";
import type {
  CompanionSyncBookState,
  CompanionSyncChange,
  CompanionSyncHistoryEvent,
  CompanionSyncMutation,
  CompanionSyncMutationResult,
} from "../../../types/companion.js";

const MAX_BOOTSTRAP_HISTORY = 500;
const DEFAULT_CHANGE_LIMIT = 200;
const MAX_CHANGE_LIMIT = 500;

interface SyncBookRow {
  id: number;
  sync_id: string;
  page_count: number | null;
  current_page: number | null;
  is_favorite: number | boolean;
  is_read: number | boolean;
  is_hidden: number | boolean;
  custom_title: string | null;
  series_collection_id: number | null;
  series_favorite: number | boolean | null;
  last_read_at: string | null;
  state_version: number | null;
  state_updated_at: string | null;
}

interface SyncChangeRow {
  cursor: number;
  book_sync_id: string;
  state_version: number;
  current_page: number | null;
  is_favorite: number | boolean;
  last_read_at: string | null;
  changed_at: string;
  device_id: string;
  changed_fields: string;
  history_event_id: string | null;
  history_viewed_at: string | null;
  history_current_page: number | null;
  state_payload: string | null;
}

export interface CompanionSyncBootstrap {
  cursor: number;
  serverTime: string;
  books: CompanionSyncBookState[];
  history: CompanionSyncHistoryEvent[];
}

export interface CompanionSyncChangesResult {
  cursor: number;
  hasMore: boolean;
  changes: CompanionSyncChange[];
}

export interface CompanionSyncApplyResult {
  cursor: number;
  serverTime: string;
  results: CompanionSyncMutationResult[];
}

export interface DesktopBookChange {
  currentPage?: number;
  isFavorite?: boolean;
  addHistory?: boolean;
}

export class DesktopCompanionSyncService {
  constructor(private readonly database: Knex) {}

  async bootstrap(): Promise<CompanionSyncBootstrap> {
    return this.database.transaction(async (trx) => {
      const books = (await trx("Book").select(
        "id",
        "sync_id",
        "page_count",
        "current_page",
        "is_favorite",
        "is_read",
        "is_hidden",
        "custom_title",
        "series_collection_id",
        this.database.raw(
          "coalesce((select is_favorite from SeriesCollection where id = Book.series_collection_id), 0) as series_favorite",
        ),
        "last_read_at",
        "state_version",
        "state_updated_at",
      )) as SyncBookRow[];
      const history = await trx("BookHistory")
        .select(
          "BookHistory.event_id",
          "BookHistory.viewed_at",
          "BookHistory.current_page",
          "BookHistory.device_id",
          "Book.sync_id as book_sync_id",
        )
        .join("Book", "BookHistory.book_id", "Book.id")
        .whereNotNull("BookHistory.event_id")
        .orderBy("BookHistory.viewed_at", "desc")
        .limit(MAX_BOOTSTRAP_HISTORY);
      const cursor = await this.getLatestCursor(trx);

      return {
        cursor,
        serverTime: new Date().toISOString(),
        books: books.filter((book) => book.sync_id).map(toBookState),
        history: history.map((row) => ({
          eventId: row.event_id,
          bookSyncId: row.book_sync_id,
          viewedAt: toIsoString(row.viewed_at),
          currentPage: nullableNumber(row.current_page),
          deviceId: row.device_id || "desktop",
        })),
      };
    });
  }

  async getChanges(
    afterCursor: number,
    requestedLimit = DEFAULT_CHANGE_LIMIT,
  ): Promise<CompanionSyncChangesResult> {
    const limit = Math.min(Math.max(requestedLimit, 1), MAX_CHANGE_LIMIT);
    const rows = (await this.database("CompanionSyncChange")
      .select("*")
      .where("cursor", ">", afterCursor)
      .orderBy("cursor", "asc")
      .limit(limit + 1)) as SyncChangeRow[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      cursor: page.at(-1)?.cursor ?? afterCursor,
      hasMore,
      changes: page.map(toSyncChange),
    };
  }

  async applyMutations(
    deviceId: string,
    mutations: CompanionSyncMutation[],
  ): Promise<CompanionSyncApplyResult> {
    const results = await this.database.transaction(async (trx) => {
      const applied: CompanionSyncMutationResult[] = [];
      for (const mutation of mutations) {
        applied.push(await this.applyMutation(trx, deviceId, mutation));
      }
      return applied;
    });

    return {
      cursor: await this.getLatestCursor(),
      serverTime: new Date().toISOString(),
      results,
    };
  }

  async applyDesktopChange(
    bookId: number,
    change: DesktopBookChange,
  ): Promise<CompanionSyncMutationResult> {
    const book = (await this.database("Book")
      .select("sync_id", "state_version")
      .where("id", bookId)
      .first()) as Pick<SyncBookRow, "sync_id" | "state_version"> | undefined;
    if (!book?.sync_id) {
      return {
        mutationId: "",
        status: "not_found",
        conflict: false,
      };
    }

    const now = new Date().toISOString();
    const mutation: CompanionSyncMutation = {
      mutationId: randomUUID(),
      bookSyncId: book.sync_id,
      baseVersion: Number(book.state_version || 0),
      currentPage: change.currentPage,
      isFavorite: change.isFavorite,
      historyEvent: change.addHistory
        ? {
            eventId: randomUUID(),
            viewedAt: now,
            currentPage: change.currentPage,
          }
        : undefined,
    };
    const result = await this.applyMutations("desktop", [mutation]);
    return result.results[0];
  }

  private async applyMutation(
    trx: Knex.Transaction,
    deviceId: string,
    mutation: CompanionSyncMutation,
  ): Promise<CompanionSyncMutationResult> {
    const existing = await trx("CompanionSyncChange")
      .select("book_id")
      .where("mutation_id", mutation.mutationId)
      .first();
    if (existing) {
      const existingBook = (await trx("Book")
        .select(
          "id",
          "sync_id",
          "page_count",
          "current_page",
          "is_favorite",
          "is_read",
          "is_hidden",
          "custom_title",
          "series_collection_id",
          trx.raw(
            "coalesce((select is_favorite from SeriesCollection where id = Book.series_collection_id), 0) as series_favorite",
          ),
          "last_read_at",
          "state_version",
          "state_updated_at",
        )
        .where("id", existing.book_id)
        .first()) as SyncBookRow | undefined;
      return {
        mutationId: mutation.mutationId,
        status: "duplicate",
        conflict: false,
        state: existingBook ? toBookState(existingBook) : undefined,
      };
    }

    const book = (await trx("Book")
      .select(
        "id",
        "sync_id",
        "page_count",
        "current_page",
        "is_favorite",
        "is_read",
        "is_hidden",
        "custom_title",
        "series_collection_id",
        trx.raw(
          "coalesce((select is_favorite from SeriesCollection where id = Book.series_collection_id), 0) as series_favorite",
        ),
        "last_read_at",
        "state_version",
        "state_updated_at",
      )
      .where("sync_id", mutation.bookSyncId)
      .first()) as SyncBookRow | undefined;
    if (!book) {
      return {
        mutationId: mutation.mutationId,
        status: "not_found",
        conflict: false,
      };
    }

    const versionConflict =
      mutation.baseVersion !== undefined &&
      mutation.baseVersion !== Number(book.state_version || 0);
    const currentModifiedAt = book.state_updated_at
      ? Date.parse(book.state_updated_at)
      : 0;
    if (
      mutation.modifiedAt !== undefined &&
      mutation.modifiedAt <= currentModifiedAt
    ) {
      return {
        mutationId: mutation.mutationId,
        status: "conflict",
        conflict: true,
        state: toBookState(book),
      };
    }
    const now =
      mutation.modifiedAt === undefined
        ? new Date().toISOString()
        : new Date(mutation.modifiedAt).toISOString();
    const changedFields: CompanionSyncChange["changedFields"] = [];
    const update: Record<string, unknown> = {
      state_version: Number(book.state_version || 0) + 1,
      state_updated_at: now,
      updated_by_device_id: deviceId,
    };

    if (mutation.currentPage !== undefined) {
      update.current_page = clampPage(mutation.currentPage, book.page_count);
      update.last_read_at = now;
      changedFields.push("currentPage");
    }
    if (mutation.isFavorite !== undefined) {
      update.is_favorite = mutation.isFavorite;
      changedFields.push("isFavorite");
    }
    if (mutation.isRead !== undefined) {
      update.is_read = mutation.isRead;
      changedFields.push("isRead");
    }
    if (mutation.isHidden !== undefined) {
      update.is_hidden = mutation.isHidden;
      changedFields.push("isHidden");
    }
    if (mutation.customTitle !== undefined) {
      update.custom_title = mutation.customTitle?.trim() || null;
      changedFields.push("customTitle");
    }
    if (mutation.seriesFavorite !== undefined && book.series_collection_id) {
      await trx("SeriesCollection")
        .where("id", book.series_collection_id)
        .update({ is_favorite: mutation.seriesFavorite, updated_at: now });
      changedFields.push("seriesFavorite");
    }

    let historyEvent: CompanionSyncHistoryEvent | undefined;
    if (mutation.historyEvent) {
      const duplicateHistory = await trx("BookHistory")
        .select("id")
        .where("event_id", mutation.historyEvent.eventId)
        .first();
      if (!duplicateHistory) {
        const historyPage =
          mutation.historyEvent.currentPage === undefined
            ? nullableNumber(update.current_page ?? book.current_page)
            : clampPage(mutation.historyEvent.currentPage, book.page_count);
        await trx("BookHistory").insert({
          book_id: book.id,
          event_id: mutation.historyEvent.eventId,
          device_id: deviceId,
          current_page: historyPage,
          viewed_at: mutation.historyEvent.viewedAt,
        });
        update.last_read_at = now;
        changedFields.push("history");
        historyEvent = {
          eventId: mutation.historyEvent.eventId,
          bookSyncId: book.sync_id,
          viewedAt: mutation.historyEvent.viewedAt,
          currentPage: historyPage,
          deviceId,
        };
      }
    }

    await trx("Book").where("id", book.id).update(update);
    await trx("Book")
      .where("sync_id", book.sync_id)
      .whereNot("id", book.id)
      .update(update);
    const updatedBook = (await trx("Book")
      .select(
        "id",
        "sync_id",
        "page_count",
        "current_page",
        "is_favorite",
        "is_read",
        "is_hidden",
        "custom_title",
        "series_collection_id",
        trx.raw(
          "coalesce((select is_favorite from SeriesCollection where id = Book.series_collection_id), 0) as series_favorite",
        ),
        "last_read_at",
        "state_version",
        "state_updated_at",
      )
      .where("id", book.id)
      .first()) as SyncBookRow;
    const state = toBookState(updatedBook);

    await trx("CompanionSyncChange").insert({
      book_id: book.id,
      book_sync_id: book.sync_id,
      state_version: state.version,
      current_page: state.currentPage,
      is_favorite: state.isFavorite,
      last_read_at: state.lastReadAt,
      changed_at: state.updatedAt || now,
      device_id: deviceId,
      mutation_id: mutation.mutationId,
      changed_fields: JSON.stringify(changedFields),
      history_event_id: historyEvent?.eventId ?? null,
      history_viewed_at: historyEvent?.viewedAt ?? null,
      history_current_page: historyEvent?.currentPage ?? null,
      state_payload: JSON.stringify({
        isRead: state.isRead,
        isHidden: state.isHidden,
        customTitle: state.customTitle,
        seriesFavorite: state.seriesFavorite,
      }),
    });

    return {
      mutationId: mutation.mutationId,
      status: "applied",
      conflict: versionConflict,
      state,
    };
  }

  private async getLatestCursor(
    connection: Knex = this.database,
  ): Promise<number> {
    const row = await connection("CompanionSyncChange")
      .max("cursor as cursor")
      .first();
    return Number(row?.cursor || 0);
  }
}

function toBookState(book: SyncBookRow): CompanionSyncBookState {
  return {
    syncId: book.sync_id,
    currentPage: Number(book.current_page || 0),
    isFavorite: Boolean(book.is_favorite),
    isRead: Boolean(book.is_read),
    isHidden: Boolean(book.is_hidden),
    customTitle: book.custom_title || null,
    seriesFavorite: Boolean(book.series_favorite),
    lastReadAt: book.last_read_at ? toIsoString(book.last_read_at) : null,
    version: Number(book.state_version || 0),
    updatedAt: book.state_updated_at
      ? toIsoString(book.state_updated_at)
      : null,
  };
}

function toSyncChange(row: SyncChangeRow): CompanionSyncChange {
  const payload = parseStatePayload(row.state_payload);
  const historyEvent = row.history_event_id
    ? {
        eventId: row.history_event_id,
        bookSyncId: row.book_sync_id,
        viewedAt: toIsoString(row.history_viewed_at || row.changed_at),
        currentPage: nullableNumber(row.history_current_page),
        deviceId: row.device_id,
      }
    : undefined;
  return {
    cursor: Number(row.cursor),
    deviceId: row.device_id,
    state: {
      syncId: row.book_sync_id,
      currentPage: Number(row.current_page || 0),
      isFavorite: Boolean(row.is_favorite),
      isRead: Boolean(payload.isRead),
      isHidden: Boolean(payload.isHidden),
      customTitle:
        typeof payload.customTitle === "string" ? payload.customTitle : null,
      seriesFavorite: Boolean(payload.seriesFavorite),
      lastReadAt: row.last_read_at ? toIsoString(row.last_read_at) : null,
      version: Number(row.state_version),
      updatedAt: toIsoString(row.changed_at),
    },
    changedFields: parseChangedFields(row.changed_fields),
    historyEvent,
  };
}

function parseStatePayload(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseChangedFields(
  value: string,
): CompanionSyncChange["changedFields"] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clampPage(page: number, pageCount: number | null): number {
  const maximum = Math.max(0, Number(pageCount || 0));
  return Math.min(Math.max(0, Math.trunc(page)), maximum || Math.trunc(page));
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIsoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
