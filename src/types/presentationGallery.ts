import type { HitomiGalleryDetails, HitomiTag } from "./hitomi.js";
import type { GalleryPresentation } from "./presentation.js";

export function galleryPresentation(
  gallery: HitomiGalleryDetails,
): GalleryPresentation {
  return {
    key: `hitomi:${gallery.id}`,
    title: gallery.title.display,
    coverHash: null,
    webtoon: null,
    version: 0,
    revision: 0,
    metadata: {
      hitomiId: String(gallery.id),
      artists: gallery.artists,
      groups: gallery.groups,
      series: gallery.series,
      characters: gallery.characters,
      tags: gallery.tags.map((tag) =>
        ["male", "female"].includes(tag.type)
          ? `${tag.type}:${tag.name}`
          : tag.name,
      ),
      galleryType: gallery.type,
      language: gallery.languageName.local || gallery.languageName.english,
      publishedDate: gallery.publishedDate
        ? new Date(gallery.publishedDate).toISOString()
        : null,
    },
  };
}

export function applyGalleryPresentation(
  gallery: HitomiGalleryDetails,
  value: GalleryPresentation | null,
): HitomiGalleryDetails {
  if (!value || value.key !== `hitomi:${gallery.id}`) return gallery;
  const metadata = value.metadata;
  return {
    ...gallery,
    title: { ...gallery.title, display: value.title },
    artists: metadata.artists,
    groups: metadata.groups,
    series: metadata.series,
    characters: metadata.characters,
    tags: metadata.tags.map((name) => {
      const match = /^(male|female):(.*)$/.exec(name);
      return match
        ? { type: match[1] as HitomiTag["type"], name: match[2] }
        : { type: "tag", name };
    }),
    type: metadata.galleryType || "",
    languageName: { english: metadata.language, local: metadata.language },
    publishedDate: metadata.publishedDate
      ? new Date(metadata.publishedDate)
      : null,
    thumbnailUrl: value.coverHash
      ? `doujinzip://presentation-cover/${value.coverHash}.image`
      : gallery.thumbnailUrl,
  };
}
