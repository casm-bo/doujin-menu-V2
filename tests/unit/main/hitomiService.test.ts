import { beforeEach, describe, expect, it, vi } from "vitest";

const hitomiMocks = vi.hoisted(() => ({
  getGalleryIds: vi.fn(),
  getParsedTags: vi.fn(),
  getGallery: vi.fn(),
  getImageUri: vi.fn(),
  synchronize: vi.fn(),
}));

vi.mock("node-hitomi", () => ({
  default: {
    getGalleryIds: hitomiMocks.getGalleryIds,
    getParsedTags: hitomiMocks.getParsedTags,
    getGallery: hitomiMocks.getGallery,
    ImageUriResolver: {
      getImageUri: hitomiMocks.getImageUri,
      synchronize: hitomiMocks.synchronize,
    },
  },
}));

import { HitomiService } from "../../../src/main/services/hitomi/hitomiService";

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
    expect(hitomiMocks.getGalleryIds).not.toHaveBeenCalled();
  });

  it("일반 검색어와 필터를 분리하고 페이지네이션한다", async () => {
    const ids = Array.from({ length: 70 }, (_, index) => index + 1);
    const parsedTags = [{ type: "language", name: "korean" }];
    hitomiMocks.getGalleryIds.mockResolvedValue(ids);
    hitomiMocks.getParsedTags.mockReturnValue(parsedTags);

    const result = await service.searchGalleries({
      query: {
        searchQuery: "sample title language:korean",
        offset: 1,
      },
      page: 2,
    });

    expect(hitomiMocks.getParsedTags).toHaveBeenCalledWith("language:korean");
    expect(hitomiMocks.getGalleryIds).toHaveBeenCalledWith({
      title: "sample title",
      tags: parsedTags,
    });
    expect(result.data).toEqual(ids.slice(31, 61));
    expect(result.hasNextPage).toBe(true);
  });

  it("갤러리 상세에 HTTPS 썸네일 URL을 추가한다", async () => {
    const coverFile = { index: 0, hasWebp: true };
    hitomiMocks.getGallery.mockResolvedValue({
      id: 10,
      files: [coverFile],
    });
    hitomiMocks.getImageUri.mockReturnValue("thumbnail.example/cover.webp");

    const result = await service.getGalleryDetails(10);

    expect(hitomiMocks.getImageUri).toHaveBeenCalledWith(coverFile, "webp", {
      isThumbnail: true,
    });
    expect(result.thumbnailUrl).toBe("https://thumbnail.example/cover.webp");
  });

  it("지원 형식에 따라 전체 이미지 URL을 생성한다", async () => {
    const webpFile = { index: 0, hasWebp: true };
    const avifFile = { index: 1, hasWebp: false };
    hitomiMocks.getGallery.mockResolvedValue({
      id: 20,
      files: [webpFile, avifFile],
    });
    hitomiMocks.getImageUri
      .mockReturnValueOnce("images.example/1.webp")
      .mockReturnValueOnce("images.example/2.avif");

    const result = await service.getGalleryImageUrls(20);

    expect(hitomiMocks.getImageUri).toHaveBeenNthCalledWith(
      1,
      webpFile,
      "webp",
      undefined,
    );
    expect(hitomiMocks.getImageUri).toHaveBeenNthCalledWith(
      2,
      avifFile,
      "avif",
      undefined,
    );
    expect(result).toEqual([
      "https://images.example/1.webp",
      "https://images.example/2.avif",
    ]);
  });

  it("존재하지 않는 갤러리는 명확한 오류를 반환한다", async () => {
    hitomiMocks.getGallery.mockResolvedValue(null);

    await expect(service.getGallery(404)).rejects.toThrow(
      "Gallery with ID 404 not found.",
    );
  });
});
