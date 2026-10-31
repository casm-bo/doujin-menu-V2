import { describe, expect, it } from "vitest";
import { clampViewerPage } from "../../../src/renderer/store/viewerPage";

describe("clampViewerPage", () => {
  it("keeps requested pages inside the current book", () => {
    expect(clampViewerPage(0, 10)).toBe(1);
    expect(clampViewerPage(7, 10)).toBe(7);
    expect(clampViewerPage(20, 10)).toBe(10);
  });

  it("rejects books without pages", () => {
    expect(clampViewerPage(1, 0)).toBeNull();
  });
});
