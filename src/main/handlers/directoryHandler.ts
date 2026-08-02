import { BrowserWindow, dialog, ipcMain } from "electron";
import fg from "fast-glob";
import * as fsSync from "fs";
import fs from "fs/promises";
import type { Knex } from "knex";
import os from "os"; // os 모듈 임포트
import PQueue from "p-queue"; // p-queue 임포트
import path from "path";
import yauzl from "yauzl";
import db from "../db/index.js";
import { Book } from "../db/types.js";
import { console } from "../main.js";
import { ParsedMetadata, parseInfoTxt } from "../parsers/infoTxtParser.js";
import type { LibraryScanProgress } from "../../types/ipc.js";
import { naturalSort } from "../utils/index.js";
import { filterLibraryPathRows } from "../utils/libraryPath.js";
import { notifyCompanionLibraryChanged } from "../services/companion/companionSyncSignal.js";
import {
  generateThumbnailForBook,
  handleGenerateThumbnail,
} from "./thumbnailHandler.js"; // 썸네일 생성 함수 임포트

// Windows MAX_PATH 제한
const MAX_PATH_LENGTH = 260;

// 진행률 브로드캐스트 쓰로틀링을 위한 변수
let lastProgressBroadcastTime = 0;
const PROGRESS_BROADCAST_INTERVAL = 100; // 100ms 간격으로 쓰로틀링

// 진행률 브로드캐스트 함수
function broadcastScanProgress(progress: LibraryScanProgress) {
  const now = Date.now();
  // 쓰로틀링: 마지막 전송 후 PROGRESS_BROADCAST_INTERVAL이 지나지 않았으면 전송하지 않음
  // 단, 완료(phase: 'completed')나 시작(phase: 'counting') 단계는 즉시 전송
  if (
    now - lastProgressBroadcastTime < PROGRESS_BROADCAST_INTERVAL &&
    progress.phase !== "completed" &&
    progress.phase !== "counting"
  ) {
    return;
  }
  lastProgressBroadcastTime = now;

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("library-scan-progress", progress);
  });
}

export function cleanValue(value: string | null | undefined): string | null {
  if (value === "N/A" || value === undefined || value === null) {
    return null;
  }
  return value;
}

// ZIP/CBZ 파일의 증분 스캔 캐시 hit 여부를 판정한다.
// 저장된 mtime/size가 현재 파일의 값과 모두 같으면 true → 재스캔을 건너뛴다.
// 캐시가 없거나 아직 구축되지 않은(null) 경우엔 항상 false(처리 필요)를 반환한다.
export function isZipUnchanged(
  cached:
    | { file_mtime: number | null; file_size: number | null }
    | null
    | undefined,
  mtime: number,
  size: number,
): boolean {
  if (!cached) return false;
  if (cached.file_mtime == null || cached.file_size == null) return false;
  return cached.file_mtime === mtime && cached.file_size === size;
}

// 증분 스캔용 ZIP/CBZ 캐시 맵을 DB에서 로드한다.
// 경로 구분자를 역슬래시로 정규화하여 저장된 path(역슬래시)와 매칭시킨다.
async function loadZipScanCache(directoryPath: string): Promise<
  Map<
    string,
    {
      file_mtime: number | null;
      file_size: number | null;
      sync_id: string | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      file_mtime: number | null;
      file_size: number | null;
      sync_id: string | null;
    }
  >();
  const normalizedDir = directoryPath.replaceAll("/", "\\");
  const rows = await db("Book")
    .select("path", "file_mtime", "file_size", "sync_id")
    .whereLike("path", `${normalizedDir}%`);
  for (const row of rows) {
    map.set(row.path, {
      file_mtime: row.file_mtime,
      file_size: row.file_size,
      sync_id: row.sync_id,
    });
  }
  return map;
}

export async function extractCoverFromZip(
  zipPath: string,
  outputPath: string,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        console.error(`[Main] ZIP 파일 열기 오류 ${zipPath}:`, err);
        return reject(err);
      }

      let foundImageAndStartedExtraction = false; // 이미지를 찾고 추출을 시작했는지 여부 플래그

      zipfile.readEntry(); // 엔트리 읽기 시작

      zipfile.on("entry", (entry) => {
        const isImage = entry.fileName.match(/\.(jpg|jpeg|png|webp)$/i);

        if (isImage && !foundImageAndStartedExtraction) {
          foundImageAndStartedExtraction = true; // 플래그 설정
          // 첫 번째 이미지 파일을 찾으면 바로 추출 시작
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              console.error(
                `[Main] ZIP에서 엔트리 읽기 오류 ${entry.fileName}:`,
                err,
              );
              zipfile.close(); // 오류 발생 시 파일 닫기
              return reject(err);
            }
            const writeStream = fsSync.createWriteStream(outputPath);
            readStream.pipe(writeStream);
            writeStream.on("finish", () => {
              console.log(
                `[Main] ZIP에서 커버 추출 성공: ${outputPath} (from ${entry.fileName})`,
              );
              zipfile.close(); // 추출 완료 후 파일 닫기
              resolve(outputPath);
            });
            writeStream.on("error", (writeErr) => {
              console.error(
                `[Main] 추출된 ZIP 커버 쓰기 오류 ${outputPath}:`,
                writeErr,
              );
              zipfile.close(); // 오류 발생 시 파일 닫기
              reject(writeErr);
            });
          });
        } else {
          // 이미지를 찾지 못했거나 이미 추출을 시작한 경우 다음 엔트리 읽기
          zipfile.readEntry();
        }
      });

      zipfile.on("end", () => {
        // 모든 엔트리를 스캔했지만 적합한 커버 이미지를 찾지 못한 경우
        if (!foundImageAndStartedExtraction) {
          console.log(
            `[Main] ${zipPath}의 ZIP 엔트리 스캔 완료. 적합한 커버 이미지를 찾지 못했습니다.`,
          );
          zipfile.close(); // 파일 닫기
          resolve(null);
        }
      });

      zipfile.on("error", (zipErr) => {
        console.error(`[Main] ZIP 파일 처리 중 오류 ${zipPath}:`, zipErr);
        zipfile.close(); // 오류 발생 시 파일 닫기
        reject(zipErr);
      });
    });
  });
}

