import {
  Extension,
  SortType,
  ThumbnailSize,
  hitomi,
  type Gallery,
  type GalleryOptions,
  type Image,
  type Tag,
} from "node-hitomi";
import type {
  HitomiGallery as SerializableHitomiGallery,
  HitomiGalleryDetails,
} from "../../../types/hitomi.js";
import { normalizeTagName } from "../../utils/tagName.js";

export interface SearchGalleriesParams {
  query?: {
    searchQuery: string;
    offset?: number;
  };
  page?: number;
  searchQuery?: string;
  popularityOrderBy?: "" | "day" | "week" | "month" | "year";
  start?: number;
  count?: number;
  blacklistTags?: string[];
}

export interface SearchGalleriesResult {
  data: number[];
  hasNextPage: boolean;
  total?: number;
  generation?: number;
}

export type HitomiGallery = Gallery;
export type HitomiGalleryFile = Image;

const SEARCH_PAGE_SIZE = 30;
const ID_CACHE_TTL_MS = 5 * 60 * 1000;
const ID_CACHE_MAX = 3;
const ID_CACHE_SKIP_OVER = 2_000_000;

interface CachedGalleryIds {
  ids: Int32Array;
  cachedAt: number;
  generation: number;
}

/**
 * Electron 전송 계층과 무관한 Hitomi 도메인 서비스입니다.
 * IPC와 Companion API는 모두 이 서비스를 통해 동일한 검색/조회 로직을 사용합니다.
 */
export class HitomiService {
  private readonly idCache = new Map<string, CachedGalleryIds>();
  private generationCounter = 0;

  async searchGalleries({
    query,
    page = 1,
    searchQuery,
    popularityOrderBy = "",
    start,
    count = SEARCH_PAGE_SIZE,
    blacklistTags = [],
  }: SearchGalleriesParams): Promise<SearchGalleriesResult> {
    const resolvedQuery = searchQuery ?? query?.searchQuery ?? "";
    const requestedStart =
      start ??
      (Math.max(page, 1) - 1) * SEARCH_PAGE_SIZE + (query?.offset || 0);
    const resolvedStart = Math.max(0, Math.trunc(requestedStart));
    const resolvedCount = Math.max(1, Math.min(100, Math.trunc(count)));
    const terms = resolvedQuery
      .toLowerCase()
      .split(" ")
      .filter((term) => term.length > 0);

    for (const term of terms) {
      const value = term.startsWith("id:") ? term.substring(3).trim() : term;
      if (!/^\d+$/.test(value)) continue;

      const galleryId = Number.parseInt(value, 10);
      if (!Number.isNaN(galleryId)) {
        return {
          data: [galleryId],
          hasNextPage: false,
          ...(searchQuery !== undefined ? { total: 1, generation: 0 } : {}),
        };
      }
    }

    const entry = await this.getCachedGalleryIds(
      resolvedQuery,
      popularityOrderBy,
      blacklistTags,
    );
    const data = Array.from(
      entry.ids.slice(resolvedStart, resolvedStart + resolvedCount),
    );

    return {
      data,
      hasNextPage: entry.ids.length > resolvedStart + resolvedCount,
      total: entry.ids.length,
      generation: entry.generation,
    };
  }

  private async getCachedGalleryIds(
    searchQuery: string,
    popularityOrderBy: "" | "day" | "week" | "month" | "year",
    blacklistTags: string[],
  ): Promise<CachedGalleryIds> {
    const key = [
      searchQuery.trim().split(/\s+/).filter(Boolean).join(" "),
      popularityOrderBy,
      [...blacklistTags].sort().join(","),
    ].join("|");
    const cached = this.idCache.get(key);
    if (cached && Date.now() - cached.cachedAt < ID_CACHE_TTL_MS) return cached;

    const ids = await this.fetchGalleryIds(
      searchQuery,
      popularityOrderBy,
      blacklistTags,
    );
    const entry = {
      ids: Int32Array.from(ids),
      cachedAt: Date.now(),
      generation: ++this.generationCounter,
    };

    if (ids.length <= ID_CACHE_SKIP_OVER) {
      if (!this.idCache.has(key) && this.idCache.size >= ID_CACHE_MAX) {
        const oldest = [...this.idCache.entries()].sort(
          ([, a], [, b]) => a.cachedAt - b.cachedAt,
        )[0]?.[0];
        if (oldest) this.idCache.delete(oldest);
      }
      this.idCache.set(key, entry);
    }

    return entry;
  }

