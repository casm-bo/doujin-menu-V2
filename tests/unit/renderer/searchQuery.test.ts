import { describe, expect, it } from "vitest";
import { toggleSearchTerm } from "../../../src/renderer/lib/searchQuery";

describe("toggleSearchTerm", () => {
  it("adds a missing term", () => {
    expect(toggleSearchTerm("tag:nurse", "artist:yanje")).toBe(
      "tag:nurse artist:yanje",
    );
  });

  it("removes an existing whole term", () => {
    expect(toggleSearchTerm("tag:nurse artist:yanje", "artist:yanje")).toBe(
      "tag:nurse",
    );
  });

  it("does not remove a prefix-overlapping term", () => {
    expect(toggleSearchTerm("tag:nurse", "tag:nurse2")).toBe(
      "tag:nurse tag:nurse2",
    );
  });

  it("normalizes surrounding and repeated spaces", () => {
    expect(toggleSearchTerm("  a    b  ", "c")).toBe("a b c");
  });
});
