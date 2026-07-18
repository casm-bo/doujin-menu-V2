import { beforeEach, describe, expect, it, vi } from "vitest";

const hitomiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  parse: vi.fn(),
  retrieve: vi.fn(),
}));

vi.mock("node-hitomi", () => ({
  default: {
    galleries: {
      list: hitomiMocks.list,
      retrieve: hitomiMocks.retrieve,
    },
    tags: {
      parse: hitomiMocks.parse,
    },
  },
  Extension: {
    Avif: "avif",
    Webp: "webp",
  },
  ThumbnailSize: {
    Small: "small",
  },
}));

import { HitomiService } from "../../../src/main/services/hitomi/hitomiService";

const createGallery = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  title: { display: "Sample", japanese: null },
  type: "manga",
  language: { name: "Korean", localName: "한국어" },
  artists: [{ type: "artist", name: "artist", isNegative: false }],
  groups: [{ type: "group", name: "group", isNegative: false }],
  series: [{ type: "series", name: "series", isNegative: false }],
  characters: [{ type: "character", name: "character", isNegative: false }],
  tags: [{ type: "male", name: "sample", isNegative: false }],
  files: [],
  publishedDate: null,
  translations: [],
  relations: [],
  ...overrides,
});

describe("HitomiService", () => {
  let service: HitomiService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HitomiService();
  });

  it("id 검색은 원격 검색 없이 해당 갤러리만 반환한다", async () => {
    const result = await service.searchGalleries({
      query: { searchQuery: "id:123456 language:korean" },
    });

    expect(result).toEqual({ data: [123456], hasNextPage: false });
    expect(hitomiMocks.list).not.toHaveBeenCalled();
  });

  it("일반 검색어와 필터를 분리하고 페이지네이션한다", async () => {
    const ids = Array.from({ length: 70 }, (_, index) => index + 1);
    const references = ids.map((id) => ({ id }));
    const parsedTags = [{ type: "language", name: "korean" }];
    hitomiMocks.list.mockResolvedValue(references);
    hitomiMocks.parse.mockReturnValue(parsedTags);

    const result = await service.searchGalleries({
      query: {
        searchQuery: "sample title language:korean",
        offset: 1,
      },
      page: 2,
    });

    expect(hitomiMocks.parse).toHaveBeenCalledWith("language:korean");
    expect(hitomiMocks.list).toHaveBeenCalledWith({
      title: "sample title",
      tags: parsedTags,
    });
    expect(result.data).toEqual(ids.slice(31, 61));
    expect(result.hasNextPage).toBe(true);
  });

  it("갤러리를 직렬화하고 HTTPS 썸네일 URL을 추가한다", async () => {
    const resolveUrl = vi
      .fn()
      .mockResolvedValue("//thumbnail.example/cover.webp");
    const coverFile = {
      hash: "hash",
      name: "cover.jpg",
      width: 1200,
      height: 1600,
      hasAvif: true,
      hasWebp: true,
      hasJxl: false,
      resolveUrl,
    };
    hitomiMocks.retrieve.mockResolvedValue(
      createGallery({
        id: 10,
        files: [coverFile],
        relations: [{ id: 99 }],
      }),
    );

    const result = await service.getGalleryDetails(10);

    expect(resolveUrl).toHaveBeenCalledWith("webp", "small");
    expect(result.thumbnailUrl).toBe("https://thumbnail.example/cover.webp");
    expect(result.artists).toEqual(["artist"]);
    expect(result.languageName).toEqual({
      english: "Korean",
      local: "한국어",
    });
    expect(result.relatedIds).toEqual([99]);
    expect(result.files[0]).toMatchObject({ index: 0, hash: "hash" });
  });

  it("지원 형식에 따라 전체 이미지 URL을 비동기로 생성한다", async () => {
    const webpResolver = vi.fn().mockResolvedValue("//images.example/1.webp");
    const avifResolver = vi.fn().mockResolvedValue("//images.example/2.avif");
    const webpFile = { hasWebp: true, resolveUrl: webpResolver };
    const avifFile = { hasWebp: false, resolveUrl: avifResolver };
    hitomiMocks.retrieve.mockResolvedValue(
      createGallery({ id: 20, files: [webpFile, avifFile] }),
    );

    const result = await service.getGalleryImageUrls(20);

    expect(webpResolver).toHaveBeenCalledWith("webp", undefined);
    expect(avifResolver).toHaveBeenCalledWith("avif", undefined);
    expect(result).toEqual([
      "https://images.example/1.webp",
      "https://images.example/2.avif",
    ]);
  });

  it("존재하지 않는 갤러리는 명확한 오류를 반환한다", async () => {
    hitomiMocks.retrieve.mockResolvedValue(null);

    await expect(service.getGallery(404)).rejects.toThrow(
      "Gallery with ID 404 not found.",
    );
  });
});
