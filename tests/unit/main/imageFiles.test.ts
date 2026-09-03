import { describe, expect, it } from "vitest";
import {
  imageMimeType,
  isImageFile,
  sortImageFiles,
} from "../../../src/main/utils/imageFiles.js";

describe("image file utilities", () => {
  it("recognizes supported extensions without case sensitivity", () => {
    for (const fileName of [
      "a.jpg",
      "a.JPEG",
      "a.WebP",
      "a.gif",
      "a.bmp",
      "a.AVIF",
    ]) {
      expect(isImageFile(fileName)).toBe(true);
    }
    expect(isImageFile("info.txt")).toBe(false);
  });

  it("filters and naturally sorts image files", () => {
    expect(
      sortImageFiles(["img_10.jpg", "info.txt", "img_2.jpg", "img_1.jpg"]),
    ).toStrictEqual(["img_1.jpg", "img_2.jpg", "img_10.jpg"]);
  });

  it("returns canonical image MIME types", () => {
    expect(imageMimeType("a.JPG")).toBe("image/jpeg");
    expect(imageMimeType("a.avif")).toBe("image/avif");
    expect(imageMimeType("a.xyz")).toBe("application/octet-stream");
  });
});
