import { describe, expect, it } from "vitest";
import {
  BLACKLIST_TYPES,
  buildBlacklistEntry,
  normalizeTagName,
  parseBlacklistInput,
} from "../../../src/renderer/lib/blacklistTag";

describe("blacklistTag", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeTagName(" Big   Breasts ")).toBe("big_breasts");
  });

  it("builds entries for every supported type", () => {
    for (const type of BLACKLIST_TYPES) {
      expect(buildBlacklistEntry(type, "Example")).toEqual({
        ok: true,
        entry: `${type}:example`,
      });
    }
  });

  it("rejects invalid types, empty names, and unsupported characters", () => {
    expect(buildBlacklistEntry("parody", "example").ok).toBe(false);
    expect(buildBlacklistEntry("tag", " ").ok).toBe(false);
    expect(buildBlacklistEntry("tag", "한글").ok).toBe(false);
  });

  it("parses copied negative filters and defaults to tag", () => {
    expect(parseBlacklistInput("-female:guro")).toEqual({
      ok: true,
      entry: "female:guro",
    });
    expect(parseBlacklistInput("yaoi")).toEqual({
      ok: true,
      entry: "tag:yaoi",
    });
  });
});
