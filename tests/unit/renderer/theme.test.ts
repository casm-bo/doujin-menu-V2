// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/api", () => ({ ipcRenderer: { invoke } }));
import { useTheme } from "../../../src/renderer/composable/useTheme";

describe("desktop theme loading", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    document.head.innerHTML = "";
    invoke.mockReset();
  });
  it("loads Android by default without overwriting settings", async () => {
    invoke.mockResolvedValue({});
    const theme = useTheme();
    await theme.initializeTheme();
    expect(theme.currentTheme.value).toBe("android-default");
    expect(document.querySelector("link")?.getAttribute("href")).toBe(
      "/assets/themes/android-default.css",
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("preserves saved themes and replaces only the theme stylesheet", async () => {
    invoke.mockResolvedValue({ colorTheme: "catppuccin" });
    const theme = useTheme();
    await theme.initializeTheme();
    expect(theme.currentTheme.value).toBe("catppuccin");
    await theme.setTheme("android-default");
    expect(document.querySelectorAll("#theme-css")).toHaveLength(1);
    expect(invoke).toHaveBeenLastCalledWith("set-config", {
      key: "colorTheme",
      value: "android-default",
    });
  });
  it("loads the packaged file URL and resets the active theme after config failure", async () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "file:",
        pathname: "/C:/Synthetic/build/renderer/index.html",
      },
    });
    invoke.mockResolvedValue({ colorTheme: "catppuccin" });
    const theme = useTheme();
    await theme.initializeTheme();
    expect(document.querySelector("link")?.getAttribute("href")).toBe(
      "/C:/Synthetic/build/renderer/assets/themes/catppuccin.css",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockRejectedValue(new Error("synthetic config failure"));
    await theme.initializeTheme();
    expect(theme.currentTheme.value).toBe("android-default");
    expect(document.querySelector("link")?.getAttribute("href")).toBe(
      "/C:/Synthetic/build/renderer/assets/themes/android-default.css",
    );
  });
});
