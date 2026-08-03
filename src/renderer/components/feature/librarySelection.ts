export function selectBookRange(
  orderedIds: number[],
  anchorId: number,
  targetId: number,
  selected: ReadonlySet<number> = new Set(),
) {
  const anchor = orderedIds.indexOf(anchorId);
  const target = orderedIds.indexOf(targetId);
  if (anchor < 0 || target < 0) return new Set(selected);
  const range = new Set<number>();
  for (
    let index = Math.min(anchor, target);
    index <= Math.max(anchor, target);
    index++
  ) {
    range.add(orderedIds[index]);
  }
  const ordered = new Set(orderedIds);
  return new Set([
    ...orderedIds.filter((id) => selected.has(id) || range.has(id)),
    ...[...selected].filter((id) => !ordered.has(id)),
  ]);
}
