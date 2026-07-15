import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionDevice } from "../../../src/types/companion";
import {
  CompanionServer,
  type CompanionDeviceStore,
} from "../../../src/main/services/companion/companionServer";

describe("CompanionServer", () => {
  let devices: CompanionDevice[];
  let deviceStore: CompanionDeviceStore;
  let server: CompanionServer;
  let baseUrl: string;
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
    server = new CompanionServer(hitomiService, deviceStore);
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
});
