import type { Knex } from "knex";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/db/index.ts", () => ({ default: null }));
vi.mock("../../../src/main/handlers/bookHandler.ts", () => ({
  handleDeleteBook: vi.fn(),
}));

import {
  createTestDb,
  seedBook,
} from "../../../src/main/db/test-utils.js";
import { DesktopLibraryService } from "../../../src/main/services/companion/companionLibraryService.js";
import { DesktopCompanionSyncService } from "../../../src/main/services/companion/companionSyncService.js";

describe("Android reinstall recovery", () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("restores server-saved series and all book state into a fresh bootstrap", async () => {
    const book = await seedBook(db, { page_count: 20 });
    const stored = await db("Book").where("id", book.id).first();
    const sync = new DesktopCompanionSyncService(db);
    const library = new DesktopLibraryService(db);

    await library.saveSeriesAssignments([
      {
        mutationId: "series-before-reinstall",
        bookSyncId: stored.sync_id,
        name: "Recovery series",
        order: 3,
        baseVersion: 0,
      },
    ]);
    await sync.applyMutations("old-android-install", [
      {
        mutationId: "state-before-reinstall",
        bookSyncId: stored.sync_id,
        baseVersion: 1,
        currentPage: 8,
        isFavorite: true,
        isRead: true,
        isHidden: true,
        customTitle: "Recovered title",
        seriesFavorite: true,
      },
    ]);

    const freshClientBootstrap = await new DesktopCompanionSyncService(db).bootstrap();
    const freshClientLibrary = await new DesktopLibraryService(db).listBooks();

    expect(freshClientBootstrap.books[0]).toMatchObject({
      syncId: stored.sync_id,
      currentPage: 8,
      isFavorite: true,
      isRead: true,
      isHidden: true,
      customTitle: "Recovered title",
      seriesFavorite: true,
      version: 2,
    });
    expect(freshClientLibrary[0].seriesCollection).toMatchObject({
      name: "Recovery series",
      order: 3,
    });
  });
});
