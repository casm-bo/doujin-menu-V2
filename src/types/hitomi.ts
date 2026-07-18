export interface HitomiImage {
  index: number;
  hash: string;
  name: string;
  hasAvif: boolean;
  hasWebp: boolean;
  hasJxl: boolean;
  width: number;
  height: number;
}

export interface HitomiTag {
  type:
    | "artist"
    | "group"
    | "type"
    | "language"
    | "series"
    | "character"
    | "male"
    | "female"
    | "tag";
  name: string;
  isNegative?: boolean;
}

export interface HitomiLanguageName {
  english: string | null;
  local: string | null;
}

/**
 * Serializable gallery shape used across Electron IPC.
 *
 * node-hitomi v9 returns class instances with manager references and methods,
 * so the main process converts them to this stable application-owned DTO.
 */
export interface HitomiGallery {
  id: number;
  title: {
    display: string;
    japanese: string | null;
  };
  type: "doujinshi" | "manga" | "artistcg" | "gamecg" | "imageset" | "anime";
  languageName: HitomiLanguageName;
  artists: string[];
  groups: string[];
  series: string[];
  characters: string[];
  tags: HitomiTag[];
  files: HitomiImage[];
  publishedDate: Date | null;
  translations: Array<{
    id: number;
    languageName: HitomiLanguageName;
  }>;
  relatedIds: number[];
}

export interface HitomiGalleryDetails extends HitomiGallery {
  thumbnailUrl: string;
}
