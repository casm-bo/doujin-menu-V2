import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { app } from "electron";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "") },
  ipcMain: { handle: vi.fn() },
}));
vi.mock("../../../src/main/main.js", () => ({
  console: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../src/main/services/hitomi/hitomiService.js", () => ({
  hitomiService: { getGallery: vi.fn() },
}));
vi.mock("../../../src/main/handlers/configHandler.js", () => ({
  store: { get: vi.fn() },
}));
vi.mock("../../../src/main/handlers/directoryHandler.js", () => ({
  scanFile: vi.fn(),
  extractInfoTxtAndImageCountFromZip: vi.fn(),
}));

const { updateQueue } = vi.hoisted(() => ({ updateQueue: vi.fn() }));
vi.mock("../../../src/main/db/index.js", () => ({
  default: vi.fn(() => ({
    where: vi.fn(() => ({ update: updateQueue })),
  })),
}));

import {
  createDownloadArchive,
  finalizeDownloadTransfer,
  handleDownloadGallery,
} from "../../../src/main/handlers/downloaderHandler.js";
import { hitomiService } from "../../../src/main/services/hitomi/hitomiService.js";
import { store } from "../../../src/main/handlers/configHandler.js";
import {
  extractInfoTxtAndImageCountFromZip,
  scanFile,
} from "../../../src/main/handlers/directoryHandler.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("safe download archive", () => {
  it("publishes only the completed archive", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-archive-"));
    createdDirs.push(dir);
    const source = path.join(dir, "source");
    const finalPath = path.join(dir, "book.cbz");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "001.jpg"), "image");

    await createDownloadArchive(source, finalPath);

    expect((await fs.stat(finalPath)).size).toBeGreaterThan(0);
    await expect(fs.stat(`${finalPath}.part`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not replace an existing completed archive", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-archive-"));
    createdDirs.push(dir);
    const source = path.join(dir, "source");
    const finalPath = path.join(dir, "book.cbz");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "001.jpg"), "new");
    await fs.writeFile(finalPath, "existing");
    await fs.writeFile(`${finalPath}.part`, "stale");

    await expect(createDownloadArchive(source, finalPath)).rejects.toThrow(
      "이미 있습니다",
    );
    expect(await fs.readFile(finalPath, "utf8")).toBe("existing");
    await expect(fs.stat(`${finalPath}.part`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reconnects an existing archive with the same Hitomi ID", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-recover-"));
    createdDirs.push(dir);
    const archivePath = path.join(dir, "3713170.cbz");
    await fs.writeFile(archivePath, "existing archive");

    vi.mocked(hitomiService.getGallery).mockResolvedValue({
      id: 3713170,
      title: { display: "Recovered" },
      artists: [{ name: "Artist" }],
      groups: [],
      series: [],
      characters: [],
      tags: [],
      type: "doujinshi",
      language: { name: "korean" },
      files: [],
    } as never);
    vi.mocked(store.get).mockImplementation(((
      key: string,
      fallback: unknown,
    ) => {
      const values: Record<string, unknown> = {
        compressDownload: true,
        compressFormat: "cbz",
        libraryFolders: [dir],
        downloadPattern: "%id%",
      };
      return values[key] ?? fallback;
    }) as typeof store.get);
    vi.mocked(extractInfoTxtAndImageCountFromZip).mockResolvedValue({
      infoTxt: "갤러리 넘버: 3713170",
      imageCount: 10,
    });
    vi.mocked(scanFile).mockResolvedValue(42);
    const send = vi.fn();

    const result = await handleDownloadGallery({ sender: { send } } as never, {
      galleryId: 3713170,
      downloadPath: dir,
    });

    expect(result).toEqual({ success: true, bookId: 42 });
    expect(scanFile).toHaveBeenCalledWith(
      archivePath,
      undefined,
      "soft",
      expect.objectContaining({ hitomi_id: "3713170", title: "Recovered" }),
    );
    expect(send).toHaveBeenLastCalledWith("download-progress", {
      galleryId: 3713170,
      status: "completed",
      bookId: 42,
    });
  });

  it("stages an HDD-mode archive before publishing it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-hdd-mode-"));
    createdDirs.push(dir);
    const tempPath = path.join(dir, "temp");
    const downloadPath = path.join(dir, "library");
    await fs.mkdir(downloadPath);
    const finalPath = path.join(downloadPath, "Circle", "3713171.cbz");
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    await fs.writeFile(`${finalPath}.part`, "active transfer");

    vi.mocked(app.getPath).mockReturnValue(tempPath);
    vi.mocked(hitomiService.getGallery).mockResolvedValue({
      id: 3713171,
      title: { display: "Staged" },
      artists: [],
      groups: [{ name: "Circle" }],
      series: [],
      characters: [],
      tags: [],
      type: "doujinshi",
      language: { name: "korean" },
      files: [],
    } as never);
    vi.mocked(store.get).mockImplementation(((
      key: string,
      fallback: unknown,
    ) => {
      const values: Record<string, unknown> = {
        compressDownload: true,
        compressFormat: "cbz",
        hddDownloadMode: true,
        libraryFolders: [],
        downloadPattern: "%groups%\\%id%",
        createInfoTxtFile: true,
      };
      return values[key] ?? fallback;
    }) as typeof store.get);
    const send = vi.fn();

    const result = await handleDownloadGallery({ sender: { send } } as never, {
      galleryId: 3713171,
      downloadPath,
      queueId: 77,
    });

    expect(result.success).toBe(true);
    expect("transfer" in result && result.transfer?.finalPath).toBe(finalPath);
    expect(updateQueue).toHaveBeenCalledWith({
      total_files: 0,
      resolved_path: path.join(downloadPath, "Circle", "3713171"),
    });
    expect(await fs.readFile(`${finalPath}.part`, "utf8")).toBe(
      "active transfer",
    );
    if (!("transfer" in result) || !result.transfer) {
      throw new Error("Expected a prepared transfer");
    }

    await finalizeDownloadTransfer({ send } as never, result.transfer);

    expect((await fs.stat(finalPath)).size).toBeGreaterThan(0);
    await expect(fs.stat(result.transfer.stagingJobPath)).rejects.toMatchObject(
      {
        code: "ENOENT",
      },
    );
    expect(send).toHaveBeenLastCalledWith("download-progress", {
      galleryId: 3713171,
      status: "completed",
      bookId: null,
    });
  });
});
