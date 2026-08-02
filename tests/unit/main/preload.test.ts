import { readFileSync } from "node:fs";
import vm from "node:vm";
import fg from "fast-glob";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = {
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

let ipcBridge!: {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  send: (channel: string, ...args: unknown[]) => void;
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
};
electron.exposeInMainWorld.mockImplementation((_key, bridge) => {
  ipcBridge = bridge;
});

vm.runInNewContext(
  readFileSync(
    new URL("../../../src/main/preload.cjs", import.meta.url),
    "utf8",
  ),
  {
    require: () => ({
      contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
      ipcRenderer: {
        invoke: electron.invoke,
        send: electron.send,
        on: electron.on,
        off: electron.off,
      },
    }),
  },
);

describe("preload IPC bridge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("허용된 채널만 main process에 전달함", async () => {
    electron.invoke.mockResolvedValue("ok");

    await expect(ipcBridge.invoke("get-config")).resolves.toBe("ok");
    expect(electron.invoke).toHaveBeenCalledWith("get-config");
    expect(() => ipcBridge.send("unknown-channel")).toThrow(
      "IPC channel not allowed",
    );
  });

  it("Electron event 객체를 숨기고 해제 함수를 반환함", () => {
    const listener = vi.fn();
    const stop = ipcBridge.on("books-updated", listener);
    const wrapped = electron.on.mock.calls[0][1];

    wrapped({ sender: "private" }, 42);
    expect(listener).toHaveBeenCalledWith(42);

    stop();
    expect(electron.off).toHaveBeenCalledWith("books-updated", wrapped);
  });

  it("renderer가 사용하는 모든 IPC 채널을 허용함", async () => {
    const pattern = /ipcRenderer\.(invoke|send|on)\(\s*["']([^"']+)/g;
    for (const file of await fg("src/renderer/**/*.{ts,vue}")) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(pattern)) {
        const [, method, channel] = match;
        expect(() => {
          if (method === "invoke") void ipcBridge.invoke(channel);
          else if (method === "send") ipcBridge.send(channel);
          else ipcBridge.on(channel, () => {})();
        }, `${file}: ${method} ${channel}`).not.toThrow();
      }
    }
  });
});
