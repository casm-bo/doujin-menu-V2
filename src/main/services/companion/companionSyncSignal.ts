let onLibraryChanged:
  | ((affectsLibrarySnapshot: boolean, presentationKey?: string) => void)
  | null = null;

export function setCompanionLibraryChangedHandler(
  handler: (affectsLibrarySnapshot: boolean, presentationKey?: string) => void,
): void {
  onLibraryChanged = handler;
}

export function notifyCompanionLibraryChanged(
  affectsLibrarySnapshot = true,
  presentationKey?: string,
): void {
  onLibraryChanged?.(affectsLibrarySnapshot, presentationKey);
}
