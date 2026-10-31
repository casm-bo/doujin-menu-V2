import fs, { type FileHandle } from "fs/promises";
import path from "path";
import { crc32 } from "node:zlib";

type ArchiveEntry = {
  name: string;
  size: number;
  crc: number;
  offset: number;
  date: number;
  time: number;
};
const UINT32_MAX = 0xffffffff;

// STORE entries have known lengths and CRCs, so recovery only reads headers and skips image bodies.
export class DownloadArchive {
  private entries: ArchiveEntry[] = [];
  private offset = 0;
  private finished = false;
  readonly names = new Set<string>();

  private constructor(
    readonly finalPath: string,
    private file: FileHandle,
  ) {}

  static async open(finalPath: string): Promise<DownloadArchive> {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    try {
      await fs.access(finalPath);
      throw new Error(`이미 있습니다: ${finalPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const pendingPath = `${finalPath}.part`;
    const file = await fs
      .open(pendingPath, "r+")
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return fs.open(pendingPath, "wx+");
      });
    const writer = new DownloadArchive(finalPath, file);
    try {
      await writer.restore();
      return writer;
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  private async restore(): Promise<void> {
    const { size } = await this.file.stat();
    while (this.offset < size) {
      const header = Buffer.alloc(30);
      const { bytesRead } = await this.file.read(header, 0, 30, this.offset);
      if (bytesRead < 4) break;
      const signature = header.readUInt32LE(0);
      // A crash during finalization can leave a partial central directory.
      if (signature === 0x02014b50 || signature === 0x06064b50) break;
      if (signature !== 0x04034b50) {
        throw new Error(
          `이어받기 ZIP 헤더가 손상되었습니다. 원본을 보존했습니다: ${this.finalPath}.part`,
        );
      }
      if (bytesRead < 30) break;
      if (
        header.readUInt16LE(6) !== 0x800 ||
        header.readUInt16LE(8) !== 0 ||
        header.readUInt16LE(28) !== 0 ||
        header.readUInt32LE(18) !== header.readUInt32LE(22)
      ) {
        throw new Error(
          `이어받기 ZIP 헤더가 손상되었습니다. 원본을 보존했습니다: ${this.finalPath}.part`,
        );
      }
      const nameLength = header.readUInt16LE(26);
      const entrySize = header.readUInt32LE(18);
      const end = this.offset + 30 + nameLength + entrySize;
      if (end > size) break;
      const nameBuffer = Buffer.alloc(nameLength);
      const nameRead = await this.file.read(
        nameBuffer,
        0,
        nameLength,
        this.offset + 30,
      );
      if (nameRead.bytesRead !== nameLength)
        throw new Error("ZIP 파일 이름을 읽지 못했습니다.");
      const name = nameBuffer.toString("utf8");
      if (
        !/^(?:[0-9]+\.(?:webp|avif)|info\.txt)$/.test(name) ||
        this.names.has(name)
      ) {
        throw new Error("이어받기 ZIP 항목이 올바르지 않습니다.");
      }
      this.entries.push({
        name,
        size: entrySize,
        crc: header.readUInt32LE(14),
        offset: this.offset,
        date: header.readUInt16LE(12),
        time: header.readUInt16LE(10),
      });
      this.names.add(name);
      this.offset = end;
    }
    await this.file.truncate(this.offset);
  }

  private async write(data: Buffer, position: number): Promise<void> {
    let written = 0;
    while (written < data.length) {
      const { bytesWritten } = await this.file.write(
        data,
        written,
        data.length - written,
        position + written,
      );
      if (!bytesWritten) throw new Error("ZIP 파일에 기록하지 못했습니다.");
      written += bytesWritten;
    }
  }

  async append(name: string, data: Buffer | string): Promise<void> {
    if (this.finished) throw new Error("이미 닫힌 ZIP 파일입니다.");
    if (this.names.has(name)) return;
    if (!/^(?:[0-9]+\.(?:webp|avif)|info\.txt)$/.test(name))
      throw new Error("올바르지 않은 ZIP 항목 이름입니다.");
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (body.length >= UINT32_MAX)
      throw new Error("개별 ZIP 항목은 4GB 미만이어야 합니다.");
    const nameBuffer = Buffer.from(name);
    const header = Buffer.alloc(30 + nameBuffer.length);
    const crc = crc32(body);
    const now = new Date();
    const date =
      ((Math.min(2107, Math.max(1980, now.getFullYear())) - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate();
    const time =
      (now.getHours() << 11) |
      (now.getMinutes() << 5) |
      (now.getSeconds() >> 1);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    nameBuffer.copy(header, 30);
    try {
      await this.write(header, this.offset);
      await this.write(body, this.offset + header.length);
    } catch (error) {
      await this.file.truncate(this.offset);
      throw error;
    }
    this.entries.push({
      name,
      size: body.length,
      crc,
      offset: this.offset,
      date,
      time,
    });
    this.names.add(name);
    this.offset += header.length + body.length;
  }

  async close(publish = false): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    try {
      if (publish) await this.writeDirectory();
    } finally {
      await this.file.close();
    }
    if (publish) await fs.rename(`${this.finalPath}.part`, this.finalPath);
  }

  private async writeDirectory(): Promise<void> {
    let position = this.offset;
    for (const entry of this.entries) {
      const name = Buffer.from(entry.name);
      const header = Buffer.alloc(46 + name.length + 12);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(45, 4);
      header.writeUInt16LE(45, 6);
      header.writeUInt16LE(0x800, 8);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.size, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt16LE(12, 30);
      header.writeUInt32LE(UINT32_MAX, 42);
      name.copy(header, 46);
      const extra = 46 + name.length;
      header.writeUInt16LE(1, extra); // ZIP64 offset supports archives larger than 4GB.
      header.writeUInt16LE(8, extra + 2);
      header.writeBigUInt64LE(BigInt(entry.offset), extra + 4);
      await this.write(header, position);
      position += header.length;
    }
    const end = Buffer.alloc(98);
    end.writeUInt32LE(0x06064b50, 0);
    end.writeBigUInt64LE(44n, 4);
    end.writeUInt16LE(45, 12);
    end.writeUInt16LE(45, 14);
    end.writeBigUInt64LE(BigInt(this.entries.length), 24);
    end.writeBigUInt64LE(BigInt(this.entries.length), 32);
    end.writeBigUInt64LE(BigInt(position - this.offset), 40);
    end.writeBigUInt64LE(BigInt(this.offset), 48);
    end.writeUInt32LE(0x07064b50, 56);
    end.writeBigUInt64LE(BigInt(position), 64);
    end.writeUInt32LE(1, 72);
    end.writeUInt32LE(0x06054b50, 76);
    end.writeUInt16LE(0xffff, 84);
    end.writeUInt16LE(0xffff, 86);
    end.writeUInt32LE(UINT32_MAX, 88);
    end.writeUInt32LE(UINT32_MAX, 92);
    await this.write(end, position);
  }
}
