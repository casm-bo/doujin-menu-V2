import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const { handleIsWindowMaximized } =
  await import("../../../src/main/handlers/windowHandler.js");

describe("windowHandler", () => {
  it("reads maximized state from the requesting window", () => {
    const win = {
      isMaximized: vi.fn(() => true),
    } as unknown as Electron.BrowserWindow;

    expect(handleIsWindowMaximized(win)).toBe(true);
    expect(win.isMaximized).toHaveBeenCalledOnce();
  });
});