// ZIP 파일을 한 번 열어 info.txt 내용과 이미지 개수를 단일 엔트리 순회로 동시에 수집한다.
export async function extractInfoTxtAndImageCountFromZip(
  zipPath: string,
): Promise<{ infoTxt: string | null; imageCount: number }> {
  return new Promise((resolve, reject) => {
    let imageCount = 0;
    let infoTxt: string | null = null;
    let infoFound = false; // info.txt 엔트리를 발견했는지 여부
    let infoStreamDone = false; // info.txt 읽기 스트림이 완료(성공/실패)되었는지 여부
    let entriesEnded = false; // 엔트리 순회가 끝났는지 여부
    let resolved = false;
    // zipfile은 open 콜백에서 할당되므로 클로저 외부에서 참조하기 위한 변수
    let openedZipfile: yauzl.ZipFile | null = null;

    // 두 조건(엔트리 순회 종료 + info.txt 처리 완료)이 모두 충족되면 resolve.
    // info.txt가 없는 경우에는 엔트리 순회 종료만으로 충분하다.
    const finish = () => {
      if (resolved) return;
      if (entriesEnded && (infoStreamDone || !infoFound)) {
        resolved = true;
        if (openedZipfile) {
          try {
            openedZipfile.close();
          } catch {
            // 이미 닫혀 있거나 닫기 불가능한 경우 무시
          }
        }
        resolve({ infoTxt, imageCount });
      }
    };

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        console.error(`[Main] ZIP 파일 열기 오류 ${zipPath}:`, err);
        return reject(err);
      }
      openedZipfile = zipfile;

      zipfile.on("entry", (entry) => {
        // 이미지 개수 카운트 (처음부터 끝까지 모든 엔트리 누적)
        if (entry.fileName.match(/\.(jpg|jpeg|png|webp|gif|bmp)$/i)) {
          imageCount++;
        }

        // info.txt를 발견하면 백그라운드로 읽기 시작하고, 순회는 멈추지 않고 계속 진행.
        // 읽기 스트림 완료를 기다리지 않고 바로 다음 엔트리로 넘어간다.
        if (
          path.posix.basename(entry.fileName).toLowerCase() === "info.txt" &&
          !infoFound
        ) {
          infoFound = true;
          console.log(`[Main] ZIP에서 info.txt 발견: ${zipPath}`);
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr) {
              console.error(
                `[Main] ZIP에서 info.txt 읽기 오류 ${zipPath}:`,
                readErr,
              );
              infoStreamDone = true;
              finish();
              return;
            }
            let fileContent = "";
            readStream.on("data", (chunk) => (fileContent += chunk.toString()));
            readStream.on("end", () => {
              infoTxt = fileContent;
              infoStreamDone = true;
              console.log(`[Main] ZIP에서 info.txt 내용 추출 성공: ${zipPath}`);
              finish();
            });
            readStream.on("error", (readErr) => {
              console.error(
                `[Main] ZIP에서 info.txt 스트림 읽기 오류 ${zipPath}:`,
                readErr,
              );
              infoStreamDone = true;
              finish();
            });
          });
        }

        // 다음 엔트리로 진행 (info.txt 읽기 완료와 무관하게 계속 순회)
        zipfile.readEntry();
      });

      zipfile.on("end", () => {
        entriesEnded = true;
        finish();
      });

      zipfile.on("error", (zipErr) => {
        console.error(`[Main] ZIP 파일 처리 중 오류 ${zipPath}:`, zipErr);
        if (!resolved) {
          resolved = true;
          try {
            zipfile.close();
          } catch {
            // 이미 닫혀 있는 경우 무시
          }
          reject(zipErr);
        }
      });

      zipfile.readEntry(); // 엔트리 읽기 시작
    });
  });
}

export const handleSelectFolder = async () => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (filePaths && filePaths.length > 0) {
    return { success: true, path: filePaths[0] };
  } else {
    return { success: false };
  }
};

async function processBookItem(
  itemPath: string,
  {
    isDirectory,
    isFile,
    name,
    file_mtime,
    file_size,
  }: {
    isDirectory: boolean;
    isFile: boolean;
    name: string;
    file_mtime?: number | null;
    file_size?: number | null;
  },
) {
  // 1. 반환할 책 데이터, 커버 경로, 메타데이터 객체를 초기화합니다.
  let bookData: Book | null = null;
  let infoMetadata: ParsedMetadata = {};

  // 2. info.txt 메타데이터를 찾고 파싱합니다.
  // 2-1. 폴더 내부에 있는 info.txt를 먼저 시도합니다.
  const infoTxtPath = path.join(itemPath, "info.txt");
  // 2-2. 폴더와 동일한 이름으로 부모 폴더에 있는 info.txt를 다음으로 시도합니다. (예: 'MyBook/' 폴더 -> '../MyBook.info.txt')
  const parentInfoTxtPath = path.join(
    path.dirname(itemPath),
    `${name}.info.txt`,
  );

  try {
    const stats = await fs.stat(infoTxtPath);
    if (stats.isFile()) {
      infoMetadata = parseInfoTxt(await fs.readFile(infoTxtPath, "utf-8"));
    }
  } catch {
    // info.txt 파일이 없거나 읽을 수 없는 경우 무시하고 다음 단계로 진행합니다.
  }

  // 2-3. 폴더 내 info.txt가 없었을 경우, 부모 폴더의 info.txt를 확인합니다.
  if (Object.keys(infoMetadata).length === 0) {
    try {
      const stats = await fs.stat(parentInfoTxtPath);
      if (stats.isFile()) {
        infoMetadata = parseInfoTxt(
          await fs.readFile(parentInfoTxtPath, "utf-8"),
        );
      }
    } catch {
      // 외부 info.txt 파일이 없거나 읽을 수 없는 경우 무시합니다.
    }
  }

  // 2-4. ZIP 파일의 info.txt는 아래 3-2단계에서 페이지 수와 함께 단일 순회로 추출합니다.

  // 3. 항목 유형(폴더 또는 파일)에 따라 책 데이터를 구성합니다.
  if (isDirectory) {
    // 3-1. 항목이 폴더일 경우
    const imageFiles = (await fs.readdir(itemPath))
      .filter((f) => RegExp(/\.(jpg|jpeg|png|webp)$/i).exec(f))
      .sort(naturalSort); // 이미지 파일 목록을 자연어 정렬합니다.
    if (imageFiles.length > 0) {
      // 이미지가 하나 이상 있을 경우에만 책으로 간주합니다.
      bookData = {
        title: cleanValue(infoMetadata.title) || name, // 메타데이터 제목이 있으면 사용, 없으면 폴더명을 제목으로 사용
        path: itemPath,
        page_count: imageFiles.length,
        // @ts-expect-error string은 아니나 DB 삽입 시 정상 데이터
        added_at: db.fn.now(), // 추가된 시간 기록
        hitomi_id: cleanValue(infoMetadata.hitomi_id) || null,
        type: cleanValue(infoMetadata.type) || null,
        language_name_local: cleanValue(infoMetadata.language) || null,
        sync_id: cleanValue(infoMetadata.uuid),
      };
    }
  } else if (isFile) {
    // 3-2. 항목이 파일일 경우 (ZIP/CBZ)
    const ext = path.extname(name).toLowerCase();
    if (ext === ".cbz" || ext === ".zip") {
      // ZIP을 한 번 열어 info.txt와 이미지 개수를 동시에 수집합니다.
      const { infoTxt: infoTxtContent, imageCount: pageCount } =
        await extractInfoTxtAndImageCountFromZip(itemPath);
      if (infoTxtContent) {
        const archiveMetadata = parseInfoTxt(infoTxtContent);
        infoMetadata = {
          ...infoMetadata,
          ...archiveMetadata,
          uuid: infoMetadata.uuid ?? archiveMetadata.uuid,
        };
      }
      if (pageCount > 0) {
        // 이미지가 하나 이상 있을 경우에만 책으로 간주합니다.
        bookData = {
          title: cleanValue(infoMetadata.title) || path.basename(name, ext), // 메타데이터 제목이 있으면 사용, 없으면 파일명을 제목으로 사용
          path: itemPath,
          page_count: pageCount, // 계산된 페이지 수 사용
          // @ts-expect-error string은 아니나 DB 삽입 시 정상 데이터
          added_at: db.fn.now(),
          hitomi_id: cleanValue(infoMetadata.hitomi_id) || null,
          type: cleanValue(infoMetadata.type) || null,
          language_name_local: cleanValue(infoMetadata.language) || null,
          sync_id: cleanValue(infoMetadata.uuid),
          // 증분 스캔 캐시 키 (다음 스캔에서 이 값이 같으면 재스캔 건너뜀)
          file_mtime: file_mtime ?? null,
          file_size: file_size ?? null,
        };
      } else {
        // 이미지가 없는 ZIP 파일은 건너뜁니다.
        console.log(`[Main] 이미지가 없어 ZIP 파일을 건너뜁니다: ${itemPath}`);
      }
    }
  }

  // 4. 책 데이터가 성공적으로 생성되었는지 확인합니다.
  if (bookData) {
    // 4-1. info.txt에서 파싱한 메타데이터가 있다면, bookData를 최종적으로 업데이트합니다.
    // (폴더명/파일명 기반으로 생성된 기본 제목을 덮어쓸 수 있음)
    if (Object.keys(infoMetadata).length > 0) {
      bookData.title = cleanValue(infoMetadata.title) || bookData.title;
      bookData.hitomi_id =
        cleanValue(infoMetadata.hitomi_id) || bookData.hitomi_id;
      bookData.type = cleanValue(infoMetadata.type) || bookData.type;
      bookData.language_name_local =
        cleanValue(infoMetadata.language) || bookData.language_name_local;
    }

    // 5. 처리된 책 데이터, 메타데이터, 커버 경로를 반환합니다.
    return {
      bookData,
      infoMetadata,
    };
  }

  // 6. 책으로 처리할 수 없는 항목인 경우 null을 반환합니다.
  return null;
}

