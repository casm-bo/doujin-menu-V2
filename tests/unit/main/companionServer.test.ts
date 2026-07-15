import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionDevice } from "../../../src/types/companion";
import {
  CompanionServer,
  type CompanionDeviceStore,
  type CompanionDownloadService,
  type CompanionLibraryService,
} from "../../../src/main/services/companion/companionServer";
import { Readable } from "stream";

describe("CompanionServer", () => {
  let devices: CompanionDevice[];
  let deviceStore: CompanionDeviceStore;
  let server: CompanionServer;
  let baseUrl: string;
  let downloadService: CompanionDownloadService;
  let libraryService: CompanionLibraryService;
  const hitomiService = {
    searchGalleries: vi.fn(),
    getGalleryDetails: vi.fn(),
    getGalleryImageUrls: vi.fn(),
  };

  beforeEach(async () => {
    devices = [];
    deviceStore = {
      getDevices: () => devices.map((device) => ({ ...device })),
      setDevices: (nextDevices) => {
        devices = nextDevices.map((device) => ({ ...device }));
      },
    };
    vi.clearAllMocks();
    downloadService = {
      getQueue: vi.fn().mockResolvedValue({ success: true, data: [] }),
      add: vi.fn(),
      remove: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      retry: vi.fn(),
      clearCompleted: vi.fn(),
    };
    libraryService = {
      listBooks: vi.fn().mockResolvedValue([]),
      getPageCount: vi.fn(),
      getCover: vi.fn(),
      getPage: vi.fn(),
    };
    server = new CompanionServer(
      hitomiService,
      deviceStore,
      downloadService,
      libraryService,
    );
    const status = await server.start(0);
    baseUrl = `http://127.0.0.1:${status.port}`;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("공개 상태 엔드포인트에서 서비스 정보를 반환한다", async () => {
    const response = await fetch(`${baseUrl}/v1/status`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { service: "doujin-menu-companion", version: 1 },
    });
  });

  it("인증되지 않은 Hitomi 요청을 거부한다", async () => {
    const response = await fetch(`${baseUrl}/v1/hitomi/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchQuery: "language:korean", page: 1 }),
    });

    expect(response.status).toBe(401);
    expect(hitomiService.searchGalleries).not.toHaveBeenCalled();
  });

  it("일회용 코드로 페어링한 기기는 Hitomi 검색을 사용할 수 있다", async () => {
    const pairing = server.createPairingCode();
    const pairResponse = await fetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code, deviceName: "Test Phone" }),
    });
    const pairBody = (await pairResponse.json()) as {
      data: { token: string; device: { name: string } };
    };

    expect(pairResponse.status).toBe(201);
    expect(pairBody.data.device.name).toBe("Test Phone");
    expect(devices).toHaveLength(1);
    expect(devices[0].tokenHash).not.toBe(pairBody.data.token);

    hitomiService.searchGalleries.mockResolvedValue({
      data: [123, 456],
      hasNextPage: false,
    });
    const searchResponse = await fetch(`${baseUrl}/v1/hitomi/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairBody.data.token}`,
      },
      body: JSON.stringify({
        searchQuery: "artist:sample language:korean",
        page: 2,
        offset: 3,
      }),
    });

    expect(searchResponse.status).toBe(200);
    expect(hitomiService.searchGalleries).toHaveBeenCalledWith({
      query: {
        searchQuery: "artist:sample language:korean",
        offset: 3,
      },
      page: 2,
    });
    expect(await searchResponse.json()).toEqual({
      success: true,
      data: { data: [123, 456], hasNextPage: false },
    });
  });

  it("페어링 코드는 한 번만 사용할 수 있다", async () => {
    const pairing = server.createPairingCode();
    const request = () =>
      fetch(`${baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pairing.code, deviceName: "Phone" }),
      });

    expect((await request()).status).toBe(201);
    expect((await request()).status).toBe(401);
  });

  it("연결 해제된 기기의 토큰을 거부한다", async () => {
    const pairing = server.createPairingCode();
    const pairResponse = await fetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code, deviceName: "Phone" }),
    });
    const pairBody = (await pairResponse.json()) as {
      data: { token: string; device: { id: string } };
    };
    server.revokeDevice(pairBody.data.device.id);

    const response = await fetch(`${baseUrl}/v1/hitomi/gallery/123`, {
      headers: { Authorization: `Bearer ${pairBody.data.token}` },
    });

    expect(response.status).toBe(401);
  });

  it("allows an authenticated device to list and add downloads", async () => {
    const token = await pairTestDevice();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const item = {
      id: 7,
      gallery_id: 123,
      gallery_title: "Sample",
      download_path: "C:\\Downloads",
      status: "pending" as const,
      progress: 0,
      total_files: 0,
      downloaded_files: 0,
      download_speed: 0,
      added_at: new Date().toISOString(),
      priority: 0,
    };
    vi.mocked(downloadService.getQueue).mockResolvedValue({
      success: true,
      data: [item],
    });
    vi.mocked(downloadService.add).mockResolvedValue({
      success: true,
      data: item,
    });

    const listResponse = await fetch(`${baseUrl}/v1/downloads`, { headers });
    const addResponse = await fetch(`${baseUrl}/v1/downloads`, {
      method: "POST",
      headers,
      body: JSON.stringify({ galleryId: 123 }),
    });

    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).data).toEqual([item]);
    expect(addResponse.status).toBe(201);
    expect(downloadService.add).toHaveBeenCalledWith(123);
  });

  it("forwards download queue control actions", async () => {
    const token = await pairTestDevice();
    const headers = { Authorization: `Bearer ${token}` };
    vi.mocked(downloadService.pause).mockResolvedValue({ success: true });
    vi.mocked(downloadService.clearCompleted).mockResolvedValue({
      success: true,
    });

    const pauseResponse = await fetch(`${baseUrl}/v1/downloads/7/pause`, {
      method: "POST",
      headers,
    });
    const clearResponse = await fetch(`${baseUrl}/v1/downloads/completed`, {
      method: "DELETE",
      headers,
    });

    expect(pauseResponse.status).toBe(200);
    expect(clearResponse.status).toBe(200);
    expect(downloadService.pause).toHaveBeenCalledWith(7);
    expect(downloadService.clearCompleted).toHaveBeenCalledOnce();
  });

  it("lists desktop library books using the Android API contract", async () => {
    const token = await pairTestDevice();
    const book = {
      id: 42,
      title: "Desktop Gallery",
      path: "C:\\Library\\Gallery",
      libraryPath: "C:\\Library",
      pageCount: 2,
      modifiedAt: 1234,
      artists: [{ name: "Artist" }],
      groups: [],
      series: [],
      characters: [],
      tags: [],
      coverUrl: "/v1/library/books/42/cover",
    };
    vi.mocked(libraryService.listBooks).mockResolvedValue([book]);

    const response = await fetch(`${baseUrl}/v1/library/books`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([book]);
  });

  it("returns page URLs and streams authenticated library images", async () => {
    const token = await pairTestDevice();
    const headers = { Authorization: `Bearer ${token}` };
    vi.mocked(libraryService.getPageCount).mockResolvedValue(2);
    vi.mocked(libraryService.getPage).mockResolvedValue({
      stream: Readable.from(Buffer.from("image-data")),
      contentType: "image/jpeg",
      contentLength: 10,
    });

    const pagesResponse = await fetch(`${baseUrl}/v1/library/books/42/pages`, {
      headers,
    });
    const imageResponse = await fetch(
      `${baseUrl}/v1/library/books/42/pages/1`,
      { headers },
    );

    expect((await pagesResponse.json()).data).toEqual([
      "/v1/library/books/42/pages/0",
      "/v1/library/books/42/pages/1",
    ]);
    expect(imageResponse.headers.get("content-type")).toBe("image/jpeg");
    expect(await imageResponse.text()).toBe("image-data");
    expect(libraryService.getPage).toHaveBeenCalledWith(42, 1);
  });

  it("requires authentication for desktop library covers", async () => {
    const response = await fetch(`${baseUrl}/v1/library/books/42/cover`);

    expect(response.status).toBe(401);
    expect(libraryService.getCover).not.toHaveBeenCalled();
  });

  async function pairTestDevice(): Promise<string> {
    const pairing = server.createPairingCode();
    const response = await fetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code, deviceName: "Phone" }),
    });
    const body = (await response.json()) as { data: { token: string } };
    return body.data.token;
  }
});
