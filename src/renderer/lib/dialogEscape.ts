let escapeOwner: Element | null = null;
let resetQueued = false;

export function preventBackgroundDialogEscape(event: Event) {
  const current = event.currentTarget as Element | null;
  const openDialogs = document.querySelectorAll(
    '[data-slot="dialog-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"]',
  );

  escapeOwner ??= openDialogs.item(openDialogs.length - 1);
  if (current && escapeOwner && current !== escapeOwner) event.preventDefault();

  if (!resetQueued) {
    resetQueued = true;
    queueMicrotask(() => {
      escapeOwner = null;
      resetQueued = false;
    });
  }
}