// 청크 단위로 책을 처리하여 DB에 저장하는 헬퍼 함수
type ExistingScanBook = Pick<
  Book,
  "id" | "path" | "cover_path" | "sync_id" | "is_offline" | "state_version"
>;

async function deleteBookRecords(
  trx: Knex.Transaction,
  books: Pick<Book, "id">[],
) {
  const bookIds = books.map((book) => book.id);
  if (bookIds.length === 0) return;

  for (const table of [
    "BookArtist",
    "BookTag",
    "BookSeries",
    "BookGroup",
    "BookCharacter",
    "BookHistory",
    "CompanionSyncChange",
  ]) {
    await trx(table).whereIn("book_id", bookIds).del();
  }
  await trx("Book").whereIn("id", bookIds).del();
}

async function removeThumbnailFiles(
  books: Pick<Book, "cover_path">[],
): Promise<void> {
  await Promise.all(
    books
      .map((book) => book.cover_path)
      .filter((coverPath): coverPath is string => Boolean(coverPath))
      .map((coverPath) =>
        fs.unlink(coverPath).catch((error) => {
          console.error(`[Main] 썸네일 파일 삭제 실패 ${coverPath}:`, error);
        }),
      ),
  );
}

async function isMissingOnReachableStorage(bookPath: string) {
  if (await isPathAccessible(bookPath)) return false;
  return isPathAccessible(path.parse(bookPath).root);
}

async function resolveExistingBookForScan(
  trx: Knex.Transaction,
  candidates: ExistingScanBook[],
  bookPath: string,
  syncId: string | null | undefined,
  thumbnailRemovals: Pick<Book, "cover_path">[],
) {
  const existingByPath = candidates.find((book) => book.path === bookPath);
  if (!syncId) return existingByPath;

  const sameIdentity = candidates.filter(
    (book) => book.sync_id === syncId && book.path !== bookPath,
  );
  const staleCopies: ExistingScanBook[] = [];
  for (const candidate of sameIdentity) {
    if (await isMissingOnReachableStorage(candidate.path)) {
      staleCopies.push(candidate);
    }
  }

  if (!existingByPath) {
    return staleCopies.reduce<ExistingScanBook | undefined>(
      (best, candidate) =>
        !best ||
        Number(candidate.state_version || 0) > Number(best.state_version || 0)
          ? candidate
          : best,
      undefined,
    );
  }
  if (staleCopies.length === 0) return existingByPath;

  const keep = staleCopies.reduce(
    (best, candidate) =>
      Number(candidate.state_version || 0) > Number(best.state_version || 0)
        ? candidate
        : best,
    existingByPath,
  );
  const remove = [existingByPath, ...staleCopies].filter(
    (candidate) => candidate.id !== keep.id,
  );
  const removeIds = remove.map((candidate) => candidate.id);

  await trx("BookHistory").whereIn("book_id", removeIds).update({
    book_id: keep.id,
  });
  await trx("CompanionSyncChange").whereIn("book_id", removeIds).update({
    book_id: keep.id,
  });
  await deleteBookRecords(trx, remove);
  thumbnailRemovals.push(...remove);
  for (const removed of remove) {
    const index = candidates.findIndex((book) => book.id === removed.id);
    if (index >= 0) candidates.splice(index, 1);
  }
  return keep;
}

