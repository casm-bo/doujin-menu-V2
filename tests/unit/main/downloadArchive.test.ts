import { afterEach, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { DownloadArchive } from "../../../src/main/utils/downloadArchive.js";
import {
  getZipPageNames,
  readZipPage,
} from "../../../src/main/utils/zipPages.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
async function target() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-archive-"));
  dirs.push(dir);
  return path.join(dir, "book.cbz");
}

it("writes images directly and publishes only after finalization", async () => {
  const file = await target();
  const writer = await DownloadArchive.open(file);
  await writer.append("000001.webp", Buffer.from("first"));
  await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  await writer.append("000002.avif", Buffer.from("second"));
  await writer.close(true);
  expect(await getZipPageNames(file)).toEqual(["000001.webp", "000002.avif"]);
  expect((await readZipPage(file, 1))?.buffer.toString()).toBe("second");
  expect(await fs.readdir(path.dirname(file))).toEqual(["book.cbz"]);
});

it("checkpoints and resumes without duplicate images", async () => {
  const file = await target();
  const first = await DownloadArchive.open(file);
  await first.append("000001.webp", Buffer.from("first"));
  await first.close();
  const resumed = await DownloadArchive.open(file);
  expect(resumed.names.has("000001.webp")).toBe(true);
  await resumed.append("000001.webp", Buffer.from("duplicate"));
  await resumed.append("000002.webp", Buffer.from("second"));
  await resumed.close(true);
  expect(await getZipPageNames(file)).toHaveLength(2);
  expect((await readZipPage(file, 0))?.buffer.toString()).toBe("first");
});

it("resumes in place, reads only headers, and discards an incomplete tail", async () => {
  const file = await target();
  const first = await DownloadArchive.open(file);
  await first.append("000001.webp", Buffer.alloc(1024 * 1024, 7));
  await first.close();
  const prefix = await fs.readFile(`${file}.part`);
  await fs.appendFile(
    `${file}.part`,
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 20]),
  );
  const handle = await fs.open(`${file}.part`, "r+");
  const read = vi.spyOn(handle, "read");
  const write = vi.spyOn(handle, "write");
  const open = vi.spyOn(fs, "open").mockResolvedValueOnce(handle);
  const resumed = await DownloadArchive.open(file);
  expect(
    (read.mock.calls as unknown[][]).every((call) => Number(call[2]) <= 30),
  ).toBe(true);
  expect(write).not.toHaveBeenCalled();
  await resumed.append("000002.webp", Buffer.from("second"));
  expect(
    (write.mock.calls as unknown[][]).every(
      (call) => Number(call[3]) >= prefix.length,
    ),
  ).toBe(true);
  await resumed.close(true);
  open.mockRestore();
  const completed = await fs.readFile(file);
  expect(completed.subarray(0, prefix.length)).toEqual(prefix);
  expect((await readZipPage(file, 1))?.buffer.toString()).toBe("second");
});

it("preserves completed archives and invalid recovery data", async () => {
  const file = await target();
  await fs.writeFile(file, "existing");
  await expect(DownloadArchive.open(file)).rejects.toThrow("이미 있습니다");
  expect(await fs.readFile(file, "utf8")).toBe("existing");
  await fs.rm(file);
  await fs.writeFile(`${file}.part`, "invalid");
  await expect(DownloadArchive.open(file)).rejects.toThrow();
  expect(await fs.readFile(`${file}.part`, "utf8")).toBe("invalid");
});

it("drops a partially written image and keeps all completed images", async () => {
  const file = await target();
  const first = await DownloadArchive.open(file);
  await first.append("000001.webp", Buffer.from("first"));
  await first.append("000002.webp", Buffer.from("unfinished"));
  await first.close();
  const part = `${file}.part`;
  await fs.truncate(part, (await fs.stat(part)).size - 2);
  const resumed = await DownloadArchive.open(file);
  expect([...resumed.names]).toEqual(["000001.webp"]);
  await resumed.append("000002.webp", Buffer.from("replacement"));
  await resumed.close(true);
  expect((await readZipPage(file, 1))?.buffer.toString()).toBe("replacement");
});

it("recovers after interruption while writing the central directory", async () => {
  const file = await target();
  const first = await DownloadArchive.open(file);
  await first.append("000001.webp", Buffer.from("123456789"));
  await first.close(true);
  const bytes = await fs.readFile(file);
  expect(bytes.readUInt32LE(14)).toBe(0xcbf43926);
  await fs.rename(file, `${file}.part`);
  await fs.truncate(`${file}.part`, bytes.length - 20);
  const resumed = await DownloadArchive.open(file);
  await resumed.close(true);
  expect((await readZipPage(file, 0))?.buffer.toString()).toBe("123456789");
});

it("rolls back a failed write without losing earlier images", async () => {
  const file = await target();
  const first = await DownloadArchive.open(file);
  await first.append("000001.webp", Buffer.from("first"));
  await first.close();
  const handle = await fs.open(`${file}.part`, "r+");
  const open = vi.spyOn(fs, "open").mockResolvedValueOnce(handle);
  const resumed = await DownloadArchive.open(file);
  const write = vi.spyOn(handle, "write");
  write.mockRejectedValueOnce(
    Object.assign(new Error("disk full"), { code: "ENOSPC" }),
  );
  await expect(
    resumed.append("000002.webp", Buffer.from("second")),
  ).rejects.toThrow("disk full");
  write.mockRestore();
  await resumed.close();
  open.mockRestore();
  const retry = await DownloadArchive.open(file);
  expect([...retry.names]).toEqual(["000001.webp"]);
  await retry.append("000002.webp", Buffer.from("second"));
  await retry.close(true);
  expect((await readZipPage(file, 0))?.buffer.toString()).toBe("first");
});
