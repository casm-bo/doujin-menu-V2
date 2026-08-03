import { describe, expect, it } from "vitest";
import { getSeriesResumeTarget } from "../../../src/renderer/components/feature/seriesResume";
import type { Book } from "../../../src/types/ipc";

const book = (id: number, current_page = 1, last_read_at?: string) =>
  ({ id, current_page, last_read_at }) as Book;

describe("getSeriesResumeTarget", () => {
  it("resumes the most recently read episode at its saved page", () => {
    const target = getSeriesResumeTarget([
      book(1, 8, "2026-01-01T00:00:00Z"),
      book(2, 3, "2026-02-01T00:00:00Z"),
    ]);

    expect(target).toMatchObject({ book: { id: 2 }, page: 3 });
  });

  it("starts from the first episode when no progress exists", () => {
    expect(getSeriesResumeTarget([book(1), book(2)])).toMatchObject({
      book: { id: 1 },
      page: 1,
    });
  });
});
