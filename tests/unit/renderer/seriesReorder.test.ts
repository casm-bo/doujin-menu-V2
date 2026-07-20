import { describe, expect, it } from "vitest";
import { reorderForDrop } from "../../../src/renderer/components/feature/seriesReorder";

describe("reorderForDrop", () => {
  it("moves downward before the indicated item without an off-by-one shift", () => {
    expect(reorderForDrop(["a", "b", "c", "d"], 0, 2, "before")).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("supports dropping after an item in either direction", () => {
    expect(reorderForDrop(["a", "b", "c", "d"], 0, 2, "after")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(reorderForDrop(["a", "b", "c", "d"], 3, 1, "after")).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });
});
