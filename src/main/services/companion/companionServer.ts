import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { networkInterfaces } from "os";
import type { AddressInfo } from "net";
import type {
  CompanionDevice,
  CompanionDeviceInfo,
  CompanionPairingCode,
  CompanionServerStatus,
} from "../../../types/companion.js";
import type {
  SearchGalleriesParams,
  SearchGalleriesResult,
} from "../hitomi/hitomiService.js";

const DEFAULT_PORT = 47831;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

interface CompanionHitomiService {
  searchGalleries(
    params: SearchGalleriesParams,
  ): Promise<SearchGalleriesResult>;
  getGalleryDetails(galleryId: number): Promise<unknown>;
  getGalleryImageUrls(galleryId: number): Promise<string[]>;
}

export interface CompanionDeviceStore {
  getDevices(): CompanionDevice[];
  setDevices(devices: CompanionDevice[]): void;
}

interface PairingState {
  code: string;
  expiresAt: number;
}

export class CompanionServer {
  private server: ReturnType<typeof createServer> | null = null;
  private port = DEFAULT_PORT;
  private pairingState: PairingState | null = null;

  constructor(
    private readonly hitomiService: CompanionHitomiService,
    private readonly deviceStore: CompanionDeviceStore,
  ) {}

  async start(port = DEFAULT_PORT): Promise<CompanionServerStatus> {
    if (this.server) return this.getStatus(true);

    this.server = createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        console.error("[Companion] Request failed:", error);
        this.sendJson(response, 500, {
          success: false,
          error: "Internal server error",
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => {
        server.off("listening", onListening);
        this.server = null;
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    });

    const address = this.server.address() as AddressInfo;
    this.port = address.port;
    return this.getStatus(true);
  }

  async stop(): Promise<void> {
    this.pairingState = null;
    if (!this.server) return;

    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  createPairingCode(): CompanionPairingCode {
    if (!this.server) {
      throw new Error("Companion server is not running.");
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
    this.pairingState = { code, expiresAt };

    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      port: this.port,
      addresses: getPrivateIpv4Addresses(),
    };
  }

  getStatus(enabled = this.server !== null): CompanionServerStatus {
    this.clearExpiredPairingCode();
    return {
      running: this.server !== null,
      enabled,
      port: this.port,
      addresses: getPrivateIpv4Addresses(),
      pairedDeviceCount: this.deviceStore.getDevices().length,
      pairingAvailable: this.pairingState !== null,
    };
  }

  getDevices(): CompanionDeviceInfo[] {
    return this.deviceStore.getDevices().map(toDeviceInfo);
  }

  revokeDevice(deviceId: string): boolean {
    const devices = this.deviceStore.getDevices();
    const remaining = devices.filter((device) => device.id !== deviceId);
    if (remaining.length === devices.length) return false;
    this.deviceStore.setDevices(remaining);
    return true;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!isPrivateNetworkAddress(request.socket.remoteAddress)) {
      this.sendJson(response, 403, { success: false, error: "Forbidden" });
      return;
    }

    const requestUrl = new URL(request.url || "/", "http://companion.local");
    const pathname = requestUrl.pathname;

    if (request.method === "GET" && pathname === "/v1/status") {
      this.sendJson(response, 200, {
        success: true,
        data: {
          service: "doujin-menu-companion",
          version: 1,
          pairingAvailable: this.getStatus().pairingAvailable,
        },
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/pair") {
      await this.handlePair(request, response);
      return;
    }

    const device = this.authenticate(request);
    if (!device) {
      this.sendJson(response, 401, {
        success: false,
        error: "Authentication required",
      });
      return;
    }

    if (request.method === "POST" && pathname === "/v1/hitomi/search") {
      const body = await this.readJsonBody(request);
      const searchQuery = body.searchQuery;
      const page = body.page;
      const offset = body.offset;
      if (
        typeof searchQuery !== "string" ||
        (page !== undefined &&
          (typeof page !== "number" || !Number.isInteger(page) || page < 1)) ||
        (offset !== undefined &&
          (typeof offset !== "number" ||
            !Number.isInteger(offset) ||
            offset < 0))
      ) {
        this.sendJson(response, 400, {
          success: false,
          error: "Invalid search request",
        });
        return;
      }

      const result = await this.hitomiService.searchGalleries({
        query: {
          searchQuery,
          offset: typeof offset === "number" ? offset : undefined,
        },
        page: typeof page === "number" ? page : 1,
      });
      this.sendJson(response, 200, { success: true, data: result });
      return;
    }

    const galleryMatch = pathname.match(
      /^\/v1\/hitomi\/gallery\/(\d+)(?:\/(pages))?$/,
    );
    if (request.method === "GET" && galleryMatch) {
      const galleryId = Number.parseInt(galleryMatch[1], 10);
      const data = galleryMatch[2]
        ? await this.hitomiService.getGalleryImageUrls(galleryId)
        : await this.hitomiService.getGalleryDetails(galleryId);
      this.sendJson(response, 200, { success: true, data });
      return;
    }

    this.sendJson(response, 404, { success: false, error: "Not found" });
  }

  private async handlePair(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    this.clearExpiredPairingCode();
    const body = await this.readJsonBody(request);
    if (
      !this.pairingState ||
      typeof body.code !== "string" ||
      body.code !== this.pairingState.code ||
      typeof body.deviceName !== "string" ||
      body.deviceName.trim().length === 0 ||
      body.deviceName.length > 100
    ) {
      this.sendJson(response, 401, {
        success: false,
        error: "Invalid or expired pairing code",
      });
      return;
    }

    this.pairingState = null;
    const token = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const device: CompanionDevice = {
      id: randomUUID(),
      name: body.deviceName.trim(),
      tokenHash: hashToken(token),
      pairedAt: now,
      lastSeenAt: now,
    };
    this.deviceStore.setDevices([...this.deviceStore.getDevices(), device]);

    this.sendJson(response, 201, {
      success: true,
      data: { device: toDeviceInfo(device), token },
    });
  }

  private authenticate(request: IncomingMessage): CompanionDevice | null {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) return null;

    const incomingHash = hashToken(authorization.slice("Bearer ".length));
    const devices = this.deviceStore.getDevices();
    const device = devices.find((item) => item.tokenHash === incomingHash);
    if (!device) return null;

    device.lastSeenAt = new Date().toISOString();
    this.deviceStore.setDevices(devices);
    return device;
  }

  private async readJsonBody(
    request: IncomingMessage,
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        throw new Error("Request body is too large.");
      }
      chunks.push(buffer);
    }

    if (chunks.length === 0) return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  }

  private sendJson(
    response: ServerResponse,
    statusCode: number,
    body: unknown,
  ): void {
    if (response.headersSent) return;
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify(body));
  }

  private clearExpiredPairingCode(): void {
    if (this.pairingState && this.pairingState.expiresAt <= Date.now()) {
      this.pairingState = null;
    }
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toDeviceInfo(device: CompanionDevice): CompanionDeviceInfo {
  return {
    id: device.id,
    name: device.name,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
  };
}

export function getPrivateIpv4Addresses(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (
        entry.family === "IPv4" &&
        !entry.internal &&
        isPrivateIpv4(entry.address)
      ) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses];
}

export function isPrivateNetworkAddress(address?: string): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (normalized === "::1" || normalized === "127.0.0.1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  return isPrivateIpv4(normalized);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}
