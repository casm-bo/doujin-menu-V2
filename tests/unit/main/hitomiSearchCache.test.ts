import { beforeEach, describe, expect, it, vi } from "vitest";

const hitomiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("node-hitomi", () => ({
  hitomi: {
    galleries: { list: hitomiMocks.list, retrieve: vi.fn() },
    tags: { parse: hitomiMocks.parse },
  },
  Extension: { Avif: "avif", Webp: "webp" },
  ThumbnailSize: { Small: "small" },
  SortType: {
    PopularityDay: "today",
    PopularityWeek: "week",
    PopularityMonth: "month",
    PopularityYear: "year",
  },
}));

import { HitomiService } from "../../../src/main/services/hitomi/hitomiService.js";

describe("Hitomi search result cache", () => {
  let service: HitomiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HitomiService();
  });

  it("reuses the same ID list for equivalent queries", async () => {
    hitomiMocks.list.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const first = await service.searchGalleries({ searchQuery: "foo  bar" });
    const second = await service.searchGalleries({ searchQuery: "foo bar" });

    expect(hitomiMocks.list).toHaveBeenCalledTimes(1);
    expect(second.generation).toBe(first.generation);
  });

  it("applies popularity, blacklist, and range options", async () => {
    hitomiMocks.list.mockResolvedValue([{ id: 10 }, { id: 20 }, { id: 30 }]);
    hitomiMocks.parse.mockImplementation((expression: string) => {
      const isNegative = expression.startsWith("-");
      const [type, name] = expression.replace(/^-/, "").split(":");
      return [{ type, name, isNegative }];
    });

    const result = await service.searchGalleries({
      searchQuery: "language:korean",
      popularityOrderBy: "day",
      blacklistTags: ["male:yaoi"],
      start: 1,
      count: 1,
    });

    expect(hitomiMocks.list).toHaveBeenCalledWith({
      title: undefined,
      tags: [
        { type: "language", name: "korean", isNegative: false },
        { type: "male", name: "yaoi", isNegative: true },
      ],
      orderBy: "today",
    });
    expect(result).toMatchObject({ data: [20], total: 3, hasNextPage: true });
  });
});
