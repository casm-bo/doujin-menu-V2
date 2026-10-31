export interface GalleryBorderStyle {
  width: number;
  color: string;
}

export type GalleryBorderKind = "normal" | "series" | "favorite";
export type GalleryBorders = Record<GalleryBorderKind, GalleryBorderStyle>;

export const DEFAULT_GALLERY_BORDERS: GalleryBorders = {
  normal: { width: 3, color: "#b0a6bc" },
  series: { width: 3, color: "#e53935" },
  favorite: { width: 3, color: "#e6a000" },
};

export function isGalleryBorders(value: unknown): value is GalleryBorders {
  if (!value || typeof value !== "object") return false;
  return (["normal", "series", "favorite"] as const).every((kind) => {
    const style = (value as GalleryBorders)[kind];
    return (
      style &&
      Number.isFinite(style.width) &&
      style.width >= 0 &&
      style.width <= 6 &&
      typeof style.color === "string" &&
      /^#[a-f\d]{6}$/i.test(style.color)
    );
  });
}

export function galleryBorderStyle(
  borders: GalleryBorders,
  series = false,
  favorite = false,
) {
  const style = borders[favorite ? "favorite" : series ? "series" : "normal"];
  return {
    borderWidth: `${style.width}px`,
    borderColor: style.color,
    borderStyle: "solid" as const,
  };
}
