export type DropPosition = "before" | "after";

export function reorderForDrop<T>(
  items: readonly T[],
  fromIndex: number,
  targetIndex: number,
  position: DropPosition,
): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    targetIndex < 0 ||
    targetIndex >= items.length
  ) {
    return [...items];
  }

  const reordered = [...items];
  const [draggedItem] = reordered.splice(fromIndex, 1);
  let insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  if (fromIndex < insertionIndex) insertionIndex -= 1;
  reordered.splice(insertionIndex, 0, draggedItem);
  return reordered;
}