async function processBatchInTransaction(
  batch: ProcessedBook[],
  trx: Knex.Transaction,
  claimedSyncIds: Set<string>,
): Promise<{
  added: number;
  updated: number;
  newBookIds: number[];
  thumbnailNeeded: number[];
  thumbnailRemovals: Pick<Book, "cover_path">[];
}> {
  let addedCount = 0;
  let updatedCount = 0;
  const newBookIds: number[] = [];
  const thumbnailNeeded: number[] = [];
  const thumbnailRemovals: Pick<Book, "cover_path">[] = [];

  deduplicateBookSyncIds(batch, claimedSyncIds);

  const batchPaths = batch.map((p) => p.bookData.path);
  const batchSyncIds = batch
    .map((p) => p.bookData.sync_id)
    .filter((id): id is string => Boolean(id));
  const existingBooksInBatch: ExistingScanBook[] = await trx("Book")
    .select(
      "id",
      "path",
      "cover_path",
      "sync_id",
      "is_offline",
      "state_version",
    )
    .where((query) => {
      query.whereIn("path", batchPaths);
      if (batchSyncIds.length > 0) query.orWhereIn("sync_id", batchSyncIds);
    });

  for (const processedBook of batch) {
    const { bookData, infoMetadata } = processedBook;
    const existingBook = await resolveExistingBookForScan(
      trx,
      existingBooksInBatch,
      bookData.path,
      bookData.sync_id,
      thumbnailRemovals,
    );

    let bookId: number;
    if (existingBook) {
      bookId = existingBook.id;
      await trx("Book")
        .where("id", bookId)
        .update({
          title: cleanValue(bookData.title),
          path: bookData.path,
          page_count: bookData.page_count,
          hitomi_id: cleanValue(bookData.hitomi_id),
          type: cleanValue(bookData.type),
          language_name_english: cleanValue(bookData.language_name_english),
          language_name_local: cleanValue(bookData.language_name_local),
          file_mtime: bookData.file_mtime ?? null,
          file_size: bookData.file_size ?? null,
          is_offline: false,
        });
      existingBook.path = bookData.path;
      existingBook.is_offline = false;
      updatedCount++;

      // 업데이트를 위해 기존 연결 제거
      await trx("BookArtist").where("book_id", bookId).del();
      await trx("BookTag").where("book_id", bookId).del();
      await trx("BookSeries").where("book_id", bookId).del();
      await trx("BookGroup").where("book_id", bookId).del();
      await trx("BookCharacter").where("book_id", bookId).del();
    } else {
      const bookToInsert = {
        title: cleanValue(bookData.title),
        path: bookData.path,
        page_count: bookData.page_count || 0,
        added_at: bookData.added_at,
        hitomi_id: cleanValue(bookData.hitomi_id),
        type: cleanValue(bookData.type),
        language_name_english: cleanValue(bookData.language_name_english),
        language_name_local: cleanValue(bookData.language_name_local),
        sync_id: cleanValue(bookData.sync_id),
        file_mtime: bookData.file_mtime ?? null,
        file_size: bookData.file_size ?? null,
      };
      const result = await trx("Book").insert(bookToInsert);
      bookId = result[0];
      existingBooksInBatch.push({
        id: bookId,
        path: bookData.path,
        cover_path: null,
        sync_id: cleanValue(bookData.sync_id),
        is_offline: false,
        state_version: 0,
      });
      addedCount++;
      newBookIds.push(bookId);
    }

    const storedBook = await trx("Book")
      .select("sync_id")
      .where("id", bookId)
      .first();
    if (storedBook?.sync_id) {
      claimedSyncIds.add(storedBook.sync_id);
    }

    // 아티스트 처리
    const artistsToProcess =
      infoMetadata.artists?.map((a) => cleanValue(a.name)).filter(Boolean) ||
      [];
    for (const artistName of artistsToProcess) {
      let artist = await trx("Artist").where("name", artistName).first();
      if (!artist) {
        const [newArtistId] = await trx("Artist").insert({ name: artistName });
        artist = { id: newArtistId, name: artistName };
      }
      await trx("BookArtist").insert({ book_id: bookId, artist_id: artist.id });
    }

    // 그룹 처리
    const groupsToProcess =
      infoMetadata.groups?.map((g) => cleanValue(g.name)).filter(Boolean) || [];
    for (const groupName of groupsToProcess) {
      let group = await trx("Group").where("name", groupName).first();
      if (!group) {
        const [newGroupId] = await trx("Group").insert({ name: groupName });
        group = { id: newGroupId, name: groupName };
      }
      await trx("BookGroup").insert({ book_id: bookId, group_id: group.id });
    }

    // 캐릭터 처리
    const charactersToProcess =
      infoMetadata.characters?.map((c) => cleanValue(c.name)).filter(Boolean) ||
      [];
    for (const characterName of charactersToProcess) {
      let character = await trx("Character")
        .where("name", characterName)
        .first();
      if (!character) {
        const [newCharacterId] = await trx("Character").insert({
          name: characterName,
        });
        character = { id: newCharacterId, name: characterName };
      }
      await trx("BookCharacter").insert({
        book_id: bookId,
        character_id: character.id,
      });
    }

    // 태그 처리
    const tagsToProcess =
      infoMetadata.tags?.map((t) => cleanValue(t.name)).filter(Boolean) || [];
    for (const tagName of tagsToProcess) {
      let tag = await trx("Tag").where("name", tagName).first();
      if (!tag) {
        const [newTagId] = await trx("Tag").insert({ name: tagName });
        tag = { id: newTagId, name: tagName };
      }
      await trx("BookTag").insert({ book_id: bookId, tag_id: tag.id });
    }

    // 시리즈 처리
    if (infoMetadata.series && infoMetadata.series.length > 0) {
      const seriesName = infoMetadata.series[0].name;
      let series = await trx("Series").where("name", seriesName).first();
      if (!series) {
        const [newSeriesId] = await trx("Series").insert({ name: seriesName });
        series = { id: newSeriesId, name: seriesName };
      }
      await trx("BookSeries").insert({ book_id: bookId, series_id: series.id });
    }

    // 썸네일 생성 필요 여부 결정
    const currentBookInDb = existingBooksInBatch.find((b) => b.id === bookId);
    let shouldGenerateThumbnail = false;
    if (!currentBookInDb?.cover_path) {
      shouldGenerateThumbnail = true;
    } else {
      try {
        await fs.access(currentBookInDb.cover_path);
      } catch {
        shouldGenerateThumbnail = true;
        console.warn(
          `[Main] 기존 썸네일 파일을 찾을 수 없어 재생성합니다: Book ID ${bookId}`,
        );
      }
    }

    if (shouldGenerateThumbnail) {
      thumbnailNeeded.push(bookId);
    }
  }

  return {
    added: addedCount,
    updated: updatedCount,
    newBookIds,
    thumbnailNeeded,
    thumbnailRemovals,
  };
}

interface ProcessedBook {
  bookData: Book;
  infoMetadata: ParsedMetadata;
}

export function deduplicateBookSyncIds(
  books: { bookData: Pick<Book, "sync_id"> }[],
  claimedSyncIds: Set<string>,
): void {
  for (const { bookData } of books) {
    const syncId = cleanValue(bookData.sync_id)?.trim().toLowerCase() ?? null;
    if (!syncId) {
      bookData.sync_id = null;
      continue;
    }
    bookData.sync_id = syncId;
    claimedSyncIds.add(syncId);
  }
}

// 라이브러리 루트 폴더 접근 가능 여부 확인
// ENOENT(부재)/EACCES(권한) 등 모든 실패를 "접근 불가"로 보수적으로 처리한다.
export async function isPathAccessible(dirPath: string): Promise<boolean> {
  try {
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
}

// 모든 창에 books-updated를 전파해 라이브러리 화면 쿼리 캐시를 즉시 무효화
function broadcastBooksUpdated() {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("books-updated");
  });
}

