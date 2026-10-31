export function extractKoreanTitle(
  title: string,
  prioritizeKorean: boolean,
): string {
  if (!prioritizeKorean) return title;
  const match = /^.+\|\s?(.+)$/.exec(title);
  return match?.[1]?.trim() ?? title;
}