  private async fetchGalleryIds(
    searchQuery: string,
    popularityOrderBy: "" | "day" | "week" | "month" | "year",
    blacklistTags: string[],
  ): Promise<number[]> {
    const titleTerms: string[] = [];
    const tagTerms: string[] = [];
    for (const term of searchQuery.trim().split(/\s+/).filter(Boolean)) {
      (term.includes(":") ? tagTerms : titleTerms).push(term);
    }

    const parsedTags = tagTerms.length
      ? hitomi.tags.parse(tagTerms.join(" "))
      : [];
    const seen = new Set(parsedTags.map((tag) => `${tag.type}:${tag.name}`));
    const negativeTags: Tag[] = [];
    for (const raw of blacklistTags) {
      try {
        const [tag] = hitomi.tags.parse(raw.startsWith("-") ? raw : `-${raw}`);
        if (!tag) continue;
        const key = `${tag.type}:${tag.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        negativeTags.push(tag);
      } catch {
        // 잘못 저장된 태그 하나 때문에 전체 검색을 실패시키지 않습니다.
      }
    }

    const orderByMap = {
      day: SortType.PopularityDay,
      week: SortType.PopularityWeek,
      month: SortType.PopularityMonth,
      year: SortType.PopularityYear,
    } as const;
    const options: GalleryOptions = {
      title: titleTerms.length ? titleTerms.join(" ") : undefined,
      tags:
        parsedTags.length || negativeTags.length
          ? [...parsedTags, ...negativeTags].sort(
              (a, b) => Number(a.isNegative) - Number(b.isNegative),
            )
          : undefined,
    };
    if (popularityOrderBy) options.orderBy = orderByMap[popularityOrderBy];

    const references = await hitomi.galleries.list(options);
    return references.map((reference) => reference.id);
  }

  async getGallery(galleryId: number): Promise<HitomiGallery> {
    const gallery = await hitomi.galleries.retrieve(galleryId);
    if (!gallery) {
      throw new Error(`Gallery with ID ${galleryId} not found.`);
    }
    return gallery;
  }

  async resolveImageUrl(
    file: HitomiGalleryFile,
    options?: { isThumbnail?: boolean },
  ): Promise<string> {
    const extension = file.hasWebp ? Extension.Webp : Extension.Avif;
    const imageUrl = await file.resolveUrl(
      extension,
      options?.isThumbnail ? ThumbnailSize.Small : undefined,
    );
    return imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl;
  }

  toSerializableGallery(gallery: HitomiGallery): SerializableHitomiGallery {
    const toLanguageName = (
      language: HitomiGallery["language"],
    ): SerializableHitomiGallery["languageName"] => ({
      english: language?.name ?? null,
      local: language?.localName ?? null,
    });

    return {
      id: gallery.id,
      title: {
        display: gallery.title.display,
        japanese: gallery.title.japanese,
      },
      type: gallery.type,
      languageName: toLanguageName(gallery.language),
      artists: gallery.artists.map((tag) => tag.name),
      groups: gallery.groups.map((tag) => tag.name),
      series: gallery.series.map((tag) => tag.name),
      characters: gallery.characters.map((tag) => tag.name),
      tags: gallery.tags.map((tag) => ({
        type: tag.type,
        name: normalizeTagName(tag.name),
        isNegative: tag.isNegative,
      })),
      files: gallery.files.map((file, index) => ({
        index,
        hash: file.hash,
        name: file.name,
        hasAvif: file.hasAvif,
        hasWebp: file.hasWebp,
        hasJxl: file.hasJxl,
        width: file.width,
        height: file.height,
      })),
      publishedDate: gallery.publishedDate,
      translations: gallery.translations.map((translation) => ({
        id: translation.id,
        languageName: toLanguageName(translation.language),
      })),
      relatedIds: gallery.relations.map((relation) => relation.id),
    };
  }

  async getGalleryDetails(galleryId: number): Promise<HitomiGalleryDetails> {
    const gallery = await this.getGallery(galleryId);
    const coverFile = gallery.files[0];
    if (!coverFile) {
      throw new Error(`Gallery with ID ${galleryId} has no image files.`);
    }

    return {
      ...this.toSerializableGallery(gallery),
      thumbnailUrl: await this.resolveImageUrl(coverFile, {
        isThumbnail: true,
      }),
    };
  }

  async getGalleryImageUrls(galleryId: number): Promise<string[]> {
    const gallery = await this.getGallery(galleryId);
    return Promise.all(gallery.files.map((file) => this.resolveImageUrl(file)));
  }
}

export const hitomiService = new HitomiService();
