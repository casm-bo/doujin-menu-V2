import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionDevice } from "../../../src/types/companion";
import {
  CompanionServer,
  type CompanionDeviceStore,
  type CompanionDownloadService,
  type CompanionLibraryService,
  type CompanionSyncService,
} from "../../../src/main/services/companion/companionServer";
import { Readable } from "stream";

describe("CompanionServer", () => {
  let devices: CompanionDevice[];
  let deviceStore: CompanionDeviceStore;
  let server: CompanionServer;
  let baseUrl: string;
  let downloadService: CompanionDownloadService;
  let libraryService: CompanionLibraryService;
  let syncService: CompanionSyncService;
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
      getPath: vi.fn().mockResolvedValue({
        success: true,
        data: { configured: true },
      }),
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
    syncService = {
      bootstrap: vi.fn().mockResolvedValue({
        cursor: 0,
        serverTime: "2026-07-16T00:00:00.000Z",
        books: [],
        history: [],
      }),
      getChanges: vi.fn().mockResolvedValue({
        cursor: 0,
        hasMore: false,
        changes: [],
      }),
      applyMutations: vi.fn().mockResolvedValue({
        cursor: 1,
        serverTime: "2026-07-16T00:00:00.000Z",
        results: [],
      }),
    };
    server = new CompanionServer(
      hitomiService,
      deviceStore,
      downloadService,
      libraryService,
      syncService,
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

  it("rate limits repeated invalid pairing attempts", async () => {
    server.createPairingCode();
    const invalidRequest = () =>
      fetch(`${baseUrl}/v1/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "wrong", deviceName: "Phone" }),
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await invalidRequest()).status).toBe(401);
    }
    expect((await invalidRequest()).status).toBe(429);
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

  it("인증된 기기의 연결 상태 확인 요청을 처리한다", async () => {
    const token = await pairTestDevice();

    const response = await fetch(`${baseUrl}/v1/connection`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { connected: true },
    });
    expect(devices[0].lastSeenAt).not.toBeNull();
    expect(server.getDevices()[0].connectionState).toBe("connecting");
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(server.getDevices()[0].connectionState).toBe("connected");
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
    const { download_path: _downloadPath, ...safeItem } = item;
    void _downloadPath;
    expect((await listResponse.json()).data).toEqual([safeItem]);
    expect(addResponse.status).toBe(201);
    expect((await addResponse.json()).data).toEqual(safeItem);
    expect(downloadService.add).toHaveBeenCalledWith(123);
  });

  it("returns the desktop download path only to an authenticated device", async () => {
    const unauthenticated = await fetch(`${baseUrl}/v1/downloads/path`);
    expect(unauthenticated.status).toBe(401);

    const token = await pairTestDevice();
    const response = await fetch(`${baseUrl}/v1/downloads/path`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { configured: true },
    });
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
      syncId: "book-sync-id",
      title: "Desktop Gallery",
      pageCount: 2,
      modifiedAt: 1234,
      currentPage: 1,
      isFavorite: true,
      lastReadAt: "2026-07-16T00:00:00.000Z",
      stateVersion: 3,
      stateUpdatedAt: "2026-07-16T00:00:00.000Z",
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

  it("exposes cursor-based sync only to an authenticated device", async () => {
    const unauthenticated = await fetch(`${baseUrl}/v1/sync/bootstrap`);
    expect(unauthenticated.status).toBe(401);

    const token = await pairTestDevice();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
    const bootstrap = await fetch(`${baseUrl}/v1/sync/bootstrap`, { headers });
    const changes = await fetch(
      `${baseUrl}/v1/sync/changes?cursor=7&limit=50`,
      {
        headers,
      },
    );
    const push = await fetch(`${baseUrl}/v1/sync/changes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mutations: [
          {
            mutationId: "mutation-1",
            bookSyncId: "book-1",
            baseVersion: 2,
            currentPage: 5,
          },
        ],
      }),
    });

    expect(bootstrap.status).toBe(200);
    expect(changes.status).toBe(200);
    expect(push.status).toBe(200);
    expect(syncService.getChanges).toHaveBeenCalledWith(7, 50);
    expect(syncService.applyMutations).toHaveBeenCalledWith(
      expect.any(String),
      [
        {
          mutationId: "mutation-1",
          bookSyncId: "book-1",
          baseVersion: 2,
          currentPage: 5,
        },
      ],
    );
  });

  it("rejects malformed sync mutations", async () => {
    const token = await pairTestDevice();
    const response = await fetch(`${baseUrl}/v1/sync/changes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mutations: [{ mutationId: "bad", bookSyncId: "book-1" }],
      }),
    });

    expect(response.status).toBe(400);
    expect(syncService.applyMutations).not.toHaveBeenCalled();
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
