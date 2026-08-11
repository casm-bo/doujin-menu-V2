import archiver from "archiver";
import { app, ipcMain } from "electron";
import { filenamifyPath } from "filenamify";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { console } from "../main.js";
import { hitomiService } from "../services/hitomi/hitomiService.js";
import {
  DEFAULT_DOWNLOAD_PATTERN,
  formatDownloadFolderName,
} from "../utils/index.js";
import { isPathWithinLibraryRoot } from "../utils/libraryPath.js";
import {
  getDownloadStagingJobPath,
  getDownloadStagingRoot,
  publishStagedDownload,
} from "../utils/downloadStaging.js";
import { store as configStore } from "./configHandler.js";
import {
  extractInfoTxtAndImageCountFromZip,
  scanFile,
} from "./directoryHandler.js";
import { parseInfoTxt, type ParsedMetadata } from "../parsers/infoTxtParser.js";

export interface PreparedDownloadTransfer {
  galleryId: number;
  stagedPath: string;
  finalPath: string;
  stagingJobPath: string;
  libraryFolders: string[];
  downloadedMetadata: ParsedMetadata;
}

async function completeDownloadedBook(
  webContents: Electron.WebContents,
  transfer: Omit<PreparedDownloadTransfer, "stagedPath" | "stagingJobPath">,
): Promise<number | null> {
  const scanStats = await fs.stat(transfer.finalPath);
  if (scanStats.isFile() && scanStats.size === 0) {
    throw new Error("생성된 압축 파일이 비어 있습니다.");
  }
  if (
    scanStats.isDirectory() &&
    (await fs.readdir(transfer.finalPath)).length === 0
  ) {
    throw new Error("생성된 책 폴더가 비어 있습니다.");
  }

  const isDownloadedToLibrary = transfer.libraryFolders.some((folder) =>
    isPathWithinLibraryRoot(transfer.finalPath, folder),
  );
  let bookId: number | null = null;
  if (isDownloadedToLibrary) {
    bookId = await scanFile(
      transfer.finalPath,
      undefined,
      "soft",
      transfer.downloadedMetadata,
    );
    if (!bookId) {
      throw new Error(
        "파일 다운로드는 완료됐지만 라이브러리 등록에 실패했습니다.",
      );
    }
  }

  webContents.send("download-progress", {
    galleryId: transfer.galleryId,
    status: "completed",
    bookId,
  });
  return bookId;
}

