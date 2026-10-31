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
  hitomiService: { getGallery: vi.fn(), resolveImageUrl: vi.fn() },
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
  vi.unstubAllGlobals();
  await Promise.all(
    createdDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("safe download archive", () => {
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

describe("direct archive downloads", () => {
  async function setup(hdd = false, format = "cbz") {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-download-"));
    createdDirs.push(dir);
    vi.mocked(app.getPath).mockReturnValue(path.join(dir, "temp"));
    vi.mocked(hitomiService.getGallery).mockResolvedValue({
      id: 123,
      title: { display: "Direct" },
      artists: [],
      groups: [],
      series: [],
      characters: [],
      tags: [],
      type: "doujinshi",
      files: [{ hasWebp: true }, { hasWebp: true }],
    } as never);
    vi.mocked(hitomiService.resolveImageUrl).mockResolvedValue(
      "https://example.test/image",
    );
    vi.mocked(store.get).mockImplementation(
      ((key: string, fallback: unknown) =>
        (
          ({
            compressDownload: true,
            compressFormat: format,
            hddDownloadMode: hdd,
            libraryFolders: [],
            downloadPattern: "%id%",
            createInfoTxtFile: true,
          }) as Record<string, unknown>
        )[key] ?? fallback) as typeof store.get,
    );
    const fetchImage = vi.fn(async () => new Response("image"));
    vi.stubGlobal("fetch", fetchImage);
    const send = vi.fn();
    const run = (shouldCancel?: () => boolean) =>
      handleDownloadGallery({ sender: { send } } as never, {
        galleryId: 123,
        downloadPath: dir,
        shouldCancel,
      });
    return { dir, run, fetchImage, send };
  }

  it.each([
    [false, "cbz"],
    [false, "zip"],
    [true, "cbz"],
  ])(
    "writes directly without image folders (HDD=%s, %s)",
    async (hdd, format) => {
      const { dir, run, fetchImage } = await setup(
        hdd as boolean,
        format as string,
      );
      const result = await run();
      expect(result.success).toBe(true);
      if ("transfer" in result && result.transfer) {
        await expect(
          fs.stat(path.join(path.dirname(result.transfer.stagedPath), "123")),
        ).rejects.toMatchObject({ code: "ENOENT" });
        await finalizeDownloadTransfer(
          { send: vi.fn() } as never,
          result.transfer,
        );
      }
      const { getZipPageNames, readZipPage } =
        await import("../../../src/main/utils/zipPages.js");
      const file = path.join(dir, `123.${format}`);
      expect(await getZipPageNames(file)).toEqual([
        "000001.webp",
        "000002.webp",
      ]);
      expect((await readZipPage(file, 0))?.buffer.toString()).toBe("image");
      expect(fetchImage).toHaveBeenCalledTimes(2);
      await expect(fs.stat(path.join(dir, "123"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );

  it("pauses and resumes without fetching completed pages again", async () => {
    const { dir, run, fetchImage } = await setup();
    expect(await run(() => fetchImage.mock.calls.length === 1)).toMatchObject({
      paused: true,
    });
    const prefix = await fs.readFile(path.join(dir, "123.cbz.part"));
    expect((await run()).success).toBe(true);
    expect(fetchImage).toHaveBeenCalledTimes(2);
    const completed = await fs.readFile(path.join(dir, "123.cbz"));
    expect(completed.subarray(0, prefix.length)).toEqual(prefix);
  });

  it("reuses image files left by older versions", async () => {
    const { dir, run, fetchImage } = await setup();
    const legacy = path.join(dir, "123");
    await fs.mkdir(legacy);
    await fs.writeFile(path.join(legacy, "000001.webp"), "legacy image");
    expect((await run()).success).toBe(true);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    const { readZipPage } = await import("../../../src/main/utils/zipPages.js");
    expect(
      (await readZipPage(path.join(dir, "123.cbz"), 0))?.buffer.toString(),
    ).toBe("legacy image");
    await expect(fs.stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps folder downloads working when archive storage is disabled", async () => {
    const { dir, run } = await setup();
    const get = vi.mocked(store.get).getMockImplementation()!;
    vi.mocked(store.get).mockImplementation(((
      key: string,
      fallback: unknown,
    ) =>
      key === "compressDownload"
        ? false
        : get(key as never, fallback as never)) as typeof store.get);
    expect((await run()).success).toBe(true);
    expect(
      await fs.readFile(path.join(dir, "123", "000001.webp"), "utf8"),
    ).toBe("image");
    await expect(fs.stat(path.join(dir, "123.cbz"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("retains completed pages after a server failure", async () => {
    const { run, fetchImage } = await setup();
    fetchImage.mockResolvedValueOnce(new Response("first"));
    fetchImage.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    expect((await run()).success).toBe(false);
    expect((await run()).success).toBe(true);
    expect(fetchImage).toHaveBeenCalledTimes(3);
  });
});
