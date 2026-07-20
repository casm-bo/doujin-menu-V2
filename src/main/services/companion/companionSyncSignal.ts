let onLibraryChanged: (() => void) | null = null;

export function setCompanionLibraryChangedHandler(handler: () => void): void {
  onLibraryChanged = handler;
}

export function notifyCompanionLibraryChanged(): void {
  onLibraryChanged?.();
}
