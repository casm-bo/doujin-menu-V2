import archiver from "archiver";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  getZipPageNames,
  readZipPage,
} from "../../../src/main/utils/zipPages.js";

let tempDir: string;

async function makeZip(
  name: string,
  entries: { fileName: string; content: string }[],
): Promise<string> {
  tempDir ??= await fs.mkdtemp(path.join(os.tmpdir(), "zippages-"));
  const zipPath = path.join(tempDir, name);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 0 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const entry of entries) {
      archive.append(Buffer.from(entry.content), { name: entry.fileName });
    }
    void archive.finalize();
  });

  return zipPath;
}

afterAll(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe("ZIP page utilities", () => {
  it("returns naturally sorted image names", async () => {
    const zipPath = await makeZip("order.cbz", [
      { fileName: "p10.jpg", content: "10" },
      { fileName: "info.txt", content: "metadata" },
      { fileName: "p1.AVIF", content: "1" },
      { fileName: "p2.jpg", content: "2" },
    ]);
    expect(await getZipPageNames(zipPath)).toStrictEqual([
      "p1.AVIF",
      "p2.jpg",
      "p10.jpg",
    ]);
  });

  it("reads a page by its sorted index", async () => {
    const zipPath = await makeZip("read.cbz", [
      { fileName: "p10.jpg", content: "tenth" },
      { fileName: "p2.jpg", content: "second" },
      { fileName: "p1.jpg", content: "first" },
    ]);
    expect((await readZipPage(zipPath, 0))?.buffer.toString()).toBe("first");
    expect((await readZipPage(zipPath, 2))?.fileName).toBe("p10.jpg");
  });

  it("returns null for invalid or empty pages", async () => {
    const zipPath = await makeZip("empty.cbz", [
      { fileName: "info.txt", content: "metadata" },
    ]);
    expect(await readZipPage(zipPath, -1)).toBeNull();
    expect(await readZipPage(zipPath, 0)).toBeNull();
  });
});