// 해당 경로 하위의 모든 책을 오프라인 상태로 표시하고 처리된 개수를 반환
export async function markBooksOfflineUnderPath(
  directoryPath: string,
): Promise<number> {
  const candidates = await db("Book")
    .select("id", "path")
    .where("path", "like", `${directoryPath}%`)
    .where("is_offline", false);
  const bookIds = filterLibraryPathRows(candidates, directoryPath).map(
    (book) => book.id,
  );
  const count =
    bookIds.length > 0
      ? await db("Book").whereIn("id", bookIds).update({ is_offline: true })
      : 0;

  // 화면에 즉시 반영되도록 변경이 있을 때만 브로드캐스트
  if (count > 0) broadcastBooksUpdated();
  return count;
}

// 해당 경로 하위의 모든 오프라인 책을 온라인 상태로 복귀
export async function restoreBooksOnlineUnderPath(
  directoryPath: string,
): Promise<number> {
  const candidates = await db("Book")
    .select("id", "path")
    .where("path", "like", `${directoryPath}%`)
    .where("is_offline", true);
  const bookIds = filterLibraryPathRows(candidates, directoryPath).map(
    (book) => book.id,
  );
  const count =
    bookIds.length > 0
      ? await db("Book").whereIn("id", bookIds).update({ is_offline: false })
      : 0;

  // 화면에 즉시 반영되도록 변경이 있을 때만 브로드캐스트
  if (count > 0) broadcastBooksUpdated();
  return count;
}

// 스캔에서 발견되지 않은 책 정리.
// 스캔 도중 외장하드가 분리된 경우를 대비해 삭제 직전에 루트 접근을 재확인하고,
// 접근 불가 시 삭제 대신 오프라인 마킹한다.
export async function cleanupMissingBooks(
  directoryPath: string,
  foundPaths: Set<string>,
  preserveUnmatchedSyncIds = false,
): Promise<{ deleted: number; offline: boolean }> {
  if (!(await isPathAccessible(directoryPath))) {
    await markBooksOfflineUnderPath(directoryPath);
    console.warn(
      `[Main] 삭제 단계 직전 폴더 접근 불가 감지: ${directoryPath} — 삭제를 건너뛰고 오프라인으로 표시`,
    );
    return { deleted: 0, offline: true };
  }

  const booksToDelete: Book[] = [];
  await db.transaction(async (trx) => {
    const candidates = await trx<Book>("Book")
      .select("*")
      .where("path", "like", `${directoryPath}%`);
    const missingBooks = filterLibraryPathRows(
      candidates,
      directoryPath,
    ).filter((book) => !foundPaths.has(book.path));

    const missingIds = missingBooks.map((book) => book.id);
    for (const missingBook of missingBooks) {
      if (!missingBook.sync_id) {
        booksToDelete.push(missingBook);
        continue;
      }

      const copies = await trx<Book>("Book")
        .where("sync_id", missingBook.sync_id)
        .whereNotIn("id", missingIds)
        .orderBy("state_version", "desc");
      let reachableCopy: Book | undefined;
      for (const copy of copies) {
        if (await isPathAccessible(copy.path)) {
          reachableCopy = copy;
          break;
        }
      }
      if (!reachableCopy) {
        if (preserveUnmatchedSyncIds) {
          await trx("Book")
            .where("id", missingBook.id)
            .update({ is_offline: true });
        } else {
          booksToDelete.push(missingBook);
        }
        continue;
      }

      const update: Record<string, unknown> = {
        added_at: missingBook.added_at,
      };
      if (
        Number(missingBook.state_version || 0) >
        Number(reachableCopy.state_version || 0)
      ) {
        const missingState = missingBook as Book & {
          is_read: boolean;
          is_hidden: boolean;
          custom_title: string | null;
        };
        Object.assign(update, {
          current_page: missingBook.current_page,
          is_favorite: missingBook.is_favorite,
          last_read_at: missingBook.last_read_at,
          state_version: missingBook.state_version || 0,
          state_updated_at: missingBook.state_updated_at || null,
          updated_by_device_id: missingBook.updated_by_device_id || null,
          is_read: missingState.is_read,
          is_hidden: missingState.is_hidden,
          custom_title: missingState.custom_title,
        });
        if (
          missingBook.series_collection_id !==
            reachableCopy.series_collection_id ||
          missingBook.series_order_index !== reachableCopy.series_order_index
        ) {
          const missingSeriesUpdatedAt = Number(
            missingBook.series_state_updated_at || 0,
          );
          const reachableSeriesUpdatedAt = Number(
            reachableCopy.series_state_updated_at || 0,
          );
          Object.assign(update, {
            series_collection_id: missingBook.series_collection_id || null,
            series_order_index: missingBook.series_order_index || null,
            series_state_updated_at:
              missingSeriesUpdatedAt === reachableSeriesUpdatedAt
                ? reachableSeriesUpdatedAt + 1
                : missingSeriesUpdatedAt,
          });
        }
      }
      await trx("Book").where("id", reachableCopy.id).update(update);
      await trx("BookHistory")
        .where("book_id", missingBook.id)
        .update({ book_id: reachableCopy.id });
      await trx("CompanionSyncChange")
        .where("book_id", missingBook.id)
        .update({ book_id: reachableCopy.id });
      booksToDelete.push(missingBook);
    }

    await deleteBookRecords(trx, booksToDelete);
  });
  await removeThumbnailFiles(booksToDelete);
  if (booksToDelete.length > 0) {
    broadcastBooksUpdated();
    notifyCompanionLibraryChanged();
  }
  return { deleted: booksToDelete.length, offline: false };
}

export async function forgetBooksUnderPath(directoryPath: string) {
  let books: Pick<Book, "id" | "cover_path">[] = [];
  await db.transaction(async (trx) => {
    const candidates = await trx("Book")
      .select("id", "path", "cover_path")
      .where("path", "like", `${directoryPath}%`);
    books = filterLibraryPathRows(candidates, directoryPath);
    await deleteBookRecords(trx, books);
  });
  await removeThumbnailFiles(books);
  if (books.length > 0) {
    broadcastBooksUpdated();
    notifyCompanionLibraryChanged();
  }
  return books.length;
}

