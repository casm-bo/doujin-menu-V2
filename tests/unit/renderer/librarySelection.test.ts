import { describe, expect, it } from "vitest";
import { selectBookRange } from "../../../src/renderer/components/feature/librarySelection";

describe("selectBookRange", () => {
  it("selects both directions and preserves earlier selections", () => {
    expect([...selectBookRange([1, 2, 3, 4], 4, 2, new Set([1]))]).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
