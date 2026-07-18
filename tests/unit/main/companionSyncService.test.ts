import type { Knex } from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  seedBook,
  truncateAll,
} from "../../../src/main/db/test-utils.js";
import { DesktopCompanionSyncService } from "../../../src/main/services/companion/companionSyncService.js";

describe("DesktopCompanionSyncService", () => {
  let db: Knex;
  let service: DesktopCompanionSyncService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new DesktopCompanionSyncService(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("assigns a stable sync ID to books created by existing scanner code", async () => {
    const book = await seedBook(db, { page_count: 20 });
    const stored = await db("Book").where("id", book.id).first();

    expect(stored.sync_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.state_version).toBe(0);
  });

  it("bootstraps state without exposing desktop paths", async () => {
    const book = await seedBook(db, {
      path: "C:\\Private\\Gallery",
      page_count: 20,
      current_page: 4,
      is_favorite: true,
    });
    await db("BookHistory").insert({
      book_id: book.id,
      viewed_at: "2026-07-16T10:00:00.000Z",
      current_page: 4,
    });

    const bootstrap = await service.bootstrap();

    expect(bootstrap.cursor).toBe(0);
    expect(bootstrap.books).toHaveLength(1);
    expect(bootstrap.books[0]).toMatchObject({
      currentPage: 4,
      isFavorite: true,
      version: 0,
    });
    expect(bootstrap.books[0]).not.toHaveProperty("path");
    expect(bootstrap.history).toHaveLength(1);
    expect(bootstrap.history[0].bookSyncId).toBe(bootstrap.books[0].syncId);
  });

  it("applies state and history mutations and publishes cursor changes", async () => {
    const book = await seedBook(db, { page_count: 20 });
    const stored = await db("Book").where("id", book.id).first();
    const mutation = {
      mutationId: "mutation-1",
      bookSyncId: stored.sync_id,
      baseVersion: 0,
      currentPage: 7,
      isFavorite: true,
      historyEvent: {
        eventId: "history-1",
        viewedAt: "2026-07-16T10:00:00.000Z",
        currentPage: 7,
      },
    };

    const applied = await service.applyMutations("phone-1", [mutation]);
    const changes = await service.getChanges(0);

    expect(applied.cursor).toBe(1);
    expect(applied.results[0]).toMatchObject({
      mutationId: "mutation-1",
      status: "applied",
      conflict: false,
      state: { currentPage: 7, isFavorite: true, version: 1 },
    });
    expect(changes).toMatchObject({ cursor: 1, hasMore: false });
    expect(changes.changes[0].changedFields).toEqual([
      "currentPage",
      "isFavorite",
      "history",
    ]);
    expect(changes.changes[0].historyEvent).toMatchObject({
      eventId: "history-1",
      deviceId: "phone-1",
      currentPage: 7,
    });
  });

  it("deduplicates retried mutations", async () => {
    const book = await seedBook(db, { page_count: 20 });
    const stored = await db("Book").where("id", book.id).first();
    const mutation = {
      mutationId: "retry-1",
      bookSyncId: stored.sync_id,
      currentPage: 3,
    };

    await service.applyMutations("phone-1", [mutation]);
    const retry = await service.applyMutations("phone-1", [mutation]);
    const rows = await db("CompanionSyncChange").select("cursor");

    expect(retry.results[0].status).toBe("duplicate");
    expect(rows).toHaveLength(1);
  });

  it("reports a version conflict while applying the latest received value", async () => {
    const book = await seedBook(db, { page_count: 20 });
    const stored = await db("Book").where("id", book.id).first();
    await service.applyMutations("desktop", [
      {
        mutationId: "desktop-1",
        bookSyncId: stored.sync_id,
        baseVersion: 0,
        currentPage: 2,
      },
    ]);

    const result = await service.applyMutations("phone-1", [
      {
        mutationId: "phone-1",
        bookSyncId: stored.sync_id,
        baseVersion: 0,
        currentPage: 8,
      },
    ]);

    expect(result.results[0]).toMatchObject({
      status: "applied",
      conflict: true,
      state: { currentPage: 8, version: 2 },
    });
  });

  it("synchronizes read, hidden, title, and series favorite state", async () => {
    const book = await seedBook(db, { page_count: 12 });
    const [seriesId] = await db("SeriesCollection").insert({ name: "Series" });
    await db("Book").where("id", book.id).update({ series_collection_id: seriesId });
    const stored = await db("Book").where("id", book.id).first();

    const result = await service.applyMutations("phone-1", [
      {
        mutationId: "all-state-1",
        bookSyncId: stored.sync_id,
        baseVersion: 0,
        currentPage: 5,
        isFavorite: true,
        isRead: true,
        isHidden: true,
        customTitle: "Mobile title",
        seriesFavorite: true,
      },
    ]);
    const bootstrap = await service.bootstrap();

    expect(result.results[0].state).toMatchObject({
      currentPage: 5,
      isFavorite: true,
      isRead: true,
      isHidden: true,
      customTitle: "Mobile title",
      seriesFavorite: true,
    });
    expect(bootstrap.books[0]).toMatchObject(result.results[0].state!);
  });
});