export async function scanDirectory(
  directoryPath: string,
  options: { force?: boolean; preserveMissingSyncIds?: boolean } = {},
): Promise<{
  added: number;
  updated: number;
  deleted: number;
  foundPaths: Set<string>;
  bookIdsToGenerateThumbnails: number[];
  offline?: boolean; // 루트 접근 불가로 오프라인 처리됨
  offlineCount?: number; // 오프라인 처리된 책 수
}> {
  const { force = false, preserveMissingSyncIds = false } = options; // true면 캐시 무시 강제 재스캔 (수동 재스캔 시)
  const MAX_SCAN_DEPTH = 100;
  const CHUNK_SIZE = 100; // 메모리 최적화를 위한 청크 크기
  console.log(
    `[Main] 디렉토리 스캔 중 (fast-glob 스트림 사용): ${directoryPath}`,
  );

  // 증분 스캔 캐시 맵. force면 빈 맵을 써서 변경 여부와 무관하게 모두 처리한다.
  const zipCache = force
    ? new Map<
        string,
        {
          file_mtime: number | null;
          file_size: number | null;
          sync_id: string | null;
        }
      >()
    : await loadZipScanCache(directoryPath);

  const totalFoundBookPathsInScan = new Set<string>();
  let totalAddedCount = 0;
  let totalUpdatedCount = 0;
  let totalDeletedCount = 0;
  const allBookIdsToGenerateThumbnails: number[] = [];
  const claimedSyncIds = new Set<string>();

  // 진행률 추적을 위한 변수
  let processedFileCount = 0;
  let totalFileCount = 0;
  let currentFileName: string | null = null;

  // 진행률 업데이트 헬퍼 함수
  const updateProgress = (
    phase: LibraryScanProgress["phase"],
    extra: Partial<LibraryScanProgress> = {},
  ) => {
    const progress =
      totalFileCount > 0
        ? Math.round((processedFileCount / totalFileCount) * 100)
        : 0;
    broadcastScanProgress({
      folderPath: directoryPath,
      phase,
      progress,
      currentFile: currentFileName,
      processedCount: processedFileCount,
      totalCount: totalFileCount,
      addedCount: totalAddedCount,
      updatedCount: totalUpdatedCount,
      deletedCount: totalDeletedCount,
      ...extra,
    });
  };

  try {
    // 루트 폴더 접근 확인: 외장하드 분리 등으로 접근 불가 시
    // 삭제 대신 오프라인 마킹 후 조기 반환 (데이터 보존)
    if (!(await isPathAccessible(directoryPath))) {
      const offlineCount = await markBooksOfflineUnderPath(directoryPath);
      console.warn(
        `[Main] 라이브러리 폴더 접근 불가: ${directoryPath} — ${offlineCount}권을 오프라인으로 표시`,
      );
      broadcastScanProgress({
        folderPath: directoryPath,
        phase: "completed",
        progress: 100,
        currentFile: null,
        processedCount: 0,
        totalCount: 0,
        addedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
      });
      return {
        added: 0,
        updated: 0,
        deleted: 0,
        foundPaths: totalFoundBookPathsInScan,
        bookIdsToGenerateThumbnails: [],
        offline: true,
        offlineCount,
      };
    }

    // 접근 가능: 이전에 오프라인 처리된 책들을 온라인으로 복귀
    await restoreBooksOnlineUnderPath(directoryPath);

    // 1단계: 파일 수 카운트
    updateProgress("counting");
    console.log(`[Main] 파일 수 카운트 중...`);

    // 폴더와 ZIP 파일 수 카운트
    const countStream = fg.stream(["**/*"], {
      cwd: directoryPath,
      absolute: true,
      deep: MAX_SCAN_DEPTH,
      onlyFiles: false,
      objectMode: true,
    });

    for await (const entry of countStream) {
      const entryObj = entry as unknown as fg.Entry;
      const itemPath = entryObj.path.replaceAll("/", "\\");
      const ext = path.extname(itemPath).toLowerCase();
      const isDirectory = entryObj.dirent.isDirectory();
      const isFile = entryObj.dirent.isFile();
      const isZip = isFile && (ext === ".cbz" || ext === ".zip");

      if (isDirectory || isZip) {
        totalFileCount++;
      }
    }

    console.log(`[Main] 총 ${totalFileCount}개의 항목을 스캔합니다.`);
    updateProgress("scanning");

    // 2단계: 실제 스캔 처리
    const stream = fg.stream(["**/*"], {
      cwd: directoryPath,
      absolute: true,
      deep: MAX_SCAN_DEPTH,
      onlyFiles: false,
      objectMode: true,
    });

    // 청크 단위로 처리하기 위한 버퍼
    const processedBooksChunk: ProcessedBook[] = [];

    for await (const entry of stream) {
      const entryObj = entry as unknown as fg.Entry;
      const itemPath = entryObj.path.replaceAll("/", "\\");

      if (itemPath.length >= MAX_PATH_LENGTH) {
        totalFoundBookPathsInScan.add(itemPath);
        console.warn(
          `[Main] 긴 경로로 인해 파일 건너뛰기 (>${MAX_PATH_LENGTH}자): ${itemPath}`,
        );
        continue;
      }

      try {
        // objectMode로 dirent 사용하여 fs.stat 호출 최소화
        const ext = path.extname(itemPath).toLowerCase();
        const isDirectory = entryObj.dirent.isDirectory();
        const isFile = entryObj.dirent.isFile();
        const isZip = isFile && (ext === ".cbz" || ext === ".zip");

        if (!isDirectory && !isZip) {
          continue;
        }

        // 진행률 업데이트
        processedFileCount++;
        currentFileName = path.basename(itemPath);

        // 증분 스캔: ZIP/CBZ은 파일 캐시(mtime+size)로 변경 여부를 판정한다.
        // 안 바뀌었으면 ZIP을 열지 않고 DB 갱신도 생략하고 발견 표시만 남긴다.
        // (폴더는 파일 IO가 가벼워 캐시 대상에서 제외한다)
        let zipStat: { mtimeMs: number; size: number } | null = null;
        if (isZip) {
          try {
            const stat = await fs.stat(itemPath);
            zipStat = { mtimeMs: stat.mtimeMs, size: stat.size };
            const cachedZip = zipCache.get(itemPath);
            if (isZipUnchanged(cachedZip, zipStat.mtimeMs, zipStat.size)) {
              totalFoundBookPathsInScan.add(itemPath); // 삭제 대상에서 제외
              updateProgress("scanning");
              continue;
            }
          } catch {
            // stat 실패 시 캐시 비교 없이 그대로 처리한다.
          }
        }

        const bookResult = await processBookItem(itemPath, {
          isDirectory,
          isFile,
          name: path.basename(itemPath),
          file_mtime: zipStat?.mtimeMs,
          file_size: zipStat?.size,
        });

        if (bookResult) {
          processedBooksChunk.push(bookResult);
          totalFoundBookPathsInScan.add(bookResult.bookData.path);

          // 청크가 가득 차면 DB에 저장하고 메모리 해제
          if (processedBooksChunk.length >= CHUNK_SIZE) {
            const result = await db.transaction((trx) =>
              processBatchInTransaction(
                processedBooksChunk,
                trx,
                claimedSyncIds,
              ),
            );
            totalAddedCount += result.added;
            totalUpdatedCount += result.updated;
            allBookIdsToGenerateThumbnails.push(...result.thumbnailNeeded);
            await removeThumbnailFiles(result.thumbnailRemovals);
            // 진행률 업데이트
            updateProgress("scanning");
            // 메모리 해제를 위해 청크 비우기
            processedBooksChunk.length = 0;
            // 이벤트 루프에 양보하여 GC가 메모리를 정리할 기회 제공
            await new Promise<void>((resolve) => setImmediate(() => resolve()));
          }
        }
      } catch (fileProcessError) {
        totalFoundBookPathsInScan.add(itemPath);
        console.error(`[Main] 파일 처리 오류 ${itemPath}:`, fileProcessError);
        continue;
      }
    }

    // 남은 항목 처리 (마지막 청크)
    if (processedBooksChunk.length > 0) {
      const result = await db.transaction((trx) =>
        processBatchInTransaction(processedBooksChunk, trx, claimedSyncIds),
      );
      totalAddedCount += result.added;
      totalUpdatedCount += result.updated;
      allBookIdsToGenerateThumbnails.push(...result.thumbnailNeeded);
      await removeThumbnailFiles(result.thumbnailRemovals);
    }

    // 삭제 처리 (삭제 직전 루트 접근 재확인 포함)
    const cleanupResult = await cleanupMissingBooks(
      directoryPath,
      totalFoundBookPathsInScan,
      preserveMissingSyncIds,
    );
    totalDeletedCount = cleanupResult.deleted;

    // 3단계: 썸네일 생성
    if (allBookIdsToGenerateThumbnails.length > 0) {
      console.log(
        `[Main] 스캔 후 ${allBookIdsToGenerateThumbnails.length}권의 책에 대한 썸네일 생성 중...`,
      );

      // 썸네일 진행률 추적
      let thumbnailsProcessed = 0;
      const totalThumbnails = allBookIdsToGenerateThumbnails.length;

      const updateThumbnailProgress = () => {
        thumbnailsProcessed++;
        const progress = Math.round(
          (thumbnailsProcessed / totalThumbnails) * 100,
        );
        broadcastScanProgress({
          folderPath: directoryPath,
          phase: "thumbnails",
          progress,
          currentFile: `썸네일 생성 중 (${thumbnailsProcessed}/${totalThumbnails})`,
          processedCount: processedFileCount,
          totalCount: totalFileCount,
          addedCount: totalAddedCount,
          updatedCount: totalUpdatedCount,
          deletedCount: totalDeletedCount,
        });
      };

      const queue = new PQueue({ concurrency: os.cpus().length });
      const THUMBNAIL_CHUNK_SIZE = 100;
      const thumbnailChunk: { bookId: number; thumbnailPath: string }[] = [];

      // 썸네일 배치 업데이트 함수
      const flushThumbnailChunk = async () => {
        if (thumbnailChunk.length === 0) return;
        await db.transaction(async (updateTrx) => {
          for (const { bookId, thumbnailPath } of thumbnailChunk) {
            await updateTrx("Book")
              .where("id", bookId)
              .update({ cover_path: thumbnailPath });
          }
        });
        thumbnailChunk.length = 0;
      };

      for (const bookId of allBookIdsToGenerateThumbnails) {
        queue.add(async () => {
          const result = await generateThumbnailForBook(bookId);
          if (result) {
            thumbnailChunk.push(result);
            // 청크가 가득 차면 DB 업데이트
            if (thumbnailChunk.length >= THUMBNAIL_CHUNK_SIZE) {
              await flushThumbnailChunk();
            }
          }
          updateThumbnailProgress();
        });
      }
      await queue.onIdle();
      // 남은 썸네일 업데이트
      await flushThumbnailChunk();
      console.log(`[Main] 스캔 후 썸네일 생성 및 업데이트 완료.`);
    }

    // 4단계: 완료 (시리즈 감지는 라이브러리의 수동 버튼에서만 실행)
    broadcastScanProgress({
      folderPath: directoryPath,
      phase: "completed",
      progress: 100,
      currentFile: null,
      processedCount: processedFileCount,
      totalCount: totalFileCount,
      addedCount: totalAddedCount,
      updatedCount: totalUpdatedCount,
      deletedCount: totalDeletedCount,
    });

    if (totalAddedCount > 0 || totalUpdatedCount > 0 || totalDeletedCount > 0) {
      notifyCompanionLibraryChanged();
    }
    return {
      added: totalAddedCount,
      updated: totalUpdatedCount,
      deleted: totalDeletedCount,
      foundPaths: totalFoundBookPathsInScan,
      bookIdsToGenerateThumbnails: allBookIdsToGenerateThumbnails,
      offline: cleanupResult.offline,
    };
  } catch (error) {
    console.error(`[Main] 디렉토리 스캔 중 오류: ${directoryPath}`, error);
    throw error;
  }
}

