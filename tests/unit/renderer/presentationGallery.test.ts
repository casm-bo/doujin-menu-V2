import { expect, it } from "vitest";
import {
  applyGalleryPresentation,
  galleryPresentation,
} from "../../../src/types/presentationGallery";
import type { HitomiGalleryDetails } from "../../../src/types/hitomi";

const gallery: HitomiGalleryDetails = {
  id: 123,
  title: { display: "Original", japanese: "Original JP" },
  type: "manga",
  artists: [],
  groups: [],
  series: [],
  characters: [],
  tags: [{ type: "female", name: "synthetic" }],
  languageName: { local: "English", english: "english" },
  files: [],
  translations: [],
  relatedIds: [],
  thumbnailUrl: "https://example.invalid/cover.webp",
  publishedDate: new Date("2026-10-01"),
};
it("round-trips edited metadata and local covers without replacing gallery identity or pages", () => {
  const value = galleryPresentation(gallery);
  value.title = "Edited";
  value.metadata.tags = ["male:synthetic", "custom_tag"];
  value.metadata.language = null;
  value.metadata.galleryType = "custom type";
  value.coverHash = "a".repeat(64);
  const result = applyGalleryPresentation(gallery, value);
  expect(result.title).toEqual({ display: "Edited", japanese: "Original JP" });
  expect(result.tags).toEqual([
    { type: "male", name: "synthetic" },
    { type: "tag", name: "custom_tag" },
  ]);
  expect(result.languageName.local).toBeNull();
  expect(result.type).toBe("custom type");
  expect(result.thumbnailUrl).toBe(
    `doujinzip://presentation-cover/${value.coverHash}.image`,
  );
  expect(result.files).toBe(gallery.files);
  expect(gallery.title.display).toBe("Original");
  expect(
    applyGalleryPresentation(gallery, { ...value, key: "hitomi:456" }),
  ).toBe(gallery);
  expect(applyGalleryPresentation(gallery, null)).toBe(gallery);
});
