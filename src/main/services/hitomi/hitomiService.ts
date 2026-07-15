import hitomi from "node-hitomi";

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

export type HitomiGallery = Awaited<ReturnType<typeof hitomi.getGallery>>;
export type HitomiGalleryFile = HitomiGallery["files"][number];

const SEARCH_PAGE_SIZE = 30;
const IMAGE_RESOLVER_SYNC_INTERVAL_MS = 30_000;

/**
 * Electron 전송 계층과 무관한 Hitomi 도메인 서비스입니다.
 * IPC와 Companion API는 모두 이 서비스를 통해 동일한 검색/조회 로직을 사용합니다.
 */
export class HitomiService {
  private resolverSyncTimer: ReturnType<typeof setInterval> | null = null;

  async synchronizeImageResolver(): Promise<void> {
    await hitomi.ImageUriResolver.synchronize();
  }

  startImageResolverSynchronization(
    intervalMs = IMAGE_RESOLVER_SYNC_INTERVAL_MS,
  ): void {
    if (this.resolverSyncTimer) return;

    this.resolverSyncTimer = setInterval(() => {
      this.synchronizeImageResolver().catch((error) => {
        console.error("Failed to synchronize Hitomi image resolver:", error);
      });
    }, intervalMs);
  }

  stopImageResolverSynchronization(): void {
    if (!this.resolverSyncTimer) return;
    clearInterval(this.resolverSyncTimer);
    this.resolverSyncTimer = null;
  }

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

      ids = await hitomi.getGalleryIds({
        title: title.length > 0 ? title.join(" ") : undefined,
        tags:
          tags.length > 0 ? hitomi.getParsedTags(tags.join(" ")) : undefined,
      });
    } else {
      ids = await hitomi.getGalleryIds();
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
    const gallery = await hitomi.getGallery(galleryId);
    if (!gallery) {
      throw new Error(`Gallery with ID ${galleryId} not found.`);
    }
    return gallery;
  }

  resolveImageUrl(
    file: HitomiGalleryFile,
    options?: { isThumbnail?: boolean },
  ): string {
    const extension = options?.isThumbnail
      ? "webp"
      : file.hasWebp
        ? "webp"
        : "avif";
    const imageUrl = hitomi.ImageUriResolver.getImageUri(
      file,
      extension,
      options?.isThumbnail ? { isThumbnail: true } : undefined,
    );
    return `https://${imageUrl}`;
  }

  async getGalleryDetails(galleryId: number) {
    const gallery = await this.getGallery(galleryId);
    const coverFile = gallery.files[0];
    if (!coverFile) {
      throw new Error(`Gallery with ID ${galleryId} has no image files.`);
    }

    return {
      ...gallery,
      thumbnailUrl: this.resolveImageUrl(coverFile, { isThumbnail: true }),
    };
  }

  async getGalleryImageUrls(galleryId: number): Promise<string[]> {
    const gallery = await this.getGallery(galleryId);
    return gallery.files.map((file) => this.resolveImageUrl(file));
  }
}

export const hitomiService = new HitomiService();