export async function finalizeDownloadTransfer(
  webContents: Electron.WebContents,
  transfer: PreparedDownloadTransfer,
): Promise<number | null> {
  try {
    webContents.send("download-progress", {
      galleryId: transfer.galleryId,
      status: "transferring",
      progress: 100,
    });
    await publishStagedDownload(transfer.stagedPath, transfer.finalPath);
    await fs.rm(transfer.stagingJobPath, { recursive: true, force: true });
    return await completeDownloadedBook(webContents, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    webContents.send("download-progress", {
      galleryId: transfer.galleryId,
      status: "failed",
      error: message,
    });
    throw error;
  }
}

export async function createDownloadArchive(
  sourcePath: string,
  finalPath: string,
): Promise<void> {
  const pendingPath = `${finalPath}.part`;
  await fs.rm(pendingPath, { force: true });

  const existing = await fs
    .stat(finalPath)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (existing) {
    throw new Error(`같은 이름의 다운로드 파일이 이미 있습니다: ${finalPath}`);
  }

  const output = createWriteStream(pendingPath, { flags: "wx" });
  const archive = archiver("zip", { zlib: { level: 0 } });

  try {
    await new Promise<void>((resolve, reject) => {
      output.once("close", resolve);
      output.once("error", reject);
      archive.once("error", reject);
      archive.once("warning", reject);
      archive.pipe(output);
      archive.directory(sourcePath, false);
      void archive.finalize().catch(reject);
    });

    const stats = await fs.stat(pendingPath);
    if (stats.size === 0) throw new Error("생성된 압축 파일이 비어 있습니다.");
    await fs.rename(pendingPath, finalPath);
  } catch (error) {
    archive.abort();
    output.destroy();
    await fs.rm(pendingPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export const handleSearchGalleries = async ({
  query,
  page = 1,
}: {
  query: { searchQuery: string; offset?: number };
  page: number;
}) => {
  try {
    const result = await hitomiService.searchGalleries({ query, page });
    return { success: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error searching galleries:", error);
    return { success: false, error: message };
  }
};

export const handleGetGalleryDetails = async (galleryId: number) => {
  try {
    const gallery = await hitomiService.getGalleryDetails(galleryId);
    return { success: true, data: gallery };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error getting gallery details for ID ${galleryId}:`, error);
    return { success: false, error: message };
  }
};

export const handleGetGalleryImageUrls = async (galleryId: number) => {
  try {
    const previewUrls = await hitomiService.getGalleryImageUrls(galleryId);
    return { success: true, data: previewUrls };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error getting image URLs for gallery ${galleryId}:`, error);
    return { success: false, error: message };
  }
};

export const handleDownloadGallery = async (
  event: Electron.IpcMainInvokeEvent,
  {
    galleryId,
    downloadPath,
    queueId,
    shouldCancel,
  }: {
    galleryId: number;
    downloadPath: string;
    queueId?: number;
    shouldCancel?: () => boolean; // 취소 확인 함수
  },
) => {
  const webContents = event.sender;
  try {
    webContents.send("download-progress", {
      galleryId,
      status: "starting",
    });

    const gallery = await hitomiService.getGallery(galleryId);
    const compressDownload = configStore.get("compressDownload", false);
    const compressFormat = configStore.get("compressFormat", "cbz");
    const hddDownloadMode = configStore.get("hddDownloadMode", false);
    const libraryFolders = configStore.get("libraryFolders", []);
    const downloadedMetadata: ParsedMetadata = {
      hitomi_id: String(gallery.id),
      title: gallery.title.display,
      artists: gallery.artists.map((tag) => ({ name: tag.name })),
      groups: gallery.groups.map((tag) => ({ name: tag.name })),
      type: gallery.type,
      series: gallery.series.map((tag) => ({ name: tag.name })),
      characters: gallery.characters.map((tag) => ({ name: tag.name })),
      tags:
        gallery.tags?.map((tag) => ({
          name:
            tag.type === "male" || tag.type === "female"
              ? `${tag.type}:${tag.name}`
              : tag.name,
        })) ?? [],
      language: gallery.language?.name,
    };

    const downloadPattern = configStore.get(
      "downloadPattern",
      DEFAULT_DOWNLOAD_PATTERN,
    );
    let galleryFolderName = formatDownloadFolderName(gallery, downloadPattern);

    // Windows MAX_PATH 제한(260자)을 고려한 전체 경로 길이 검증
    // 파일명을 위한 여유 공간 확보 (예: "000001.webp" = 12자)
    const MAX_SAFE_PATH_LENGTH = 245; // 260 - 30 (파일명 + 여유)
    let finalFolderPath = path.join(downloadPath, galleryFolderName);

    // 전체 경로가 너무 길면 폴더명을 줄임
    if (finalFolderPath.length > MAX_SAFE_PATH_LENGTH) {
      const idSuffix = `... (${gallery.id})`;
      const availableLength =
        MAX_SAFE_PATH_LENGTH - downloadPath.length - idSuffix.length - 1; // -1 for path separator

      if (availableLength > 0 && galleryFolderName.length > availableLength) {
        galleryFolderName =
          galleryFolderName.substring(0, availableLength).trim() + idSuffix;
      } else if (availableLength <= 0) {
        // 다운로드 경로 자체가 너무 길어서 공간이 없는 경우
        galleryFolderName = `${gallery.id}`;
      }

      finalFolderPath = path.join(downloadPath, galleryFolderName);
    }

    // 예약 문자 처리
    const finalGalleryPath = filenamifyPath(finalFolderPath, {
      maxLength: 100,
      replacement: "_",
    });

    const stagingJobPath = hddDownloadMode
      ? getDownloadStagingJobPath(app.getPath("temp"), gallery.id)
      : null;
    const galleryDownloadPath = stagingJobPath
      ? path.join(stagingJobPath, path.basename(finalGalleryPath))
      : finalGalleryPath;

    const archiveFilePath = `${galleryDownloadPath}.${compressFormat}`;
    const finalArchiveFilePath = `${finalGalleryPath}.${compressFormat}`;
    if (compressDownload) {
      if (!stagingJobPath) {
        await fs.rm(`${finalArchiveFilePath}.part`, { force: true });
      }
      const existingArchive = await fs
        .stat(finalArchiveFilePath)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (existingArchive) {
        const { infoTxt, imageCount } =
          await extractInfoTxtAndImageCountFromZip(finalArchiveFilePath);
        const existingHitomiId = infoTxt
          ? parseInfoTxt(infoTxt).hitomi_id?.trim()
          : null;
        if (existingHitomiId !== String(gallery.id) || imageCount === 0) {
          throw new Error(
            `같은 이름의 다른 파일이 이미 있습니다. 덮어쓰지 않았습니다: ${finalArchiveFilePath}`,
          );
        }

        let bookId: number | null = null;
        if (
          libraryFolders.some((folder) =>
            isPathWithinLibraryRoot(finalArchiveFilePath, folder),
          )
        ) {
          bookId = await scanFile(
            finalArchiveFilePath,
            undefined,
            "soft",
            downloadedMetadata,
          );
          if (!bookId) {
            throw new Error(
              "다운로드 파일은 확인했지만 라이브러리 등록에 실패했습니다.",
            );
          }
        }

        webContents.send("download-progress", {
          galleryId,
          status: "completed",
          bookId,
        });
        return { success: true, bookId };
      }

      const existingStagedArchive = stagingJobPath
        ? await fs
            .stat(archiveFilePath)
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            })
        : null;
      if (existingStagedArchive && stagingJobPath) {
        const { infoTxt, imageCount } =
          await extractInfoTxtAndImageCountFromZip(archiveFilePath);
        const stagedHitomiId = infoTxt
          ? parseInfoTxt(infoTxt).hitomi_id?.trim()
          : null;
        if (
          imageCount === 0 ||
          (stagedHitomiId && stagedHitomiId !== String(gallery.id))
        ) {
          throw new Error(
            `임시 압축 파일이 올바르지 않습니다: ${archiveFilePath}`,
          );
        }
        webContents.send("download-progress", {
          galleryId,
          status: "transferring",
          progress: 100,
        });
        return {
          success: true,
          transfer: {
            galleryId,
            stagedPath: archiveFilePath,
            finalPath: finalArchiveFilePath,
            stagingJobPath,
            libraryFolders,
            downloadedMetadata,
          } satisfies PreparedDownloadTransfer,
        };
      }
    }

    if (!compressDownload && stagingJobPath) {
      const existingFinalFolder = await fs
        .stat(finalGalleryPath)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (existingFinalFolder) {
        if (!existingFinalFolder.isDirectory()) {
          throw new Error(
            `같은 이름의 파일이 이미 있습니다: ${finalGalleryPath}`,
          );
        }
        const entries = await fs.readdir(finalGalleryPath);
        const imageCount = entries.filter((file) =>
          /\.(avif|webp|jpe?g|png|gif|bmp)$/i.test(file),
        ).length;
        if (gallery.files.length > 0 && imageCount !== gallery.files.length) {
          throw new Error(
            `같은 이름의 다른 폴더가 이미 있습니다: ${finalGalleryPath}`,
          );
        }

        const bookId = await completeDownloadedBook(webContents, {
          galleryId,
          finalPath: finalGalleryPath,
          libraryFolders,
          downloadedMetadata,
        });
        return { success: true, bookId };
      }
    }

    await fs.mkdir(galleryDownloadPath, { recursive: true });

    const totalFiles = gallery.files.length;

    // 큐 ID가 있으면 total_files 업데이트
    if (queueId) {
      const db = (await import("../db/index.js")).default;
      await db("DownloadQueue").where("id", queueId).update({
        total_files: totalFiles,
      });
    }

    for (let i = 0; i < totalFiles; i++) {
      // 취소 확인
      if (shouldCancel && shouldCancel()) {
        return {
          success: false,
          error: "다운로드가 일시정지되었습니다.",
          paused: true,
        };
      }

      const file = gallery.files[i];
      const fileExt = file.hasWebp ? "webp" : "avif";
      const fileName = `${String(i + 1).padStart(6, "0")}.${fileExt}`;
      const filePath = path.join(galleryDownloadPath, fileName);

      // 파일이 이미 존재하면 건너뛰기 (이어받기)
      try {
        await fs.access(filePath);

        // 진행률 업데이트
        const progress = Math.round(((i + 1) / totalFiles) * 100);
        webContents.send("download-progress", {
          galleryId,
          status: "progress",
          progress,
        });

        // 큐 ID가 있으면 DB 업데이트
        if (queueId) {
          const db = (await import("../db/index.js")).default;
          await db("DownloadQueue")
            .where("id", queueId)
            .update({
              progress,
              downloaded_files: i + 1,
            });

          // 모든 윈도우에 큐 업데이트 알림
          const { BrowserWindow } = await import("electron");
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((window) => {
            window.webContents.send("download-queue-updated");
          });
        }

        continue; // 다음 파일로
      } catch {
        // 파일이 없으면 다운로드 진행
      }

      let success = false;
      let attempt = 0;

      let lastFailure = "알 수 없는 오류";

      while (!success && attempt < MAX_DOWNLOAD_ATTEMPTS) {
        // 재시도 루프 내에서도 취소 확인
        if (shouldCancel && shouldCancel()) {
          return {
            success: false,
            error: "다운로드가 일시정지되었습니다.",
            paused: true,
          };
        }
        attempt++;

        let res: Response;
        try {
          // 이미지 서버 구성이 갱신될 수 있으므로 매 시도마다 URL을 다시 계산합니다.
          const fullImageUrl = await hitomiService.resolveImageUrl(file);
          res = await fetch(fullImageUrl, {
            headers: {
              accept:
                "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
              "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
              priority: "i",
              "sec-ch-ua":
                '"Chromium";v="136", "Whale";v="4", "Not.A/Brand";v="99"',
              "sec-ch-ua-mobile": "?0",
              "sec-ch-ua-platform": '"Windows"',
              "sec-fetch-dest": "image",
              "sec-fetch-mode": "no-cors",
              "sec-fetch-site": "cross-site",
              "sec-fetch-storage-access": "active",
              "sec-gpc": "1",
              Referer: `https://hitomi.la/reader/${gallery.id}.html`,
              "Referrer-Policy": "no-referrer-when-downgrade",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            },
          });
        } catch (error) {
          lastFailure = error instanceof Error ? error.message : String(error);
          if (attempt >= MAX_DOWNLOAD_ATTEMPTS) break;
          const delayMs = getRetryDelayMs(undefined, attempt);
          console.warn(
            `[Downloader] 파일 다운로드 중 오류 발생 (${attempt}/${MAX_DOWNLOAD_ATTEMPTS}): ${fileName}. ${formatRetryDelay(delayMs)} 후 재시도합니다.`,
            error,
          );
          await wait(delayMs);
          continue;
        }

        if (!res.ok) {
          lastFailure = `HTTP ${res.status} ${res.statusText}`.trim();
          await res.body?.cancel();
          if (!isRetryableDownloadStatus(res.status)) {
            throw new Error(`${fileName} 다운로드 실패: ${lastFailure}`);
          }
          if (attempt >= MAX_DOWNLOAD_ATTEMPTS) break;

          const delayMs = getRetryDelayMs(res, attempt);
          console.warn(
            `[Downloader] 일시적인 이미지 서버 오류 (${attempt}/${MAX_DOWNLOAD_ATTEMPTS}): ${fileName} - ${lastFailure}. ${formatRetryDelay(delayMs)} 후 재시도합니다.`,
          );
          await wait(delayMs);
          continue;
        }

        let imageBuffer: Buffer;
        try {
          const arrayBuffer = await res.arrayBuffer();
          if (arrayBuffer.byteLength === 0) {
            throw new Error("빈 응답을 받았습니다.");
          }
          imageBuffer = Buffer.from(arrayBuffer);
        } catch (error) {
          lastFailure = error instanceof Error ? error.message : String(error);
          if (attempt >= MAX_DOWNLOAD_ATTEMPTS) break;
          const delayMs = getRetryDelayMs(undefined, attempt);
          console.warn(
            `[Downloader] 이미지 전송 중 오류 (${attempt}/${MAX_DOWNLOAD_ATTEMPTS}): ${fileName} - ${lastFailure}. ${formatRetryDelay(delayMs)} 후 재시도합니다.`,
          );
          await wait(delayMs);
          continue;
        }
        await fs.writeFile(filePath, imageBuffer);
        success = true;
      }

      if (!success) {
        throw new Error(
          `${fileName} 다운로드를 ${MAX_DOWNLOAD_ATTEMPTS}회 시도했지만 실패했습니다: ${lastFailure}`,
        );
      }

      // 연속 요청으로 이미지 CDN의 일시 제한에 걸리지 않도록 간격을 둡니다.
      await wait(INTER_FILE_DELAY_MS);

      const progress = Math.round(((i + 1) / totalFiles) * 100);
      webContents.send("download-progress", {
        galleryId,
        status: "progress",
        progress,
      });

      // 큐 ID가 있으면 DB 업데이트
      if (queueId) {
        const db = (await import("../db/index.js")).default;
        await db("DownloadQueue")
          .where("id", queueId)
          .update({
            progress,
            downloaded_files: i + 1,
          });

        // 모든 윈도우에 큐 업데이트 알림
        const { BrowserWindow } = await import("electron");
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((window) => {
          window.webContents.send("download-queue-updated");
        });
      }
    }

    // info.txt 파일 생성 (설정에 따라)
    const createInfoTxtFile = configStore.get("createInfoTxtFile", true);
    if (createInfoTxtFile) {
      const infoFilePath = path.join(galleryDownloadPath, "info.txt");
      const infoContent = [
        `갤러리 넘버: ${gallery.id}`,
        `\n제목: ${gallery.title.display}`,
        `\n작가: ${gallery.artists.map((tag) => tag.name).join(", ") || "N/A"}`,
        `\n그룹: ${gallery.groups.map((tag) => tag.name).join(", ") || "N/A"}`,
        `\n타입: ${gallery.type || "N/A"}`,
        `\n시리즈: ${gallery.series.map((tag) => tag.name).join(", ") || "N/A"}`,
        `\n캐릭터: ${gallery.characters.map((tag) => tag.name).join(", ") || "N/A"}`,
        `\n태그: ${gallery.tags?.map((t) => (t.type === "male" || t.type === "female" ? `${t.type}:${t.name}` : t.name)).join(", ") || "N/A"}`,
        `\n언어: ${gallery.language?.name || "N/A"}`,
      ].join("\n");

      await fs.writeFile(infoFilePath, infoContent);
    }

    if (compressDownload) {
      webContents.send("download-progress", {
        galleryId,
        status: "compressing",
        progress: 100,
      });
      await createDownloadArchive(galleryDownloadPath, archiveFilePath);

      // 원본 폴더 삭제
      await fs.rm(galleryDownloadPath, { recursive: true, force: true });
    }

    if (!stagingJobPath) {
      webContents.send("download-progress", {
        galleryId,
        status: "finalizing",
        progress: 100,
      });
    }

    // 다운로드된 폴더/파일이 라이브러리 폴더에 포함되는지 확인
    // 압축된 경우 압축 파일 경로로, 아닌 경우 폴더 경로로 스캔
    const scanPath = compressDownload
      ? `${galleryDownloadPath}.${compressFormat}`
      : galleryDownloadPath;
    if (stagingJobPath) {
      webContents.send("download-progress", {
        galleryId,
        status: "transferring",
        progress: 100,
      });
      return {
        success: true,
        transfer: {
          galleryId,
          stagedPath: scanPath,
          finalPath: compressDownload ? finalArchiveFilePath : finalGalleryPath,
          stagingJobPath,
          libraryFolders,
          downloadedMetadata,
        } satisfies PreparedDownloadTransfer,
      };
    }
    const scanStats = await fs.stat(scanPath);
    if (scanStats.isFile() && scanStats.size === 0) {
      throw new Error("생성된 압축 파일이 비어 있습니다.");
    }

    const isDownloadedToLibrary = libraryFolders.some((folder) =>
      isPathWithinLibraryRoot(scanPath, folder),
    );

    let bookId: number | null = null;
    if (isDownloadedToLibrary) {
      bookId = await scanFile(scanPath, undefined, "soft", downloadedMetadata);
      if (!bookId) {
        throw new Error(
          "파일 다운로드는 완료됐지만 라이브러리 등록에 실패했습니다.",
        );
      }
    }

    webContents.send("download-progress", {
      galleryId,
      status: "completed",
      bookId,
    });

    return { success: true, bookId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error downloading gallery ${galleryId}:`, error);
    webContents.send("download-progress", {
      galleryId,
      status: "failed",
      error: message,
    });
    return { success: false, error: message };
  }
};

function isRetryableDownloadStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function getRetryDelayMs(
  response: Response | undefined,
  attempt: number,
): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.min(
        Math.max(retryAt - Date.now(), MIN_RETRY_DELAY_MS),
        MAX_RETRY_DELAY_MS,
      );
    }
  }

  return Math.min(
    MIN_RETRY_DELAY_MS * 2 ** Math.max(attempt - 1, 0),
    MAX_RETRY_DELAY_MS,
  );
}

function formatRetryDelay(delayMs: number): string {
  return `${Math.max(1, Math.ceil(delayMs / 1000))}초`;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

const MAX_DOWNLOAD_ATTEMPTS = 8;
const MIN_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const INTER_FILE_DELAY_MS = 200;

export const handleDownloadTempThumbnail = async ({
  url,
  referer,
  galleryId,
}: {
  url: string;
  referer: string;
  galleryId: number;
}) => {
  try {
    const tempDir = path.join(
      app.getPath("userData"),
      "downloader_temp_thumbnails",
    );
    await fs.mkdir(tempDir, { recursive: true });

    const fileName = `${galleryId}_${path.basename(new URL(url).pathname)}`;
    const filePath = path.join(tempDir, fileName);

    // 파일이 이미 존재하면 바로 경로를 반환
    try {
      await fs.access(filePath);
      return {
        success: true,
        data: `doujin-menu://download-thumbnail/${encodeURIComponent(fileName)}`,
      };
    } catch {
      // 파일이 없으면 다운로드 계속
    }

    const res = await fetch(url, {
      headers: {
        Referer: referer,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download ${url}: ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));

    return {
      success: true,
      data: `doujin-menu://download-thumbnail/${encodeURIComponent(fileName)}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error downloading temp thumbnail for ${url}:`, error);
    return { success: false, error: message };
  }
};

/**
 * 다운로더 관련 IPC 통신 핸들러를 등록합니다.
 */
export async function registerDownloaderHandlers() {
  ipcMain.handle("get-download-staging-path", () =>
    getDownloadStagingRoot(app.getPath("temp")),
  );
  // 작품 검색 핸들러
  ipcMain.handle("search-galleries", (_event, params) =>
    handleSearchGalleries(params),
  );
  // 작품 상세 정보 조회 핸들러
  ipcMain.handle("get-gallery-details", (_event, galleryId) =>
    handleGetGalleryDetails(galleryId),
  );
  // 갤러리 이미지 URL 목록 조회 핸들러
  ipcMain.handle("get-gallery-image-urls", (_event, galleryId) =>
    handleGetGalleryImageUrls(galleryId),
  );
  // 임시 썸네일 다운로드 핸들러
  ipcMain.handle("download-temp-thumbnail", (_event, params) =>
    handleDownloadTempThumbnail(params),
  );
}
