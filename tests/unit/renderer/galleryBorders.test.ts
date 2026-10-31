import { describe, expect, it } from "vitest";
import {
  DEFAULT_GALLERY_BORDERS,
  galleryBorderStyle,
  isGalleryBorders,
} from "../../../src/types/galleryBorders";

describe("gallery borders", () => {
  it("matches Android defaults and prioritizes favorites over series", () => {
    expect(galleryBorderStyle(DEFAULT_GALLERY_BORDERS)).toMatchObject({
      borderWidth: "3px",
      borderColor: "#b0a6bc",
    });
    expect(galleryBorderStyle(DEFAULT_GALLERY_BORDERS, true).borderColor).toBe(
      "#e53935",
    );
    expect(
      galleryBorderStyle(DEFAULT_GALLERY_BORDERS, true, true).borderColor,
    ).toBe("#e6a000");
  });

  it("allows disabling borders and rejects malformed stored settings", () => {
    const borders = {
      ...DEFAULT_GALLERY_BORDERS,
      normal: { width: 0, color: "#123abc" },
    };
    expect(isGalleryBorders(borders)).toBe(true);
    expect(galleryBorderStyle(borders).borderWidth).toBe("0px");
    for (const width of [-1, 7, NaN, Infinity, "3"]) {
      expect(
        isGalleryBorders({ ...borders, normal: { width, color: "#123abc" } }),
      ).toBe(false);
    }
    expect(
      isGalleryBorders({ ...borders, normal: { width: 3, color: "red" } }),
    ).toBe(false);
    for (const value of [null, {}, { normal: null }])
      expect(isGalleryBorders(value)).toBe(false);
  });
});
