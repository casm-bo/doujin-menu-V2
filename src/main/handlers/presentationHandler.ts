import { app, ipcMain } from "electron";
import path from "path";
import { randomUUID } from "crypto";
import db from "../db/index.js";
import { DesktopPresentationService } from "../services/companion/presentationService.js";
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
