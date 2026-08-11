import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { app, ipcMain, shell } from "electron";
import fg from "fast-glob";
import { spawn } from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { hitomiService } from "../services/hitomi/hitomiService.js";
import * as yauzl from "yauzl";
import db from "../db/index.js";
import { naturalSort } from "../utils/index.js";
import { console } from "../main.js";
import { store as configStore } from "./configHandler.js";
import {
  clearInactiveDownloadStaging,
  getDownloadStagingRoot,
} from "../utils/downloadStaging.js";

const ALLOWED_EXTERNAL_HOSTS = new Set([
  "forms.gle",
  "github.com",
  "tweakcn.com",
  "www.dlsite.com",
]);

export async function openAllowedExternalUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)
    ) {
      return false;
    }
    await shell.openExternal(parsed.toString());
    return true;
  } catch {
    return false;
  }
}

export async function getDirSize(dirPath: string): Promise<number> {
  try {
    const stats = await fs.lstat(dirPath).catch(() => null);
    if (!stats) {
      return 0;
    }
    if (!stats.isDirectory()) {
      return stats.size;
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map((entry) => {
        const fullPath = path.join(dirPath, entry.name);
        return getDirSize(fullPath);
      }),
    );

    return sizes.reduce((acc, size) => acc + size, 0);
  } catch (error) {
    console.error(`Error calculating size for ${dirPath}:`, error);
    return 0;
  }
}

