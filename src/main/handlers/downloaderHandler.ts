import archiver from "archiver";
import { app, ipcMain } from "electron";
import { filenamifyPath } from "filenamify";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { pathToFileURL } from "url";
import { console } from "../main.js";
import { hitomiService } from "../services/hitomi/hitomiService.js";
import { formatDownloadFolderName } from "../utils/index.js";
import { store as configStore } from "./configHandler.js";
import { scanFile } from "./directoryHandler.js";

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

    const downloadPattern = configStore.get(
      "downloadPattern",
      "%artist% - %title%",
    );
    let galleryFolderName = formatDownloadFolderName(gallery, downloadPattern);

    // Windows MAX_PATH 제한(260자)을 고려한 전체 경로 길이 검증
    // 파일명을 위한 여유 공간 확보 (예: "000001.webp" = 12자)
    const MAX_SAFE_PATH_LENGTH = 245; // 260 - 30 (파일명 + 여유)
    let tempPath = path.join(downloadPath, galleryFolderName);

    // 전체 경로가 너무 길면 폴더명을 줄임
    if (tempPath.length > MAX_SAFE_PATH_LENGTH) {
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

      tempPath = path.join(downloadPath, galleryFolderName);
    }

    // 예약 문자 처리
    const galleryDownloadPath = filenamifyPath(tempPath, {
      replacement: "_",
    });

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
      const fileName = `${String(file.index + 1).padStart(6, "0")}.${fileExt}`;
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

        // 이미지 서버 구성이 갱신될 수 있으므로 매 시도마다 URL을 다시 계산합니다.
        const fullImageUrl = hitomiService.resolveImageUrl(file);
        let res: Response;
        try {
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

        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          await fs.writeFile(filePath, Buffer.from(arrayBuffer));
          success = true;
          break;
        }

        lastFailure = `HTTP ${res.status} ${res.statusText}`.trim();
        await res.body?.cancel();
        if (!isRetryableDownloadStatus(res.status)) {
          throw new Error(`${fileName} 다운로드 실패: ${lastFailure}`);
        }
        if (attempt >= MAX_DOWNLOAD_ATTEMPTS) break;

        if (res.status === 503 && attempt % 2 === 0) {
          await hitomiService.synchronizeImageResolver().catch((error) => {
            console.warn("[Downloader] 이미지 서버 정보 갱신 실패:", error);
          });
        }

        const delayMs = getRetryDelayMs(res, attempt);
        console.warn(
          `[Downloader] 일시적인 이미지 서버 오류 (${attempt}/${MAX_DOWNLOAD_ATTEMPTS}): ${fileName} - ${lastFailure}. ${formatRetryDelay(delayMs)} 후 재시도합니다.`,
        );
        await wait(delayMs);
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
      const existingUuid = await fs
        .readFile(infoFilePath, "utf-8")
        .then((content) =>
          content.match(/^(?:UUID|고유 UUID):\s*(\S+)/im)?.[1],
        )
        .catch(() => undefined);
      const infoContent = [
        `갤러리 넘버: ${gallery.id}`,
        `\nUUID: ${existingUuid || randomUUID()}`,
        `\n제목: ${gallery.title.display}`,
        `\n작가: ${gallery.artists?.join(", ") || "N/A"}`,
        `\n그룹: ${gallery.groups?.join(", ") || "N/A"}`,
        `\n타입: ${gallery.type || "N/A"}`,
        `\n시리즈: ${gallery.series?.join(", ") || "N/A"}`,
        `\n캐릭터: ${gallery.characters?.join(", ") || "N/A"}`,
        `\n태그: ${gallery.tags?.map((t) => (t.type === "male" || t.type === "female" ? `${t.type}:${t.name}` : t.name)).join(", ") || "N/A"}`,
        `\n언어: ${gallery.languageName?.english || "N/A"}`,
      ].join("\n");

      await fs.writeFile(infoFilePath, infoContent);
    }

    // 압축 설정 확인 및 처리
    const compressDownload = configStore.get("compressDownload", false);
    const compressFormat = configStore.get("compressFormat", "cbz");

    if (compressDownload) {
      // 압축 파일 경로 생성
      const archiveFilePath = `${galleryDownloadPath}.${compressFormat}`;

      // 압축 스트림 생성
      const output = createWriteStream(archiveFilePath);
      const archive = archiver("zip", {
        zlib: { level: 0 }, // 압축률 0 (무압축, 속도 우선)
      });

      // 에러 핸들링
      archive.on("error", (err) => {
        throw err;
      });

      // 스트림 연결
      archive.pipe(output);

      // 폴더 내 모든 파일 추가
      archive.directory(galleryDownloadPath, false);

      // 압축 완료
      await archive.finalize();

      // 압축 완료 대기
      await new Promise<void>((resolve, reject) => {
        output.on("close", () => resolve());
        output.on("error", (err) => reject(err));
      });

      // 원본 폴더 삭제
      await fs.rm(galleryDownloadPath, { recursive: true, force: true });
    }

    webContents.send("download-progress", {
      galleryId,
      status: "completed",
    });

    // 다운로드된 폴더/파일이 라이브러리 폴더에 포함되는지 확인
    const libraryFolders = configStore.get("libraryFolders", []);

    // 압축된 경우 압축 파일 경로로, 아닌 경우 폴더 경로로 스캔
    const scanPath = compressDownload
      ? `${galleryDownloadPath}.${compressFormat}`
      : galleryDownloadPath;

    const isDownloadedToLibrary = libraryFolders.some((folder) =>
      scanPath.startsWith(folder),
    );

    if (isDownloadedToLibrary) {
      await scanFile(scanPath);
    }

    return { success: true };
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

function getRetryDelayMs(response: Response | undefined, attempt: number): number {
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
      return { success: true, data: pathToFileURL(filePath).href };
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

    return { success: true, data: pathToFileURL(filePath).href };
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
  await hitomiService.synchronizeImageResolver();
  hitomiService.startImageResolverSynchronization();

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
  // 작품 다운로드 핸들러
  ipcMain.handle("download-gallery", (event, params) =>
    handleDownloadGallery(event, params),
  );
  // 임시 썸네일 다운로드 핸들러
  ipcMain.handle("download-temp-thumbnail", (_event, params) =>
    handleDownloadTempThumbnail(params),
  );
}
