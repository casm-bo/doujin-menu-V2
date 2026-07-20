import { app, ipcMain } from "electron";
import Store from "electron-store";
import type { CompanionDevice } from "../../types/companion.js";
import { hitomiService } from "../services/hitomi/hitomiService.js";
import {
  CompanionServer,
  type CompanionDeviceStore,
  type CompanionDownloadService,
} from "../services/companion/companionServer.js";
import { DesktopLibraryService } from "../services/companion/companionLibraryService.js";
import { DesktopCompanionSyncService } from "../services/companion/companionSyncService.js";
import { setCompanionLibraryChangedHandler } from "../services/companion/companionSyncSignal.js";
import db from "../db/index.js";
import { store } from "./configHandler.js";
import {
  handleAddToDownloadQueue,
  handleClearCompletedDownloads,
  handleGetDownloadQueue,
  handlePauseDownload,
  handleRemoveFromDownloadQueue,
  handleResumeDownload,
  handleRetryDownload,
} from "./downloadQueueHandler.js";

const companionDeviceStore = new Store<{ devices: CompanionDevice[] }>({
  name: "companion-devices",
  defaults: { devices: [] },
});

const deviceStore: CompanionDeviceStore = {
  getDevices: () => companionDeviceStore.get("devices", []),
  setDevices: (devices) => companionDeviceStore.set("devices", devices),
};

const downloadService: CompanionDownloadService = {
  getPath: async () => {
    const configuredPath = store.get("downloadPath", "").trim();
    return {
      success: true,
      data: {
        configured: Boolean(configuredPath),
        path: configuredPath || null,
      },
    };
  },
  getQueue: handleGetDownloadQueue,
  add: async (galleryId) => {
    const downloadPath = store.get("downloadPath", "").trim();
    if (!downloadPath) {
      return {
        success: false,
        error: "데스크톱 앱에서 다운로드 폴더를 먼저 설정해주세요.",
      };
    }

    const gallery = await hitomiService.getGalleryDetails(galleryId);
    return handleAddToDownloadQueue({
      galleryId,
      galleryTitle: gallery.title.display,
      galleryArtist: gallery.artists?.[0],
      thumbnailUrl: gallery.thumbnailUrl,
      downloadPath,
    });
  },
  remove: handleRemoveFromDownloadQueue,
  pause: handlePauseDownload,
  resume: handleResumeDownload,
  retry: handleRetryDownload,
  clearCompleted: handleClearCompletedDownloads,
};

export const companionServer = new CompanionServer(
  hitomiService,
  deviceStore,
  downloadService,
  new DesktopLibraryService(db, () => store.get("downloadPath", "")),
  new DesktopCompanionSyncService(db),
);
setCompanionLibraryChangedHandler(() => companionServer.requestSync());

let syncStatus = {
  state: "idle" as "idle" | "syncing" | "success" | "error",
  lastSyncedAt: null as string | null,
  bookCount: 0,
  cursor: 0,
  error: null as string | null,
};

export async function startCompanionServer() {
  try {
    const port = store.get("companionPort", 47831);
    const status = await companionServer.start(port);
    store.set("companionEnabled", true);
    return { success: true, data: { ...status, enabled: true } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function stopCompanionServer() {
  try {
    await companionServer.stop();
    store.set("companionEnabled", false);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function registerCompanionHandlers() {
  ipcMain.handle("get-companion-status", () => ({
    ...companionServer.getStatus(store.get("companionEnabled", false)),
    enabled: store.get("companionEnabled", false),
  }));
  ipcMain.handle("get-companion-sync-status", () => syncStatus);
  ipcMain.handle("run-companion-sync", async () => {
    syncStatus = { ...syncStatus, state: "syncing", error: null };
    try {
      const snapshot = await new DesktopCompanionSyncService(db).bootstrap();
      companionServer.requestSync();
      syncStatus = {
        state: "success",
        lastSyncedAt: new Date().toISOString(),
        bookCount: snapshot.books.length,
        cursor: snapshot.cursor,
        error: null,
      };
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      syncStatus = { ...syncStatus, state: "error", error: message };
      return { success: false, error: message };
    }
  });
  ipcMain.handle("start-companion-server", () => startCompanionServer());
  ipcMain.handle("stop-companion-server", () => stopCompanionServer());
  ipcMain.handle("create-companion-pairing-code", () => {
    try {
      return { success: true, data: companionServer.createPairingCode() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  });
  ipcMain.handle("get-companion-devices", () => companionServer.getDevices());
  ipcMain.handle("revoke-companion-device", (_event, deviceId: string) => ({
    success: companionServer.revokeDevice(deviceId),
  }));

  if (store.get("companionEnabled", false)) {
    const result = await startCompanionServer();
    if (!result.success) {
      console.error("[Companion] Failed to start automatically:", result.error);
    }
  }

  app.on("before-quit", () => {
    void companionServer.stop();
  });
}
