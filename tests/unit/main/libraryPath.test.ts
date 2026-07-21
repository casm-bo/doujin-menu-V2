import { describe, expect, it } from "vitest";
import { isPathWithinLibraryRoot } from "../../../src/main/utils/libraryPath.js";

describe("isPathWithinLibraryRoot", () => {
  it("accepts the root and its descendants", () => {
    expect(isPathWithinLibraryRoot("D:\\Book", "D:\\Book")).toBe(true);
    expect(isPathWithinLibraryRoot("D:\\Book\\Series\\1.cbz", "D:\\Book")).toBe(
      true,
    );
  });

  it("does not confuse folders that share a prefix", () => {
    expect(isPathWithinLibraryRoot("D:\\Books\\1.cbz", "D:\\Book")).toBe(false);
    expect(isPathWithinLibraryRoot("D:\\Book-old\\1.cbz", "D:\\Book")).toBe(
      false,
    );
  });
});
