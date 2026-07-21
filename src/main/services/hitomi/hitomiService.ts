import {
  Extension,
  ThumbnailSize,
  hitomi,
  type Gallery,
  type Image,
} from "node-hitomi";
import type {
  HitomiGallery as SerializableHitomiGallery,
  HitomiGalleryDetails,
} from "../../../types/hitomi.js";

export interface SearchGalleriesParams {
  query: {
    searchQuery: string;
    offset?: number;
  };
  page?: number;
}

export interface SearchGalleriesResult {
  data: number[];
  hasNextPage: boolean;
}

export type HitomiGallery = Gallery;
export type HitomiGalleryFile = Image;

const SEARCH_PAGE_SIZE = 30;

/**
 * Electron 전송 계층과 무관한 Hitomi 도메인 서비스입니다.
 * IPC와 Companion API는 모두 이 서비스를 통해 동일한 검색/조회 로직을 사용합니다.
 */
export class HitomiService {
  async searchGalleries({
    query,
    page = 1,
  }: SearchGalleriesParams): Promise<SearchGalleriesResult> {
    const terms = query.searchQuery
      .toLowerCase()
      .split(" ")
      .filter((term) => term.length > 0);

    for (const term of terms) {
      if (!term.startsWith("id:")) continue;

      const galleryId = Number.parseInt(term.substring(3).trim(), 10);
      if (!Number.isNaN(galleryId)) {
        return {
          data: [galleryId],
          hasNextPage: false,
        };
      }
    }

    const trimmedQuery = query.searchQuery.trim();
    let ids: number[];

    if (trimmedQuery) {
      const title: string[] = [];
      const tags: string[] = [];

      trimmedQuery.split(" ").forEach((text) => {
        if (text.includes(":")) {
          tags.push(text);
        } else {
          title.push(text);
        }
      });

      const references = await hitomi.galleries.list({
        title: title.length > 0 ? title.join(" ") : undefined,
        tags: tags.length > 0 ? hitomi.tags.parse(tags.join(" ")) : undefined,
      });
      ids = references.map((reference) => reference.id);
    } else {
      const references = await hitomi.galleries.list();
      ids = references.map((reference) => reference.id);
    }

    const offset =
      (Math.max(page, 1) - 1) * SEARCH_PAGE_SIZE + (query.offset || 0);
    const data = ids.slice(offset, offset + SEARCH_PAGE_SIZE);

    return {
      data,
      hasNextPage: ids.length > offset + SEARCH_PAGE_SIZE,
    };
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
        name: tag.name,
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
