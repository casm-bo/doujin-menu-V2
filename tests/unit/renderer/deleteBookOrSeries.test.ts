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
      ["delete-book", 11],
      ["delete-book", 12],
    ]);
  });

  it("deletes only a standalone book", async () => {
    invoke.mockResolvedValue({ success: true });

    await expect(
      deleteBookOrSeries({ id: 21, series_collection_id: undefined }),
    ).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("delete-book", 21);
  });
});