export async function scanFile(filePath: string, syncIdOverride?: string) {
  try {
    const stats = await fs.stat(filePath);
    const processedBook = await processBookItem(filePath, {
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      name: path.basename(filePath),
    });

    if (processedBook) {
      const { bookData, infoMetadata } = processedBook;
      if (syncIdOverride) bookData.sync_id = cleanValue(syncIdOverride);
      let bookId: number | undefined;
      let shouldGenerateThumbnail = false;
      const thumbnailRemovals: Pick<Book, "cover_path">[] = [];

      await db.transaction(async (trx) => {
        const existingCandidates: ExistingScanBook[] = await trx("Book")
          .where((query) => {
            query.where("path", bookData.path);
            if (bookData.sync_id) query.orWhere("sync_id", bookData.sync_id);
          })
          .select(
            "id",
            "path",
            "cover_path",
            "sync_id",
            "is_offline",
            "state_version",
          );
        const existingBook = await resolveExistingBookForScan(
          trx,
          existingCandidates,
          bookData.path,
          bookData.sync_id,
          thumbnailRemovals,
        );

        if (existingBook) {
          bookId = existingBook.id;
          await trx("Book")
            .where("id", bookId)
            .update({
              title: cleanValue(bookData.title),
              path: bookData.path,
              page_count: bookData.page_count,
              hitomi_id: cleanValue(bookData.hitomi_id),
              type: cleanValue(bookData.type),
              language_name_english: cleanValue(bookData.language_name_english),
              language_name_local: cleanValue(bookData.language_name_local),
              ...(syncIdOverride
                ? { sync_id: cleanValue(syncIdOverride) }
                : {}),
              file_mtime: bookData.file_mtime ?? null,
              file_size: bookData.file_size ?? null,
              is_offline: false,
            });

          // 업데이트를 위해 기존 연결 제거
          await trx("BookArtist").where("book_id", bookId).del();
          await trx("BookTag").where("book_id", bookId).del();
          await trx("BookSeries").where("book_id", bookId).del();
          await trx("BookGroup").where("book_id", bookId).del();
          await trx("BookCharacter").where("book_id", bookId).del();
        } else {
          const bookToInsert = {
            title: cleanValue(bookData.title),
            path: bookData.path,
            page_count: bookData.page_count || 0,
            added_at: bookData.added_at,
            hitomi_id: cleanValue(bookData.hitomi_id),
            type: cleanValue(bookData.type),
            language_name_english: cleanValue(bookData.language_name_english),
            language_name_local: cleanValue(bookData.language_name_local),
            sync_id: cleanValue(bookData.sync_id),
            file_mtime: bookData.file_mtime ?? null,
            file_size: bookData.file_size ?? null,
          };
          const result = await trx("Book").insert(bookToInsert);
          bookId = result[0];
        }

        // 아티스트, 그룹, 캐릭터, 태그, 시리즈 처리
        const artistsToProcess =
          infoMetadata.artists
            ?.map((a) => cleanValue(a.name))
            .filter(Boolean) || [];
        for (const artistName of artistsToProcess) {
          let artist = await trx("Artist").where("name", artistName).first();
          if (!artist) {
            const [newArtistId] = await trx("Artist").insert({
              name: artistName,
            });
            artist = { id: newArtistId, name: artistName };
          }
          await trx("BookArtist").insert({
            book_id: bookId,
            artist_id: artist.id,
          });
        }

        const groupsToProcess =
          infoMetadata.groups?.map((g) => cleanValue(g.name)).filter(Boolean) ||
          [];
        for (const groupName of groupsToProcess) {
          let group = await trx("Group").where("name", groupName).first();
          if (!group) {
            const [newGroupId] = await trx("Group").insert({
              name: groupName,
            });
            group = { id: newGroupId, name: groupName };
          }
          await trx("BookGroup").insert({
            book_id: bookId,
            group_id: group.id,
          });
        }

        const charactersToProcess =
          infoMetadata.characters
            ?.map((c) => cleanValue(c.name))
            .filter(Boolean) || [];
        for (const characterName of charactersToProcess) {
          let character = await trx("Character")
            .where("name", characterName)
            .first();
          if (!character) {
            const [newCharacterId] = await trx("Character").insert({
              name: characterName,
            });
            character = { id: newCharacterId, name: characterName };
          }
          await trx("BookCharacter").insert({
            book_id: bookId,
            character_id: character.id,
          });
        }

        const tagsToProcess =
          infoMetadata.tags?.map((t) => cleanValue(t.name)).filter(Boolean) ||
          [];
        for (const tagName of tagsToProcess) {
          let tag = await trx("Tag").where("name", tagName).first();
          if (!tag) {
            const [newTagId] = await trx("Tag").insert({ name: tagName });
            tag = { id: newTagId, name: tagName };
          }
          await trx("BookTag").insert({ book_id: bookId, tag_id: tag.id });
        }

        if (infoMetadata.series && infoMetadata.series.length > 0) {
          const seriesName = infoMetadata.series[0].name;
          let series = await trx("Series").where("name", seriesName).first();
          if (!series) {
            const [newSeriesId] = await trx("Series").insert({
              name: seriesName,
            });
            series = { id: newSeriesId, name: seriesName };
          }
          await trx("BookSeries").insert({
            book_id: bookId,
            series_id: series.id,
          });
        }

        // 썸네일 생성 필요 여부 결정
        const currentBookInDb = await trx("Book").where("id", bookId).first();
        if (!currentBookInDb?.cover_path) {
          shouldGenerateThumbnail = true;
        } else {
          try {
            await fs.access(currentBookInDb.cover_path);
          } catch {
            shouldGenerateThumbnail = true;
            console.warn(
              `[Main] 기존 썸네일 파일을 찾을 수 없어 재생성합니다: Book ID ${bookId}`,
            );
          }
        }
      }); // 배치 트랜잭션 종료
      await removeThumbnailFiles(thumbnailRemovals);

      // 단일 파일 스캔 후 썸네일 생성 및 DB 업데이트
      if (shouldGenerateThumbnail && bookId) {
        const result = await generateThumbnailForBook(bookId);
        if (result) {
          await db("Book")
            .where("id", result.bookId)
            .update({ cover_path: result.thumbnailPath });
        }
      }
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send("books-updated");
    });
    notifyCompanionLibraryChanged();
  } catch (error) {
    console.error(`[Main] 파일 스캔 오류 ${filePath}:`, error);
  }
}

