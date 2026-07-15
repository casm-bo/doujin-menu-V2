import { app, ipcMain } from "electron";
import Store from "electron-store";
import type { CompanionDevice } from "../../types/companion.js";
import { hitomiService } from "../services/hitomi/hitomiService.js";
import {
  CompanionServer,
  type CompanionDeviceStore,
} from "../services/companion/companionServer.js";
import { store } from "./configHandler.js";

const companionDeviceStore = new Store<{ devices: CompanionDevice[] }>({
  name: "companion-devices",
  defaults: { devices: [] },
});

const deviceStore: CompanionDeviceStore = {
  getDevices: () => companionDeviceStore.get("devices", []),
  setDevices: (devices) => companionDeviceStore.set("devices", devices),
};

export const companionServer = new CompanionServer(hitomiService, deviceStore);

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
