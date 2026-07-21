let onLibraryChanged: ((affectsLibrarySnapshot: boolean) => void) | null = null;

export function setCompanionLibraryChangedHandler(
  handler: (affectsLibrarySnapshot: boolean) => void,
): void {
  onLibraryChanged = handler;
}

export function notifyCompanionLibraryChanged(
  affectsLibrarySnapshot = true,
): void {
  onLibraryChanged?.(affectsLibrarySnapshot);
}
