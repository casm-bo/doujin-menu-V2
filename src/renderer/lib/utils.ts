import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const OPEN_OVERLAY_SELECTOR = [
  '[data-slot="dialog-overlay"]',
  '[data-slot="dialog-content"]',
  '[data-slot="alert-dialog-overlay"]',
  '[data-slot="alert-dialog-content"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
]
  .map((selector) => `${selector}:not([data-state="closed"])`)
  .join(",");

export function hasOpenDialog(): boolean {
  return !!document.querySelector(OPEN_OVERLAY_SELECTOR);
}
