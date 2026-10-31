import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const {
  handleIsWindowMaximized,
  isAllowedViewerRoute,
  handleSetFullscreen,
  handleIsFullscreen,
  handleFullscreenToggle,
} = await import("../../../src/main/handlers/windowHandler.js");

describe("windowHandler", () => {
  it.each(["win32", "linux", "darwin"])(
    "uses the supported fullscreen API on %s",
    (platform) => {
      const original = Object.getOwnPropertyDescriptor(process, "platform")!;
      const win = {
        setFullScreen: vi.fn(),
        setSimpleFullScreen: vi.fn(),
        isFullScreen: vi.fn(() => true),
        isSimpleFullScreen: vi.fn(() => true),
      } as unknown as Electron.BrowserWindow;
      try {
        Object.defineProperty(process, "platform", { value: platform });
        handleSetFullscreen(win, true);
        expect(handleIsFullscreen(win)).toBe(true);
        handleFullscreenToggle(win);
        const selected =
          platform === "darwin" ? win.setSimpleFullScreen : win.setFullScreen;
        const unused =
          platform === "darwin" ? win.setFullScreen : win.setSimpleFullScreen;
        expect(selected).toHaveBeenNthCalledWith(1, true);
        expect(selected).toHaveBeenNthCalledWith(2, false);
        expect(unused).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, "platform", original);
      }
    },
  );
  it("reads maximized state from the requesting window", () => {
    const win = {
      isMaximized: vi.fn(() => true),
    } as unknown as Electron.BrowserWindow;

    expect(handleIsWindowMaximized(win)).toBe(true);
    expect(win.isMaximized).toHaveBeenCalledOnce();
  });

  it("viewer 내부 경로만 새 창으로 허용함", () => {
    expect(isAllowedViewerRoute("/viewer/42?filter=test")).toBe(true);
    expect(isAllowedViewerRoute("https://example.com/viewer/42")).toBe(false);
    expect(isAllowedViewerRoute("/settings")).toBe(false);
  });
});
