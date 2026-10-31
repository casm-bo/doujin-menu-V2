import { app, dialog, ipcMain } from "electron";
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import db from "../db/index.js";
import {
  DesktopPresentationService,
  seriesCoverPresentationKey,
} from "../services/companion/presentationService.js";
import { DesktopLibraryService } from "../services/companion/companionLibraryService.js";
import type { IpcChannels } from "../../types/ipc.js";
import {
  parsePresentationMutation,
  PRESENTATION_KEY,
} from "../../types/presentation.js";

export const getPresentationService = () =>
  new DesktopPresentationService(
    db,
    path.join(app.getPath("userData"), "presentation-covers"),
  );

export function registerPresentationHandlers() {
  ipcMain.handle("change-cover", (_event, input) => handleChangeCover(input));
  ipcMain.handle("get-presentation", async (_event, key: unknown) => {
    if (
      typeof key !== "string" ||
      key.length > 160 ||
      !PRESENTATION_KEY.test(key)
    )
      throw new Error("작품 식별자가 올바르지 않습니다.");
    return getPresentationService().get(key);
  });
  ipcMain.handle("save-presentation", async (_event, input: unknown) => {
    const mutation = parsePresentationMutation({
      ...(input && typeof input === "object" ? input : {}),
      mutationId: randomUUID(),
    });
    if (!mutation)
      throw new Error("메타데이터 형식이나 길이가 올바르지 않습니다.");
    return getPresentationService().apply("desktop", mutation);
  });
}

export async function handleChangeCover(
  input: IpcChannels["change-cover"]["request"],
) {
  const { target, source } = input ?? {};
  if (
    !target ||
    !["book", "series"].includes(target.kind) ||
    !Number.isSafeInteger(target.id) ||
    target.id <= 0 ||
    !source
  )
    throw new Error("표지 변경 대상이 올바르지 않습니다.");
  const row = await db(target.kind === "book" ? "Book" : "SeriesCollection")
    .where("id", target.id)
    .first();
  if (!row) throw new Error("작품을 찾을 수 없습니다.");
  let bytes: Buffer;
  if (source.kind === "external") {
    const result = await dialog.showOpenDialog({
      title: "표지 이미지 선택",
      properties: ["openFile"],
      filters: [
        {
          name: "이미지",
          extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if ((await fs.stat(result.filePaths[0])).size > 40 * 1024 * 1024)
      throw new Error("이미지는 40MB 이하여야 합니다.");
    bytes = await fs.readFile(result.filePaths[0]);
  } else {
    if (
      !["page", "book-cover"].includes(source.kind) ||
      !Number.isSafeInteger(source.bookId) ||
      source.bookId <= 0 ||
      (source.kind === "page" &&
        (!Number.isSafeInteger(source.pageIndex) || source.pageIndex < 0))
    )
      throw new Error("내부 이미지가 올바르지 않습니다.");
    const book = await db("Book").where("id", source.bookId).first();
    if (
      !book ||
      (target.kind === "book"
        ? book.id !== target.id
        : book.series_collection_id !== target.id)
    )
      throw new Error("이 작품에 속한 이미지만 선택할 수 있습니다.");
    const library = new DesktopLibraryService(
      db,
      () => "",
      () => path.join(app.getPath("userData"), "presentation-covers"),
    );
    const image =
      source.kind === "page"
        ? await library.getPage(source.bookId, source.pageIndex)
        : await library.getCover(source.bookId);
    if (!image) throw new Error("이미지를 불러올 수 없습니다.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of image.stream) {
      size += chunk.length;
      if (size > 40 * 1024 * 1024)
        throw new Error("이미지는 40MB 이하여야 합니다.");
      chunks.push(Buffer.from(chunk));
    }
    bytes = Buffer.concat(chunks);
  }
  const service = getPresentationService();
  const key =
    target.kind === "series"
      ? seriesCoverPresentationKey(row.name)
      : row.hitomi_id
        ? `hitomi:${row.hitomi_id}`
        : `sync:${row.sync_id}`;
  if (target.kind === "book" && !(await service.get(key)))
    await service.captureDesktopEdit(target.id);
  return service.changeCover(key, row.name || row.title, bytes);
}
