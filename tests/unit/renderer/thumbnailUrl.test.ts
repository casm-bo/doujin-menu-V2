import { expect, it } from "vitest";
import { getThumbnailUrl } from "../../../src/renderer/lib/thumbnailUrl";
import { parseMediaRequestUrl } from "../../../src/main/mediaProtocol";

it("routes chosen page and external image covers to their content-addressed directory", () => {
  const name = "a".repeat(64) + ".image";
  for (const root of [
    "C:\\Synthetic\\presentation-covers\\",
    "/synthetic/presentation-covers/",
  ]) {
    const url = getThumbnailUrl(root + name, 42);
    expect(url).toBe(`doujin-menu://presentation-cover/${name}?v=42`);
    expect(parseMediaRequestUrl(url)).toEqual({
      kind: "presentation-cover",
      fileName: name,
    });
  }
});

it("preserves normal thumbnail paths, encoding and empty covers", () => {
  expect(getThumbnailUrl("/synthetic/thumbnails/cover image.webp")).toBe(
    "doujin-menu://thumbnail/cover%20image.webp",
  );
  expect(getThumbnailUrl(null)).toBe("");
  expect(getThumbnailUrl("")).toBe("");
});

it("rejects arbitrary filenames and traversal in the presentation cover route", () => {
  for (const name of [
    "../secret",
    "..%2Fsecret",
    "cover.png",
    "a".repeat(64) + ".png",
    "a".repeat(64) + ".image/extra",
  ]) {
    expect(
      parseMediaRequestUrl(`doujin-menu://presentation-cover/${name}`),
    ).toBeNull();
  }
});
