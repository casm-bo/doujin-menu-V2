export interface PresentationMetadata {
  hitomiId: string | null;
  artists: string[];
  groups: string[];
  galleryType: string | null;
  series: string[];
  characters: string[];
  tags: string[];
  language: string | null;
  publishedDate: string | null;
}

export interface GalleryPresentation {
  key: string;
  title: string;
  metadata: PresentationMetadata;
  coverHash: string | null;
  webtoon: boolean | null;
  version: number;
  revision: number;
}

export interface PresentationMutation {
  mutationId: string;
  baseVersion: number;
  value: GalleryPresentation;
}

export interface PresentationMutationResult {
  status: "applied" | "already_applied" | "conflict";
  value: GalleryPresentation;
}

export interface PresentationChanges {
  values: GalleryPresentation[];
  cursor: number;
  hasMore: boolean;
}

export const COVER_HASH = /^[a-f0-9]{64}$/;
export const PRESENTATION_KEY = /^(hitomi:[1-9][0-9]*|sync:[a-zA-Z0-9_-]+)$/;

export function parsePresentationMutation(
  input: unknown,
): PresentationMutation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  if (
    typeof body.mutationId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(body.mutationId) ||
    !Number.isSafeInteger(body.baseVersion) ||
    (body.baseVersion as number) < 0
  )
    return null;
  const raw = body.value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.key !== "string" ||
    value.key.length > 160 ||
    !PRESENTATION_KEY.test(value.key) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 500 ||
    (value.coverHash != null &&
      (typeof value.coverHash !== "string" ||
        !COVER_HASH.test(value.coverHash))) ||
    (value.webtoon != null && typeof value.webtoon !== "boolean") ||
    !value.metadata ||
    typeof value.metadata !== "object" ||
    Array.isArray(value.metadata)
  )
    return null;
  const metadata = value.metadata as Record<string, unknown>;
  const lists: Record<string, string[]> = {};
  for (const name of ["artists", "groups", "series", "characters", "tags"]) {
    const list = metadata[name] ?? [];
    if (
      !Array.isArray(list) ||
      list.length > 300 ||
      list.some(
        (item) => typeof item !== "string" || !item.trim() || item.length > 200,
      )
    )
      return null;
    lists[name] = [...new Set(list.map((item) => (item as string).trim()))];
  }
  for (const name of ["hitomiId", "galleryType", "language", "publishedDate"]) {
    if (
      metadata[name] != null &&
      (typeof metadata[name] !== "string" ||
        (metadata[name] as string).length > 200)
    )
      return null;
  }
  const nullable = (name: string) =>
    (metadata[name] as string | null | undefined)?.trim() || null;
  const hitomiId = value.key.startsWith("hitomi:")
    ? value.key.slice(7)
    : nullable("hitomiId");
  if (nullable("hitomiId") && hitomiId !== nullable("hitomiId")) return null;
  return {
    mutationId: body.mutationId,
    baseVersion: body.baseVersion as number,
    value: {
      key: value.key,
      title: value.title.trim(),
      coverHash: (value.coverHash as string | null) ?? null,
      webtoon: (value.webtoon as boolean | null) ?? null,
      version: 0,
      revision: 0,
      metadata: {
        hitomiId,
        artists: lists.artists,
        groups: lists.groups,
        series: lists.series,
        characters: lists.characters,
        tags: lists.tags,
        galleryType: nullable("galleryType"),
        language: nullable("language"),
        publishedDate: nullable("publishedDate"),
      },
    },
  };
}
