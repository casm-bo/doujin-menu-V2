import { describe, expect, it } from "vitest";
import type { Book } from "../../../src/main/db/types";
import { detectAndroidStyleSeriesCandidates } from "../../../src/main/services/seriesDetection/seriesDetector";

function book(id: number, title: string, artists: string[]): Book {
  return {
    id,
    title,
    volume: null,
    path: `C:/books/${id}`,
    cover_path: null,
    page_count: 1,
    added_at: "2026-07-16T00:00:00.000Z",
    last_read_at: null,
    current_page: null,
    is_favorite: false,
    artists: artists.map((name, index) => ({ id: index + 1, name })),
  };
}

describe("Android-compatible desktop series detection", () => {
  it("groups normalized similar titles only when the books share an artist", async () => {
    const result = await detectAndroidStyleSeriesCandidates([
      book(1, "만화1 전편", ["ABC"]),
      book(2, "만화2 중편", ["ABC", "bcd"]),
      book(3, "만화3 후편", ["ABC"]),
      book(4, "만화4 완결", ["different artist"]),
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].books.map(({ book: item }) => item.id)).toEqual(
      [1, 2, 3],
    );
  });

  it("does not group identical title stems when there is no shared artist", async () => {
    const result = await detectAndroidStyleSeriesCandidates([
      book(1, "Comic 1", ["artist A"]),
      book(2, "Comic 2", ["artist B"]),
    ]);

    expect(result.candidates).toHaveLength(0);
  });

  it("keeps existing names intact and makes a unique name for a new series", async () => {
    const result = await detectAndroidStyleSeriesCandidates(
      [book(1, "Comic 2", ["artist"]), book(2, "Comic 1", ["artist"])],
      ["Comic"],
    );

    expect(result.candidates[0].seriesName).toBe("Comic (2)");
    expect(result.candidates[0].books.map(({ book: item }) => item.id)).toEqual(
      [2, 1],
    );
    expect(result.candidates[0].books.map((item) => item.orderIndex)).toEqual([
      1, 2,
    ]);
  });
});
