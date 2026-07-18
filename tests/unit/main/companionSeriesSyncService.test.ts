import type { Knex } from "knex";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../../../src/main/db/index.ts", () => ({ default: null }));
vi.mock("../../../src/main/handlers/bookHandler.ts", () => ({
  handleDeleteBook: vi.fn(),
}));
import {
  createTestDb,
  seedBook,
  truncateAll,
} from "../../../src/main/db/test-utils.js";
import { DesktopLibraryService } from "../../../src/main/services/companion/companionLibraryService.js";

describe("DesktopLibraryService series synchronization", () => {
  let db: Knex;
  let service: DesktopLibraryService;

  beforeAll(async () => {
    db = await createTestDb();
    service = new DesktopLibraryService(db);
  });

  beforeEach(async () => {
    await truncateAll(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("keeps only the newest series state for each book", async () => {
    const book = await seedBook(db, { series_state_updated_at: 1_000 });

    const applied = await service.saveSeriesAssignments([
      {
        bookSyncId: book.sync_id as string,
        name: " Mobile Series ",
        order: 2,
        modifiedAt: 2_000,
      },
    ]);
    const ignored = await service.saveSeriesAssignments([
      {
        bookSyncId: book.sync_id as string,
        name: "Older Series",
        order: 0,
        modifiedAt: 1_500,
      },
    ]);

    expect(applied.data?.updated).toBe(1);
    expect(ignored.data?.updated).toBe(0);
    expect((await service.listBooks())[0].seriesCollection).toEqual({
      name: "Mobile Series",
      order: 2,
      modifiedAt: 2_000,
    });

    const removed = await service.saveSeriesAssignments([
      {
        bookSyncId: book.sync_id as string,
        name: null,
        order: 0,
        modifiedAt: 3_000,
      },
    ]);

    expect(removed.data?.updated).toBe(1);
    expect((await service.listBooks())[0].seriesCollection).toEqual({
      name: null,
      order: 0,
      modifiedAt: 3_000,
    });
  });

  it("timestamps series changes made by the desktop", async () => {
    const book = await seedBook(db, { series_state_updated_at: 1 });
    const [seriesId] = await db("SeriesCollection").insert({
      name: "Desktop Series",
    });

    await db("Book").where("id", book.id).update({
      series_collection_id: seriesId,
      series_order_index: 1,
    });
    const assigned = await db("Book").where("id", book.id).first();
    expect(Number(assigned.series_state_updated_at)).toBeGreaterThan(1);
    expect(Number(assigned.state_version)).toBe(1);

    await db("Book").where("id", book.id).update({
      series_state_updated_at: 1,
    });
    await db("SeriesCollection")
      .where("id", seriesId)
      .update({ name: "Renamed Desktop Series" });
    const renamed = await db("Book").where("id", book.id).first();
    expect(Number(renamed.series_state_updated_at)).toBeGreaterThan(1);
    expect(Number(renamed.state_version)).toBe(2);
  });

  it("returns an item-level conflict for a stale base version", async () => {
    const book = await seedBook(db, { state_version: 2 });
    const result = await service.saveSeriesAssignments([
      {
        mutationId: "series-conflict",
        bookSyncId: book.sync_id as string,
        name: "Stale series",
        order: 0,
        baseVersion: 1,
      },
    ]);

    expect(result.data?.updated).toBe(0);
    expect(result.data?.results[0]).toMatchObject({
      mutationId: "series-conflict",
      status: "conflict",
      version: 2,
    });
  });
});
