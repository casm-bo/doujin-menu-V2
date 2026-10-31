import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "stream";

const mocks = vi.hoisted(() => ({
  rows: {} as Record<string, Record<number, Record<string, unknown>>>,
  open: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  page: vi.fn(),
  cover: vi.fn(),
  get: vi.fn(),
  capture: vi.fn(),
  change: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => "/data" },
  dialog: { showOpenDialog: mocks.open },
  ipcMain: { handle: vi.fn() },
}));
vi.mock("fs/promises", () => ({
  default: { readFile: mocks.read, stat: mocks.stat },
}));
vi.mock("../../../src/main/db/index.js", () => ({
  default: (table: string) => ({
    where: (_key: string, id: number) => ({
      first: async () => mocks.rows[table]?.[id],
    }),
  }),
}));
vi.mock("../../../src/main/services/companion/presentationService.js", () => ({
  seriesCoverPresentationKey: (name: string) => `sync:series_cover_${name}`,
  DesktopPresentationService: class {
    get = mocks.get;
    captureDesktopEdit = mocks.capture;
    changeCover = mocks.change;
  },
}));
vi.mock(
  "../../../src/main/services/companion/companionLibraryService.js",
  () => ({
    DesktopLibraryService: class {
      getPage = mocks.page;
      getCover = mocks.cover;
    },
  }),
);
import { handleChangeCover } from "../../../src/main/handlers/presentationHandler.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = {
    Book: {
      1: { id: 1, title: "Book", hitomi_id: "123", series_collection_id: 2 },
    },
    SeriesCollection: { 2: { id: 2, name: "Series" } },
  };
  mocks.get.mockResolvedValue({ version: 1 });
  mocks.change.mockResolvedValue({ status: "applied" });
  mocks.stat.mockResolvedValue({ size: 100 });
});

describe("desktop cover sources", () => {
  it("leaves data alone when external selection is canceled", async () => {
    mocks.open.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(
      await handleChangeCover({
        target: { kind: "book", id: 1 },
        source: { kind: "external" },
      }),
    ).toBeNull();
    expect(mocks.change).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("reads only the external file selected by the native picker", async () => {
    mocks.open.mockResolvedValue({
      canceled: false,
      filePaths: ["/chosen.png"],
    });
    mocks.read.mockResolvedValue(Buffer.from("image"));
    await handleChangeCover({
      target: { kind: "book", id: 1 },
      source: { kind: "external" },
    });
    expect(mocks.read).toHaveBeenCalledWith("/chosen.png");
    expect(mocks.change).toHaveBeenCalledWith(
      "hitomi:123",
      "Book",
      Buffer.from("image"),
    );
    mocks.stat.mockResolvedValue({ size: 41 * 1024 * 1024 });
    await expect(
      handleChangeCover({
        target: { kind: "book", id: 1 },
        source: { kind: "external" },
      }),
    ).rejects.toThrow("40MB");
  });
  it("uses internal pages for books and episode covers for series", async () => {
    mocks.page.mockResolvedValue({
      stream: Readable.from([Buffer.from("page")]),
    });
    await handleChangeCover({
      target: { kind: "book", id: 1 },
      source: { kind: "page", bookId: 1, pageIndex: 4 },
    });
    expect(mocks.page).toHaveBeenCalledWith(1, 4);
    mocks.cover.mockResolvedValue({
      stream: Readable.from([Buffer.from("cover")]),
    });
    await handleChangeCover({
      target: { kind: "series", id: 2 },
      source: { kind: "book-cover", bookId: 1 },
    });
    expect(mocks.change).toHaveBeenLastCalledWith(
      "sync:series_cover_Series",
      "Series",
      Buffer.from("cover"),
    );
  });
  it("rejects unrelated books and invalid page indexes", async () => {
    mocks.rows.SeriesCollection[3] = { id: 3, name: "Other" };
    await expect(
      handleChangeCover({
        target: { kind: "series", id: 3 },
        source: { kind: "book-cover", bookId: 1 },
      }),
    ).rejects.toThrow("속한");
    await expect(
      handleChangeCover({
        target: { kind: "book", id: 1 },
        source: { kind: "page", bookId: 1, pageIndex: -1 },
      }),
    ).rejects.toThrow("올바르지");
    expect(mocks.change).not.toHaveBeenCalled();
  });
});
