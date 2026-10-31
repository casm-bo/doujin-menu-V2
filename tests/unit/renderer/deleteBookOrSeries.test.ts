import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.stubGlobal("window", { ipcRenderer: { invoke } });

const { deleteBookOrSeries } = await import("../../../src/renderer/api");

describe("deleteBookOrSeries", () => {
  beforeEach(() => invoke.mockReset());

  it("deletes every episode represented by a series card", async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === "get-series-books"
        ? { success: true, data: [{ id: 11 }, { id: 12 }] }
        : { success: true },
    );

    await expect(
      deleteBookOrSeries({ id: 11, series_collection_id: 7 }),
    ).resolves.toBe(2);
    expect(invoke.mock.calls).toEqual([
      ["get-series-books", 7],
      ["delete-book", { bookId: 11, permanent: undefined }],
      ["delete-book", { bookId: 12, permanent: undefined }],
    ]);
  });

  it("deletes only a standalone book", async () => {
    invoke.mockResolvedValue({ success: true });

    await expect(
      deleteBookOrSeries({ id: 21, series_collection_id: undefined }),
    ).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("delete-book", {
      bookId: 21,
      permanent: undefined,
    });
  });

  it("forwards permanent deletion to every series book", async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === "get-series-books"
        ? { success: true, data: [{ id: 31 }, { id: 32 }] }
        : { success: true },
    );

    await deleteBookOrSeries(
      { id: 31, series_collection_id: 8 },
      { permanent: true },
    );

    expect(invoke.mock.calls).toEqual([
      ["get-series-books", 8],
      ["delete-book", { bookId: 31, permanent: true }],
      ["delete-book", { bookId: 32, permanent: true }],
    ]);
  });
});
