import filenamify from "filenamify";
import type { Gallery as NativeHitomiGallery } from "node-hitomi";
import path from "path";
import type { HitomiGallery as SerializableHitomiGallery } from "../../types/hitomi.js";

type GalleryMetadata = string | { name: string };

export const DEFAULT_DOWNLOAD_PATTERN = "[%artist%][%id%] %title%";
export const MAX_SAFE_PATH_LENGTH = 245;

export interface FolderNameOptions {
  capitalizeNames?: boolean;
}

function metadataNames(
  values: readonly GalleryMetadata[] | undefined,
): string[] {
  return (
    values?.map((value) => (typeof value === "string" ? value : value.name)) ??
    []
  );
}

export function naturalSort(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const aArr = a.match(re) || [];
  const bArr = b.match(re) || [];

  for (let i = 0; i < Math.min(aArr.length, bArr.length); i++) {
    const aPart = aArr[i];
    const bPart = bArr[i];

    const aNum = parseInt(aPart, 10);
    const bNum = parseInt(bPart, 10);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      // Both are numbers
      if (aNum !== bNum) {
        return aNum - bNum;
      }
    } else {
      // At least one is not a number, compare as strings
      const cmp = aPart.localeCompare(bPart, "en");
      if (cmp !== 0) {
        return cmp;
      }
    }
  }
  return aArr.length - bArr.length;
}

export function capitalizeWords(value: string): string {
  return value.replaceAll(
    /\S+/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1),
  );
}

function sanitizeSegment(segment: string): string {
  return segment
    .replace(/\|/g, "｜")
    .replace(/\//g, "／")
    .replace(/[<>:"\\?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDownloadFolderName(
  gallery: NativeHitomiGallery | SerializableHitomiGallery,
  pattern: string,
  options: FolderNameOptions = {},
): string {
  const artists = metadataNames(gallery.artists);
  const groups = metadataNames(gallery.groups);
  const series = metadataNames(gallery.series);
  const characters = metadataNames(gallery.characters);
  const language =
    "languageName" in gallery
      ? gallery.languageName.english
      : gallery.language?.name;
  const applyCase = (value: string) =>
    options.capitalizeNames ? capitalizeWords(value) : value;

  const variables: Record<string, string> = {
    artist: applyCase(artists[0] || "N/A"),
    groups: applyCase(groups.join(", ") || "N/A"),
    title: gallery.title.display || `ID_${gallery.id}`,
    id: String(gallery.id),
    language: language || "N/A",
    series: series[0] || "N/A",
    character: characters[0] || "N/A",
    type: gallery.type || "N/A",
  };

  const segments = pattern
    .split(/[\\/]+/)
    .map((segment) =>
      segment.replaceAll(/%([a-zA-Z|]+)%/g, (_match, fallbackChain: string) => {
        for (const variableName of fallbackChain.split("|")) {
          const value = variables[variableName];
          if (value && value !== "N/A") return value;
        }
        return "N/A";
      }),
    )
    .map(sanitizeSegment)
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .map((segment) =>
      filenamify(segment, {
        maxLength: MAX_SAFE_PATH_LENGTH,
        replacement: "_",
      }),
    );

  return segments.length > 0 ? path.join(...segments) : String(gallery.id);
}

export function buildGalleryDownloadPath(
  downloadPath: string,
  gallery: NativeHitomiGallery | SerializableHitomiGallery,
  pattern: string,
  options: FolderNameOptions = {},
): string {
  const segments = formatDownloadFolderName(gallery, pattern, options).split(
    path.sep,
  );
  const fullPath = path.join(downloadPath, ...segments);
  if (fullPath.length <= MAX_SAFE_PATH_LENGTH) return fullPath;

  const parentSegments = segments.slice(0, -1);
  const parentPath =
    parentSegments.length > 0 ? path.join(...parentSegments) : "";
  const suffix = `... (${gallery.id})`;
  const prefixLength =
    downloadPath.length + (parentPath ? parentPath.length + 1 : 0) + 1;
  const available = MAX_SAFE_PATH_LENGTH - prefixLength - suffix.length;
  if (available <= 0) return path.join(downloadPath, String(gallery.id));

  const finalSegment = filenamify(
    segments.at(-1)!.substring(0, available).trim() + suffix,
    { maxLength: MAX_SAFE_PATH_LENGTH, replacement: "_" },
  );
  return path.join(downloadPath, ...parentSegments, finalSegment);
}
