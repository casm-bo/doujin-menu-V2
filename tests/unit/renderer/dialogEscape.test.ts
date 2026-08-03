import { afterEach, describe, expect, it, vi } from "vitest";
import { preventBackgroundDialogEscape } from "../../../src/renderer/lib/dialogEscape";

describe("preventBackgroundDialogEscape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("allows only the topmost open dialog to handle one Escape press", async () => {
    const background = {} as Element;
    const topmost = {} as Element;
    vi.stubGlobal("document", {
      querySelectorAll: () => ({
        length: 2,
        item: (index: number) => [background, topmost][index] || null,
      }),
    });
    const topEvent = {
      currentTarget: topmost,
      preventDefault: vi.fn(),
    } as unknown as Event;
    const backgroundEvent = {
      currentTarget: background,
      preventDefault: vi.fn(),
    } as unknown as Event;

    preventBackgroundDialogEscape(topEvent);
    preventBackgroundDialogEscape(backgroundEvent);

    expect(topEvent.preventDefault).not.toHaveBeenCalled();
    expect(backgroundEvent.preventDefault).toHaveBeenCalledOnce();
    await Promise.resolve();
  });
});
