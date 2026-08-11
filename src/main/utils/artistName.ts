export function normalizeArtistName(value: string): string {
  return value.trim().replace(/[\s_]+/gu, "_");
}
