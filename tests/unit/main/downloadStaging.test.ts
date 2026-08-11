import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  clearInactiveDownloadStaging,
  getDownloadStagingJobPath,
  publishStagedDownload,
  setDownloadStagingJobActive,
} from "../../../src/main/utils/downloadStaging.js";

const createdDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-staging-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    createdDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("download staging", () => {
  it("publishes a staged archive through a partial file", async () => {
    const dir = await createTempDir();
    const source = path.join(dir, "source.cbz");
    const finalPath = path.join(dir, "library", "book.cbz");
    await fs.writeFile(source, "archive");

    await publishStagedDownload(source, finalPath);

    expect(await fs.readFile(finalPath, "utf8")).toBe("archive");
    await expect(fs.stat(source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(`${finalPath}.part`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("publishes a staged book folder", async () => {
    const dir = await createTempDir();
    const source = path.join(dir, "source");
    const finalPath = path.join(dir, "library", "book");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "001.webp"), "image");

    await publishStagedDownload(source, finalPath);

    expect(await fs.readFile(path.join(finalPath, "001.webp"), "utf8")).toBe(
      "image",
    );
  });

  it("does not replace an existing completed download", async () => {
    const dir = await createTempDir();
    const source = path.join(dir, "source.cbz");
    const finalPath = path.join(dir, "book.cbz");
    await fs.writeFile(source, "new");
    await fs.writeFile(finalPath, "existing");

    await expect(publishStagedDownload(source, finalPath)).rejects.toThrow(
      "같은 이름",
    );
    expect(await fs.readFile(source, "utf8")).toBe("new");
    expect(await fs.readFile(finalPath, "utf8")).toBe("existing");
  });

  it("clears stale jobs without deleting an active job", async () => {
    const tempPath = await createTempDir();
    const activePath = getDownloadStagingJobPath(tempPath, 1);
    const stalePath = getDownloadStagingJobPath(tempPath, 2);
    await fs.mkdir(activePath, { recursive: true });
    await fs.mkdir(stalePath, { recursive: true });
    setDownloadStagingJobActive(activePath, true);

    try {
      await clearInactiveDownloadStaging(tempPath);
      await expect(fs.stat(activePath)).resolves.toBeDefined();
      await expect(fs.stat(stalePath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      setDownloadStagingJobActive(activePath, false);
    }
  });
});