export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) {
    return "0 Bytes";
  }
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(dm)} ${sizes[i]}`;
}

const TEMP_FILE_LOCATIONS = [
  {
    key: "downloader_temp_thumbnails",
    label: "다운로더 미리보기",
    description: "검색 결과와 다운로드 미리보기용 썸네일 캐시",
  },
  {
    key: "temp_cover",
    label: "표지 추출",
    description: "압축 파일에서 썸네일을 만들 때 추출한 임시 표지",
  },
  {
    key: "temp_external",
    label: "외부 뷰어",
    description: "외부 이미지 뷰어로 열기 위해 압축에서 꺼낸 임시 파일",
  },
] as const;

const HDD_DOWNLOAD_TEMP_LOCATION = {
  key: "hdd_downloads",
  label: "HDD 다운로드 임시 파일",
  description: "HDD 모드 다운로드 작업 파일",
} as const;

export async function getTempFilesSummary(
  userDataPath = app.getPath("userData"),
  tempPath = app.getPath("temp"),
) {
  const locationDefinitions = [
    ...TEMP_FILE_LOCATIONS.map(({ key, label, description }) => ({
      key,
      label,
      description,
      path: path.join(userDataPath, key),
    })),
    {
      ...HDD_DOWNLOAD_TEMP_LOCATION,
      path: getDownloadStagingRoot(tempPath),
    },
  ];
  const locations = await Promise.all(
    locationDefinitions.map(
      async ({ key, label, description, path: locationPath }) => {
        const bytes = await getDirSize(locationPath);
        return {
          key,
          label,
          description,
          path: locationPath,
          size: formatBytes(bytes),
          bytes,
        };
      },
    ),
  );
  const totalBytes = locations.reduce((total, location) => {
    return total + location.bytes;
  }, 0);
  return { total: formatBytes(totalBytes), locations };
}

export async function clearTempFiles(
  userDataPath = app.getPath("userData"),
  tempPath = app.getPath("temp"),
) {
  const paths = [
    ...TEMP_FILE_LOCATIONS.map(({ key }) => path.join(userDataPath, key)),
  ];
  await Promise.all([
    clearInactiveDownloadStaging(tempPath),
    ...paths.map((locationPath) =>
      fs.rm(locationPath, { recursive: true, force: true }),
    ),
  ]);
}

async function handleGenerateMissingInfoFiles(
  event: IpcMainInvokeEvent,
  pattern: string,
) {
  const libraryFolders = configStore.get("libraryFolders", []);
  if (!libraryFolders.length) {
    return {
      success: true,
      data: { createdCount: 0, skippedCount: 0, errorCount: 0 },
      message: "라이브러리 폴더가 설정되지 않았습니다.",
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (e) {
    return {
      success: false,
      message: `잘못된 정규식입니다: ${(e as Error).message}`,
      data: { createdCount: 0, skippedCount: 0, errorCount: 0 },
    };
  }

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let processedCount = 0;

  // 1. fast-glob로 모든 하위 폴더 찾기 (중첩 폴더 포함)
  const allFolders: string[] = [];
  for (const folderPath of libraryFolders) {
    try {
      const folders = await fg(["**/*"], {
        cwd: folderPath,
        absolute: true,
        onlyDirectories: true,
        deep: 100,
      });
      allFolders.push(...folders);
    } catch (error) {
      console.error(
        `Error scanning library folder ${folderPath} with fast-glob:`,
        error,
      );
    }
  }

  const totalFolders = allFolders.length;

  event.sender.send("info-generation-progress", {
    total: totalFolders,
    current: 0,
    message: "작업을 시작합니다...",
  });

  // 2. 각 폴더에 대해 info.txt 생성
  for (const subfolderPath of allFolders) {
    processedCount++;
    const folderName = path.basename(subfolderPath);
    const infoFilePath = path.join(subfolderPath, "info.txt");
    let statusMessage = "";

    try {
      await fs.access(infoFilePath);
      statusMessage = `건너뜀 (파일 있음): ${folderName}`;
      skippedCount++;
    } catch {
      // info.txt가 없는 경우
      const match = RegExp(regex).exec(folderName);
      if (match?.[1]) {
        const galleryId = parseInt(match[1], 10);
        try {
          const gallery = await hitomiService.getGallery(galleryId);
          if (gallery) {
            const infoContent = [
              `갤러리 넘버: ${gallery.id}`,
              `제목: ${gallery.title.display}`,
              `작가: ${gallery.artists.map((tag) => tag.name).join(", ") || "N/A"}`,
              `그룹: ${gallery.groups.map((tag) => tag.name).join(", ") || "N/A"}`,
              `타입: ${gallery.type || "N/A"}`,
              `시리즈: ${gallery.series.map((tag) => tag.name).join(", ") || "N/A"}`,
              `캐릭터: ${gallery.characters.map((tag) => tag.name).join(", ") || "N/A"}`,
              `태그: ${
                gallery.tags
                  ?.map((t) =>
                    t.type === "male" || t.type === "female"
                      ? `${t.type}:${t.name}`
                      : t.name,
                  )
                  .join(", ") || "N/A"
              }`,
              `언어: ${gallery.language?.name || "N/A"}`,
            ].join("\n\n");

            await fs.writeFile(infoFilePath, infoContent);
            statusMessage = `생성 완료: ${folderName}`;
            createdCount++;
          } else {
            statusMessage = `오류 (갤러리 없음): ${folderName}`;
            errorCount++;
          }
        } catch (error) {
          console.error(
            `Error fetching gallery info for ID ${galleryId}`,
            error,
          );
          statusMessage = `오류 (정보 조회 실패): ${folderName}`;
          errorCount++;
        }
      } else {
        statusMessage = `건너뜀 (패턴 불일치): ${folderName}`;
        skippedCount++;
      }
    }

    event.sender.send("info-generation-progress", {
      total: totalFolders,
      current: processedCount,
      message: statusMessage,
    });
  }

  const finalMessage = `작업 완료: ${createdCount}개 생성, ${skippedCount}개 건너뜀, ${errorCount}개 오류`;
  event.sender.send("info-generation-progress", {
    total: totalFolders,
    current: totalFolders,
    message: finalMessage,
  });

  return {
    success: true,
    data: { createdCount, skippedCount, errorCount },
    message: finalMessage,
  };
}

/**
 * '기타' 기능 관련 IPC 핸들러를 등록합니다.
 * @param win Electron BrowserWindow 인스턴스
 */
export function registerEtcHandlers(win: BrowserWindow) {
  // 앱 버전 반환
  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  // 개발자 도구 토글
  ipcMain.on("toggle-dev-tools", () => {
    win.webContents.toggleDevTools();
  });

  // 외부 링크 열기
  ipcMain.on("open-external-link", (_event, url: string) => {
    void openAllowedExternalUrl(url);
  });

  // 로그 폴더 열기
  ipcMain.on("open-log-folder", () => {
    const logPath = app.getPath("logs");
    shell.openPath(logPath);
  });

  ipcMain.handle("get-temp-files-size", async () => {
    try {
      const summary = await getTempFilesSummary();
      return {
        success: true,
        data: summary.total,
        locations: summary.locations,
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("clear-temp-files", async () => {
    try {
      await clearTempFiles();

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("generate-missing-info-files", (event, pattern: string) =>
    handleGenerateMissingInfoFiles(event, pattern),
  );

  ipcMain.handle(
    "open-with-external-program",
    async (
      _event,
      { bookId, pageIndex }: { bookId: number; pageIndex: number },
    ) => {
      try {
        // 설정에서 프로그램 경로 가져오기
        const programPath = configStore.get("externalImageViewerPath", "");
        if (!programPath) {
          return {
            success: false,
            error: "외부 프로그램이 설정되지 않았습니다.",
          };
        }
        if (!existsSync(programPath)) {
          return { success: false, error: "프로그램을 찾을 수 없습니다." };
        }

        // 책 정보 조회
        const book = await db("Book").where("id", bookId).first();
        if (!book || !book.path) {
          return { success: false, error: "책을 찾을 수 없습니다." };
        }

        const bookPath = book.path;
        let imagePath: string;

        // 폴더 형식인 경우
        const isDirectory = await fs
          .stat(bookPath)
          .then((stat) => stat.isDirectory())
          .catch(() => false);

        if (isDirectory) {
          const files = await fs.readdir(bookPath);
          const imageFiles = files
            .filter((file) =>
              file.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i),
            )
            .sort(naturalSort);

          if (pageIndex < 0 || pageIndex >= imageFiles.length) {
            return { success: false, error: "페이지를 찾을 수 없습니다." };
          }
          imagePath = path.join(bookPath, imageFiles[pageIndex]);
        } else if (/\.(cbz|zip)$/i.exec(bookPath)) {
          // ZIP/CBZ 형식인 경우: 임시 파일로 추출
          imagePath = await extractPageFromZip(bookPath, bookId, pageIndex);
        } else {
          return { success: false, error: "지원하지 않는 형식입니다." };
        }

        // 외부 프로그램 실행 (fire-and-forget)
        const child = spawn(programPath, [imagePath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        return { success: true };
      } catch (error) {
        console.error("[EtcHandler] 외부 프로그램 실행 실패:", error);
        return { success: false, error: (error as Error).message };
      }
    },
  );

  ipcMain.handle(
    "open-book-with-external-viewer",
    async (_event, { bookId }: { bookId: number }) => {
      try {
        const book = await db("Book").where("id", bookId).first();
        if (!book || !book.path) {
          return { success: false, error: "책을 찾을 수 없습니다." };
        }

        const bookPath = book.path;
        const isDirectory = await fs
          .stat(bookPath)
          .then((stat) => stat.isDirectory())
          .catch(() => false);
        const isArchive = /\.(cbz|zip)$/i.test(bookPath);

        let programPath: string;
        let targetPath: string;

        if (isArchive) {
          // 압축 파일인 경우 압축파일 뷰어로 실행
          programPath = configStore.get("externalArchiveViewerPath", "");
          if (!programPath) {
            return {
              success: false,
              error: "압축파일 뷰어가 설정되지 않았습니다.",
            };
          }
          targetPath = bookPath;
        } else if (isDirectory) {
          // 폴더인 경우 이미지 뷰어로 첫 번째 이미지 파일 실행
          programPath = configStore.get("externalImageViewerPath", "");
          if (!programPath) {
            return {
              success: false,
              error: "이미지 뷰어가 설정되지 않았습니다.",
            };
          }
          const files = await fs.readdir(bookPath);
          const imageFiles = files
            .filter((file) =>
              file.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i),
            )
            .sort(naturalSort);
          if (imageFiles.length === 0) {
            return { success: false, error: "이미지 파일을 찾을 수 없습니다." };
          }
          targetPath = path.join(bookPath, imageFiles[0]);
        } else {
          return { success: false, error: "지원하지 않는 형식입니다." };
        }

        if (!existsSync(programPath)) {
          return { success: false, error: "프로그램을 찾을 수 없습니다." };
        }

        // 외부 뷰어 실행 (fire-and-forget)
        const child = spawn(programPath, [targetPath], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        return { success: true };
      } catch (error) {
        console.error("[EtcHandler] 외부 프로그램 실행 실패:", error);
        return { success: false, error: (error as Error).message };
      }
    },
  );
}

/**
 * ZIP/CBZ에서 특정 페이지를 임시 파일로 추출
 */
function extractPageFromZip(
  zipPath: string,
  bookId: number,
  pageIndex: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (err, zipfile) => {
        if (err) return reject(new Error("ZIP 파일을 열 수 없습니다."));

        const imageEntries: { fileName: string; entry: yauzl.Entry }[] = [];
        zipfile.on("entry", (entry) => {
          if (!entry.fileName.endsWith("/")) {
            const ext = path.extname(entry.fileName).toLowerCase();
            if (
              [
                ".jpg",
                ".jpeg",
                ".png",
                ".webp",
                ".gif",
                ".bmp",
                ".avif",
              ].includes(ext)
            ) {
              imageEntries.push({ fileName: entry.fileName, entry });
            }
          }
          zipfile.readEntry();
        });

        zipfile.on("end", async () => {
          imageEntries.sort((a, b) => naturalSort(a.fileName, b.fileName));

          if (pageIndex < 0 || pageIndex >= imageEntries.length) {
            zipfile.close();
            return reject(new Error("페이지를 찾을 수 없습니다."));
          }

          const targetEntry = imageEntries[pageIndex];
          const ext = path.extname(targetEntry.fileName).toLowerCase();
          const tempDir = path.join(app.getPath("userData"), "temp_external");
          await fs.mkdir(tempDir, { recursive: true });
          const tempFilePath = path.join(
            tempDir,
            `${bookId}_${pageIndex}${ext}`,
          );

          // 이미 추출된 파일이 있으면 재사용
          if (existsSync(tempFilePath)) {
            zipfile.close();
            return resolve(tempFilePath);
          }

          zipfile.openReadStream(targetEntry.entry, (streamErr, readStream) => {
            if (streamErr) {
              zipfile.close();
              return reject(new Error("이미지 추출에 실패했습니다."));
            }

            const chunks: Buffer[] = [];
            readStream.on("data", (chunk) => chunks.push(chunk));
            readStream.on("end", async () => {
              zipfile.close();
              try {
                await fs.writeFile(tempFilePath, Buffer.concat(chunks));
                resolve(tempFilePath);
              } catch {
                reject(new Error("임시 파일 저장에 실패했습니다."));
              }
            });
            readStream.on("error", () => {
              zipfile.close();
              reject(new Error("이미지 스트림 읽기 실패"));
            });
          });
        });

        zipfile.on("error", () => {
          zipfile.close();
          reject(new Error("ZIP 파일 읽기 오류"));
        });

        zipfile.readEntry();
      },
    );
  });
}
