import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const { handleIsWindowMaximized, isAllowedViewerRoute } =
  await import("../../../src/main/handlers/windowHandler.js");

describe("windowHandler", () => {
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
