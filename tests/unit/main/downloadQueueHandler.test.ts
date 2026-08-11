import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  tempPath: "",
  deleteRow: vi.fn(async () => 1),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => state.tempPath) },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() },
}));
vi.mock("../../../src/main/main.js", () => ({
  console: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
}));
vi.mock("../../../src/main/db/index.js", () => ({
  default: vi.fn(() => {
    const query: Record<string, unknown> = {};
    query.where = vi.fn(() => query);
    query.first = vi.fn(async () => state.row);
    query.delete = state.deleteRow;
    return query;
  }),
}));

const getGallery = vi.hoisted(() => vi.fn());
vi.mock("../../../src/main/services/hitomi/hitomiService.js", () => ({
  hitomiService: { getGallery },
}));
vi.mock("../../../src/main/handlers/configHandler.js", () => ({
  store: { get: vi.fn() },
}));
vi.mock("../../../src/main/handlers/downloaderHandler.js", () => ({
  finalizeDownloadTransfer: vi.fn(),
  handleDownloadGallery: vi.fn(),
}));
vi.mock("../../../src/main/services/companion/companionSyncSignal.js", () => ({
  notifyCompanionLibraryChanged: vi.fn(),
}));

import { handleRemoveFromDownloadQueue } from "../../../src/main/handlers/downloadQueueHandler.js";

const tempRoots: string[] = [];

afterEach(async () => {
  state.row = null;
  state.deleteRow.mockClear();
  getGallery.mockClear();
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("download queue removal", () => {
  it("uses the stored path and removes empty nested parents", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "queue-remove-"));
    tempRoots.push(tempRoot);
    state.tempPath = tempRoot;
    const downloadRoot = path.join(tempRoot, "library");
    const resolvedPath = path.join(downloadRoot, "Circle", "Book");
    await fs.mkdir(resolvedPath, { recursive: true });
    await fs.writeFile(path.join(resolvedPath, "001.jpg"), "image");
    state.row = {
      id: 7,
      gallery_id: 123,
      status: "paused",
      download_path: downloadRoot,
      resolved_path: resolvedPath,
    };

    await expect(handleRemoveFromDownloadQueue(7)).resolves.toEqual({
      success: true,
    });

    await expect(fs.stat(resolvedPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      fs.stat(path.join(downloadRoot, "Circle")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.stat(downloadRoot)).resolves.toBeTruthy();
    expect(getGallery).not.toHaveBeenCalled();
    expect(state.deleteRow).toHaveBeenCalledOnce();
  });
});
