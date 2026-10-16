import * as yauzl from "yauzl";
import { isImageFile } from "./imageFiles.js";
import { naturalSort } from "./index.js";

export async function getZipPageNames(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (error, zipFile) => {
        if (error) return reject(error);

        const fileNames: string[] = [];

        zipFile.on("entry", (entry: yauzl.Entry) => {
          if (!entry.fileName.endsWith("/") && isImageFile(entry.fileName)) {
            fileNames.push(entry.fileName);
          }
          zipFile.readEntry();
        });

        zipFile.on("end", () => {
          zipFile.close();
          resolve(fileNames.sort(naturalSort));
        });

        zipFile.on("error", (zipError) => {
          zipFile.close();
          reject(zipError);
        });

        zipFile.readEntry();
      },
    );
  });
}

export async function readZipPage(
  zipPath: string,
  pageIndex: number,
): Promise<{ fileName: string; buffer: Buffer } | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (error, zipFile) => {
        if (error) return reject(error);

        const imageEntries: { fileName: string; entry: yauzl.Entry }[] = [];

        zipFile.on("entry", (entry: yauzl.Entry) => {
          if (!entry.fileName.endsWith("/") && isImageFile(entry.fileName)) {
            imageEntries.push({ fileName: entry.fileName, entry });
          }
          zipFile.readEntry();
        });

        zipFile.on("end", () => {
          imageEntries.sort((a, b) => naturalSort(a.fileName, b.fileName));

          if (pageIndex < 0 || pageIndex >= imageEntries.length) {
            zipFile.close();
            return resolve(null);
          }

          const target = imageEntries[pageIndex];
          zipFile.openReadStream(target.entry, (streamError, readStream) => {
            if (streamError) {
              zipFile.close();
              return reject(streamError);
            }

            const chunks: Buffer[] = [];
            readStream.on("data", (chunk: Buffer) => chunks.push(chunk));
            readStream.on("end", () => {
              zipFile.close();
              resolve({
                fileName: target.fileName,
                buffer: Buffer.concat(chunks),
              });
            });
            readStream.on("error", (readError) => {
              zipFile.close();
              reject(readError);
            });
          });
        });

        zipFile.on("error", (zipError) => {
          zipFile.close();
          reject(zipError);
        });

        zipFile.readEntry();
      },
    );
  });
}
