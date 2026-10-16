import { BrowserWindow, type WebContents } from "electron";
import type { IpcListenChannels } from "../../types/ipc.js";

type BroadcastArgs<K extends keyof IpcListenChannels> =
  IpcListenChannels[K] extends void ? [] : [IpcListenChannels[K]];

export function broadcast<K extends keyof IpcListenChannels>(
  channel: K,
  ...args: BroadcastArgs<K>
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, ...args);
  }
}

export function sendTo<K extends keyof IpcListenChannels>(
  webContents: WebContents,
  channel: K,
  ...args: BroadcastArgs<K>
): void {
  webContents.send(channel, ...args);
}
