import { describe, expect, it } from "vitest";
import {
  rectanglesIntersect,
  selectBookRange,
} from "../../../src/renderer/components/feature/librarySelection";

describe("selectBookRange", () => {
  it("selects both directions and preserves earlier selections", () => {
    expect([...selectBookRange([1, 2, 3, 4], 4, 2, new Set([1]))]).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

describe("rectanglesIntersect", () => {
  it("detects cards touched by a selection rectangle", () => {
    const selection = { left: 10, right: 30, top: 10, bottom: 30 };

    expect(
      rectanglesIntersect(selection, {
        left: 25,
        right: 40,
        top: 25,
        bottom: 40,
      }),
    ).toBe(true);
    expect(
      rectanglesIntersect(selection, {
        left: 31,
        right: 40,
        top: 31,
        bottom: 40,
      }),
    ).toBe(false);
  });
});
