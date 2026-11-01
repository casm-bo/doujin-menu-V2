// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, h, nextTick, ref, type App } from "vue";
const actions = vi.hoisted(() => ({
  download: vi.fn(),
  copy: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/composable/useGalleryBorders", () => ({
  useGalleryBorders: () => ({ borderStyle: () => ({ borderWidth: "3px" }) }),
}));
vi.mock("@/composable/useGalleryCard", () => ({
  useGalleryCard: (props: { gallery: { title: { display: string } } }) => ({
    displayTitle: computed(() => props.gallery.title.display),
    buttonText: ref("다운로드"),
    isDeleteDialogOpen: ref(false),
    isDownloading: ref(false),
    isDownloadCompleted: ref(false),
    isInLibrary: ref(false),
    isDownloadFailed: ref(false),
    permanentDelete: ref(false),
    handleDownload: actions.download,
    copyToClipboard: actions.copy,
    handleOpenBook: actions.open,
  }),
}));
vi.mock("@/components/common/ProxiedImage.vue", () => ({
  default: { render: () => h("img") },
}));
import type { HitomiGalleryDetails } from "../../../src/types/hitomi";
import Grid from "../../../src/renderer/components/feature/downloader/GalleryThumbnailCard.vue";
import Row from "../../../src/renderer/components/feature/downloader/GalleryRowCard.vue";
const apps: App[] = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  vi.clearAllMocks();
});
for (const component of [Grid, Row]) {
  it(`${component === Grid ? "grid" : "row"} opens detail once and isolates tag/download actions`, async () => {
    const zoom = ref(1);
    const select = vi.fn(),
      preview = vi.fn();
    const host = document.createElement("div");
    const gallery: HitomiGalleryDetails = {
      id: 42,
      title: { display: "한국어 제목", japanese: null },
      type: "manga",
      artists: ["Sample"],
      groups: [],
      series: [],
      characters: [],
      tags: [{ type: "female", name: "sample" }],
      files: [],
      translations: [],
      relatedIds: [],
      languageName: { local: "한국어", english: "korean" },
      thumbnailUrl: "",
      publishedDate: new Date("2026-01-01"),
    };
    const app = createApp({
      render: () =>
        h(component, {
          gallery,
          ...(component === Row ? { thumbnailZoom: zoom.value } : {}),
          onSelectGallery: select,
          onPreviewGallery: preview,
        }),
    });
    apps.push(app);
    app.mount(host);
    const title = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "한국어 제목")!;
    title.click();
    expect(preview).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    const download = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "다운로드")!;
    download.click();
    expect(actions.download).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    const tag = Array.from(
      host.querySelectorAll<HTMLElement>('button, [data-slot="badge"]'),
    ).find((element) => element.textContent?.trim() === "sample")!;
    tag.click();
    expect(actions.copy).toHaveBeenCalledWith("female:sample");
    expect(select).not.toHaveBeenCalled();
    (host.firstElementChild as HTMLElement).click();
    expect(select).toHaveBeenCalledTimes(1);
    if (component === Row) {
      expect(
        host.querySelector<HTMLElement>("[data-row-cover]")?.style.width,
      ).toBe("160px");
      zoom.value = 1.2;
      await nextTick();
      expect(
        host.querySelector<HTMLElement>("[data-row-cover]")?.style.width,
      ).toBe("192px");
    }
  });
}