export const handleRescanLibraryFolder = async (folderPath: string) => {
  try {
    const { added, updated, deleted, offline } = await scanDirectory(
      folderPath,
      // 사용자 명시적 폴더 재스캔 → 캐시 무시 (force)
      { force: true, preserveMissingSyncIds: true },
    );

    // 폴더 접근 불가로 오프라인 처리된 경우 썸네일 생성 생략
    // (소스 파일이 없어 실패만 반복하므로)
    if (offline) {
      // 이번에 전환된 수가 아닌 현재 오프라인 상태인 전체 권수를 집계 (재스캔 반복 시에도 정확)
      const offlineCandidates = await db("Book")
        .select("id", "path")
        .where("path", "like", `${folderPath}%`)
        .where("is_offline", true);
      const offlineCount = filterLibraryPathRows(
        offlineCandidates,
        folderPath,
      ).length;
      console.log(
        `[Main] ${folderPath} 접근 불가 — ${offlineCount}권 오프라인 처리`,
      );
      return {
        success: true,
        added,
        updated,
        deleted,
        offline: true,
        offlineCount,
      };
    }

    const candidates = await db("Book")
      .select("id", "path")
      .whereLike("path", `${folderPath}%`)
      .and.where("cover_path", null);
    const books = filterLibraryPathRows(candidates, folderPath);
    await Promise.all(books.map((book) => handleGenerateThumbnail(book.id)));
    console.log(
      `[Main] ${folderPath}에 대한 재스캔 완료: 추가 ${added}, 업데이트 ${updated}, 삭제 ${deleted}`,
    );
    return { success: true, added, updated, deleted, offline: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${folderPath} 폴더 재스캔 오류:`, error);
    return { success: false, error: message };
  }
};

export const handleRescanBookMetadata = async (bookId: number) => {
  try {
    const book = await db("Book").where("id", bookId).first();
    if (!book) {
      return { success: false, error: "책을 찾을 수 없습니다." };
    }

    await scanFile(book.path);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Main] 책 메타데이터 재스캔 오류 (ID: ${bookId}):`, error);
    return { success: false, error: message };
  }
};

export function registerDirectoryHandlers() {
  ipcMain.handle("select-folder", (_event) => handleSelectFolder());
  ipcMain.handle("rescan-library-folder", (_event, folderPath) =>
    handleRescanLibraryFolder(folderPath),
  );
  ipcMain.handle("rescan-book-metadata", (_event, bookId: number) =>
    handleRescanBookMetadata(bookId),
  );
}
