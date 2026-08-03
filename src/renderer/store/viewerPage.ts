export function clampViewerPage(page: number, totalPages: number) {
  if (totalPages < 1) return null;
  return Math.min(Math.max(1, page), totalPages);
}
