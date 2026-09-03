import path from "path";
import { naturalSort } from "./index.js";

export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".avif",
] as const;

const EXTENSION_SET = new Set<string>(IMAGE_EXTENSIONS);

export function isImageFile(fileName: string): boolean {
  return EXTENSION_SET.has(path.extname(fileName).toLowerCase());
}

export function sortImageFiles(fileNames: string[]): string[] {
  return fileNames.filter(isImageFile).sort(naturalSort);
}

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

export function imageMimeType(fileName: string): string {
  return (
    MIME_TYPES[path.extname(fileName).toLowerCase()] ??
    "application/octet-stream"
  );
}
