export type MediaRequest =
  | { kind: "page"; bookId: number; pageIndex: number }
  | { kind: "thumbnail"; fileName: string };

const parseNonNegativeInteger = (value: string) => {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export function parseMediaRequestUrl(rawUrl: string): MediaRequest | null {
  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.split("/").filter(Boolean);

    if (url.protocol !== "doujin-menu:") return null;

    if (url.hostname === "page" && segments.length === 2) {
      const bookId = parseNonNegativeInteger(segments[0]);
      const pageIndex = parseNonNegativeInteger(segments[1]);
      return bookId !== null && bookId > 0 && pageIndex !== null
        ? { kind: "page", bookId, pageIndex }
        : null;
    }

    if (url.hostname === "thumbnail" && segments.length === 1) {
      const fileName = decodeURIComponent(segments[0]);
      return fileName &&
        fileName !== "." &&
        fileName !== ".." &&
        !fileName.includes("/") &&
        !fileName.includes("\\")
        ? { kind: "thumbnail", fileName }
        : null;
    }
  } catch {
    // Invalid media URLs are rejected below.
  }

  return null;
}
