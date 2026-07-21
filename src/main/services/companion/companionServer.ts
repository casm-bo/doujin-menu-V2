import { createHash, randomBytes, randomInt, randomUUID } from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { networkInterfaces } from "os";
import type { AddressInfo } from "net";
import type { Readable } from "stream";
import type {
  CompanionDevice,
  CompanionDeviceInfo,
  CompanionPairingCode,
  CompanionServerStatus,
  CompanionSyncMutation,
  CompanionSyncMutationResult,
} from "../../../types/companion.js";
import { notifyCompanionLibraryChanged } from "./companionSyncSignal.js";
import type {
  SearchGalleriesParams,
  SearchGalleriesResult,
} from "../hitomi/hitomiService.js";
import type { DownloadQueueItem } from "../../../types/ipc.js";

const DEFAULT_PORT = 47831;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_ATTEMPT_WINDOW_MS = 60 * 1000;
const MAX_PAIRING_ATTEMPTS_PER_WINDOW = 5;
const MAX_SYNC_MUTATIONS_PER_REQUEST = 100;
const DEVICE_CONNECTION_TIMEOUT_MS = 7_000;
const DEVICE_CONNECTING_VISIBLE_MS = 1_200;

interface CompanionHitomiService {
  searchGalleries(
    params: SearchGalleriesParams,
  ): Promise<SearchGalleriesResult>;
  getGalleryDetails(galleryId: number): Promise<unknown>;
  getGalleryImageUrls(galleryId: number): Promise<string[]>;
}

export interface CompanionOperationResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CompanionDownloadService {
  getPath(): Promise<
    CompanionOperationResult<{ configured: boolean; path: string | null }>
  >;
  getQueue(): Promise<CompanionOperationResult<DownloadQueueItem[]>>;
  add(galleryId: number): Promise<CompanionOperationResult<DownloadQueueItem>>;
  remove(queueId: number): Promise<CompanionOperationResult>;
  pause(queueId: number): Promise<CompanionOperationResult>;
  resume(queueId: number): Promise<CompanionOperationResult>;
  retry(queueId: number): Promise<CompanionOperationResult>;
  clearCompleted(): Promise<CompanionOperationResult>;
}

export interface CompanionLibraryBook {
  id: number;
  syncId: string;
  title: string;
  pageCount: number;
  modifiedAt: number;
  currentPage: number;
  isFavorite: boolean;
  isRead?: boolean;
  isHidden?: boolean;
  customTitle?: string | null;
  seriesFavorite?: boolean;
  lastReadAt: string | null;
  stateVersion: number;
  stateUpdatedAt: string | null;
  hitomiId?: string | null;
  type?: string | null;
  language?: string | null;
  artists: { name: string }[];
  groups: { name: string }[];
  series: { name: string }[];
  characters: { name: string }[];
  tags: { name: string }[];
  seriesCollection: {
    name: string | null;
    order: number;
    modifiedAt: number;
  };
  coverUrl: string;
}

export interface CompanionLibraryPage {
  books: CompanionLibraryBook[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface CompanionSeriesAssignment {
  mutationId?: string;
  bookSyncId: string;
  name: string | null;
  order: number;
  modifiedAt?: number;
  baseVersion?: number;
}

export interface CompanionSeriesAssignmentResult {
  mutationId: string | null;
  bookSyncId: string;
  status: "applied" | "already_applied" | "conflict" | "not_found";
  version?: number;
  modifiedAt?: number;
  name?: string | null;
  order?: number;
}

export interface CompanionLibraryImage {
  stream: Readable;
  contentType: string;
  contentLength?: number;
}

export interface CompanionLibraryService {
  listBooks(
    cursor?: number,
    limit?: number,
  ): Promise<CompanionLibraryBook[] | CompanionLibraryPage>;
  saveSeriesAssignments(assignments: CompanionSeriesAssignment[]): Promise<
    CompanionOperationResult<{
      updated: number;
      results: CompanionSeriesAssignmentResult[];
    }>
  >;
  importBook?(input: {
    stream: Readable;
    fileName: string;
    syncId: string;
    contentLength?: number;
  }): Promise<
    CompanionOperationResult<{
      status: "imported" | "already_exists";
      id: number;
      syncId: string;
      path: string;
    }>
  >;
  deleteBook(bookId: number): Promise<CompanionOperationResult>;
  getPageCount(bookId: number): Promise<number | null>;
  getCover(bookId: number): Promise<CompanionLibraryImage | null>;
  getPage(
    bookId: number,
    pageIndex: number,
  ): Promise<CompanionLibraryImage | null>;
}

export interface CompanionDeviceStore {
  getDevices(): CompanionDevice[];
  setDevices(devices: CompanionDevice[]): void;
}

export interface CompanionSyncService {
  bootstrap(): Promise<unknown>;
  getChanges(afterCursor: number, limit?: number): Promise<unknown>;
  applyMutations(
    deviceId: string,
    mutations: CompanionSyncMutation[],
  ): Promise<{
    cursor: number;
    serverTime: string;
    results: CompanionSyncMutationResult[];
  }>;
}

interface PairingState {
  code: string;
  expiresAt: number;
}

interface PairingAttemptState {
  attempts: number;
  windowStartedAt: number;
}

export class CompanionServer {
  private server: ReturnType<typeof createServer> | null = null;
  private port = DEFAULT_PORT;
  private pairingState: PairingState | null = null;
  private readonly pairingAttempts = new Map<string, PairingAttemptState>();
  private readonly deviceActivity = new Map<string, number>();
  private readonly deviceConnectionStates = new Map<
    string,
    CompanionDeviceInfo["connectionState"]
  >();
  private readonly connectionTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private syncGeneration = 0;

  constructor(
    private readonly hitomiService: CompanionHitomiService,
    private readonly deviceStore: CompanionDeviceStore,
    private readonly downloadService?: CompanionDownloadService,
    private readonly libraryService?: CompanionLibraryService,
    private readonly syncService?: CompanionSyncService,
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
    this.clearConnectionStates();
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
    return this.deviceStore
      .getDevices()
      .map((device) =>
        toDeviceInfo(device, this.getDeviceConnectionState(device.id)),
      );
  }

  revokeDevice(deviceId: string): boolean {
    const devices = this.deviceStore.getDevices();
    const remaining = devices.filter((device) => device.id !== deviceId);
    if (remaining.length === devices.length) return false;
    this.deviceStore.setDevices(remaining);
    this.clearDeviceConnectionState(deviceId);
    return true;
  }

  requestSync(): number {
    this.syncGeneration += 1;
    return this.syncGeneration;
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
          syncGeneration: this.syncGeneration,
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

    if (request.method === "GET" && pathname === "/v1/connection") {
      this.sendJson(response, 200, {
        success: true,
        data: { connected: true, serverTime: new Date().toISOString() },
      });
      return;
    }

    if (
      this.syncService &&
      (await this.handleSyncRequest(request, response, pathname, device))
    ) {
      return;
    }

    if (
      this.downloadService &&
      (await this.handleDownloadRequest(request, response, pathname))
    ) {
      return;
    }

    if (
      this.libraryService &&
      (await this.handleLibraryRequest(request, response, pathname))
    ) {
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

  private async handleSyncRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    device: CompanionDevice,
  ): Promise<boolean> {
    const service = this.syncService;
    if (!service) return false;

    if (request.method === "GET" && pathname === "/v1/sync/bootstrap") {
      this.sendJson(response, 200, {
        success: true,
        data: await service.bootstrap(),
      });
      return true;
    }

    if (request.method === "GET" && pathname === "/v1/sync/changes") {
      const requestUrl = new URL(request.url || "/", "http://companion.local");
      const cursor = parseNonNegativeInteger(
        requestUrl.searchParams.get("cursor") ?? "0",
      );
      const limitText = requestUrl.searchParams.get("limit");
      const limit =
        limitText === null ? undefined : parsePositiveInteger(limitText);
      if (cursor === null || (limitText !== null && limit === null)) {
        this.sendJson(response, 400, {
          success: false,
          error: "cursor and limit must be valid integers",
        });
        return true;
      }
      this.sendJson(response, 200, {
        success: true,
        data: await service.getChanges(cursor, limit ?? undefined),
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/v1/sync/changes") {
      const body = await this.readJsonBody(request);
      if (!Array.isArray(body.mutations)) {
        this.sendJson(response, 400, {
          success: false,
          error: "mutations must be an array",
        });
        return true;
      }
      if (body.mutations.length > MAX_SYNC_MUTATIONS_PER_REQUEST) {
        this.sendJson(response, 400, {
          success: false,
          error: `A maximum of ${MAX_SYNC_MUTATIONS_PER_REQUEST} mutations is allowed`,
        });
        return true;
      }
      const mutations = body.mutations.filter(isSyncMutation);
      if (mutations.length !== body.mutations.length) {
        this.sendJson(response, 400, {
          success: false,
          error: "Invalid sync mutation",
        });
        return true;
      }
      const data = await service.applyMutations(device.id, mutations);
      if (data.results.some((item) => item.status === "applied")) {
        // Book-state changes are consumed through the durable cursor feed. Refresh
        // desktop renderers without also invalidating every mobile library snapshot.
        notifyCompanionLibraryChanged(false);
      }
      this.sendJson(response, 200, {
        success: true,
        data,
      });
      return true;
    }

    return false;
  }

  private async handleLibraryRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const service = this.libraryService;
    if (!service) return false;

    if (request.method === "POST" && pathname === "/v1/library/series") {
      const body = await this.readJsonBody(request);
      if (!Array.isArray(body.assignments)) {
        this.sendJson(response, 400, {
          success: false,
          error: "assignments must be an array",
        });
        return true;
      }
      if (body.assignments.length > MAX_SYNC_MUTATIONS_PER_REQUEST) {
        this.sendJson(response, 400, {
          success: false,
          error: `A maximum of ${MAX_SYNC_MUTATIONS_PER_REQUEST} assignments is allowed`,
        });
        return true;
      }
      const assignments = body.assignments.filter(isSeriesAssignment);
      if (assignments.length !== body.assignments.length) {
        this.sendJson(response, 400, {
          success: false,
          error: "Invalid series assignment",
        });
        return true;
      }
      const result = await service.saveSeriesAssignments(assignments);
      if (result.success && result.data && result.data.updated > 0) {
        notifyCompanionLibraryChanged();
      }
      this.sendOperationResult(response, result);
      return true;
    }

    if (request.method === "POST" && pathname === "/v1/library/import") {
      if (!service.importBook) {
        this.sendJson(response, 501, {
          success: false,
          error: "Library import is unavailable",
        });
        return true;
      }
      const fileName = decodeHeaderValue(request.headers["x-file-name"]);
      const syncId = headerValue(request.headers["x-sync-id"])
        ?.trim()
        .toLowerCase();
      const contentLengthText = request.headers["content-length"];
      const contentLength = contentLengthText
        ? Number.parseInt(headerValue(contentLengthText) || "", 10)
        : undefined;
      if (
        !fileName ||
        !syncId ||
        !isUuid(syncId) ||
        !/\.(cbz|zip)$/i.test(fileName) ||
        (contentLength !== undefined &&
          (!Number.isSafeInteger(contentLength) || contentLength <= 0))
      ) {
        this.sendJson(response, 400, {
          success: false,
          error:
            "A valid CBZ/ZIP file name, UUID, and content length are required",
        });
        return true;
      }
      const result = await service.importBook({
        stream: request,
        fileName,
        syncId,
        contentLength,
      });
      if (result.success) notifyCompanionLibraryChanged();
      this.sendOperationResult(response, result);
      return true;
    }

    const deleteMatch = pathname.match(/^\/v1\/library\/books\/(\d+)$/);
    if (request.method === "DELETE" && deleteMatch) {
      const bookId = Number.parseInt(deleteMatch[1], 10);
      const result = await service.deleteBook(bookId);
      if (result.success) notifyCompanionLibraryChanged();
      this.sendOperationResult(response, result);
      return true;
    }

    if (request.method !== "GET") return false;

    if (pathname === "/v1/library/books") {
      const requestUrl = new URL(request.url || "/", "http://companion.local");
      const cursorText = requestUrl.searchParams.get("cursor");
      const limitText = requestUrl.searchParams.get("limit");
      const cursor =
        cursorText === null ? undefined : parsePositiveInteger(cursorText);
      const limit =
        limitText === null ? undefined : parsePositiveInteger(limitText);
      if (
        (cursorText !== null && cursor === null) ||
        (limitText !== null && limit === null)
      ) {
        this.sendJson(response, 400, {
          success: false,
          error: "cursor and limit must be valid positive integers",
        });
        return true;
      }
      if (cursorText === null && limitText === null) {
        this.sendJson(response, 200, {
          success: true,
          data: await service.listBooks(),
        });
        return true;
      }
      const page = await service.listBooks(
        cursor ?? undefined,
        limit ?? undefined,
      );
      this.sendJson(response, 200, {
        success: true,
        data: page,
      });
      return true;
    }

    const bookMatch = pathname.match(
      /^\/v1\/library\/books\/(\d+)\/(cover|pages)(?:\/(\d+))?$/,
    );
    if (!bookMatch) return false;

    const bookId = Number.parseInt(bookMatch[1], 10);
    const resource = bookMatch[2];
    const pageIndexText = bookMatch[3];

    if (resource === "pages" && pageIndexText === undefined) {
      const pageCount = await service.getPageCount(bookId);
      if (pageCount === null) {
        this.sendJson(response, 404, {
          success: false,
          error: "Book not found",
        });
        return true;
      }
      this.sendJson(response, 200, {
        success: true,
        data: Array.from(
          { length: pageCount },
          (_, index) => `/v1/library/books/${bookId}/pages/${index}`,
        ),
      });
      return true;
    }

    const image =
      resource === "cover"
        ? await service.getCover(bookId)
        : await service.getPage(
            bookId,
            Number.parseInt(pageIndexText as string, 10),
          );
    if (!image) {
      this.sendJson(response, 404, {
        success: false,
        error: resource === "cover" ? "Cover not found" : "Page not found",
      });
      return true;
    }

    this.sendImage(response, image);
    return true;
  }

  private async handleDownloadRequest(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    const service = this.downloadService;
    if (!service) return false;

    if (request.method === "GET" && pathname === "/v1/downloads/path") {
      this.sendOperationResult(response, await service.getPath());
      return true;
    }

    if (request.method === "GET" && pathname === "/v1/downloads") {
      const result = await service.getQueue();
      this.sendOperationResult(
        response,
        result.success
          ? { ...result, data: result.data?.map(withoutDownloadPath) ?? [] }
          : result,
      );
      return true;
    }

    if (request.method === "POST" && pathname === "/v1/downloads") {
      const body = await this.readJsonBody(request);
      const galleryId = body.galleryId;
      if (!isPositiveInteger(galleryId)) {
        this.sendJson(response, 400, {
          success: false,
          error: "galleryId must be a positive integer",
        });
        return true;
      }
      const result = await service.add(galleryId);
      this.sendOperationResult(
        response,
        result.success && result.data
          ? { ...result, data: withoutDownloadPath(result.data) }
          : result,
        201,
      );
      return true;
    }

    if (request.method === "DELETE" && pathname === "/v1/downloads/completed") {
      this.sendOperationResult(response, await service.clearCompleted());
      return true;
    }

    const itemMatch = pathname.match(
      /^\/v1\/downloads\/(\d+)(?:\/(pause|resume|retry))?$/,
    );
    if (!itemMatch) return false;

    const queueId = Number.parseInt(itemMatch[1], 10);
    const action = itemMatch[2];
    if (request.method === "DELETE" && !action) {
      this.sendOperationResult(response, await service.remove(queueId));
      return true;
    }
    if (request.method !== "POST" || !action) return false;

    const result =
      action === "pause"
        ? await service.pause(queueId)
        : action === "resume"
          ? await service.resume(queueId)
          : await service.retry(queueId);
    this.sendOperationResult(response, result);
    return true;
  }

  private async handlePair(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    this.clearExpiredPairingCode();
    const remoteAddress = request.socket.remoteAddress || "unknown";
    if (!this.canAttemptPairing(remoteAddress)) {
      this.sendJson(response, 429, {
        success: false,
        error: "Too many pairing attempts. Try again shortly.",
      });
      return;
    }
    const body = await this.readJsonBody(request);
    if (
      !this.pairingState ||
      typeof body.code !== "string" ||
      body.code !== this.pairingState.code ||
      typeof body.deviceName !== "string" ||
      body.deviceName.trim().length === 0 ||
      body.deviceName.length > 100
    ) {
      this.recordFailedPairingAttempt(remoteAddress);
      this.sendJson(response, 401, {
        success: false,
        error: "Invalid or expired pairing code",
      });
      return;
    }

    this.pairingState = null;
    this.pairingAttempts.delete(remoteAddress);
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
    this.markDeviceActivity(device.id);

    this.sendJson(response, 201, {
      success: true,
      data: {
        device: toDeviceInfo(device, this.getDeviceConnectionState(device.id)),
        token,
      },
    });
  }

  private canAttemptPairing(remoteAddress: string): boolean {
    const attempt = this.pairingAttempts.get(remoteAddress);
    if (!attempt) return true;
    if (Date.now() - attempt.windowStartedAt >= PAIRING_ATTEMPT_WINDOW_MS) {
      this.pairingAttempts.delete(remoteAddress);
      return true;
    }
    return attempt.attempts < MAX_PAIRING_ATTEMPTS_PER_WINDOW;
  }

  private recordFailedPairingAttempt(remoteAddress: string): void {
    const existing = this.pairingAttempts.get(remoteAddress);
    if (
      !existing ||
      Date.now() - existing.windowStartedAt >= PAIRING_ATTEMPT_WINDOW_MS
    ) {
      this.pairingAttempts.set(remoteAddress, {
        attempts: 1,
        windowStartedAt: Date.now(),
      });
      return;
    }
    existing.attempts += 1;
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
    this.markDeviceActivity(device.id);
    return device;
  }

  private markDeviceActivity(deviceId: string): void {
    const now = Date.now();
    const previousActivity = this.deviceActivity.get(deviceId) ?? 0;
    const previousState = this.deviceConnectionStates.get(deviceId);
    this.deviceActivity.set(deviceId, now);

    if (
      previousState === "connected" &&
      now - previousActivity < DEVICE_CONNECTION_TIMEOUT_MS
    ) {
      return;
    }
    if (previousState === "connecting") return;

    this.deviceConnectionStates.set(deviceId, "connecting");
    const existingTimer = this.connectionTimers.get(deviceId);
    if (existingTimer) clearTimeout(existingTimer);
    this.connectionTimers.set(
      deviceId,
      setTimeout(() => {
        this.connectionTimers.delete(deviceId);
        if (
          Date.now() - (this.deviceActivity.get(deviceId) ?? 0) <
          DEVICE_CONNECTION_TIMEOUT_MS
        ) {
          this.deviceConnectionStates.set(deviceId, "connected");
        }
      }, DEVICE_CONNECTING_VISIBLE_MS),
    );
  }

  private getDeviceConnectionState(
    deviceId: string,
  ): CompanionDeviceInfo["connectionState"] {
    const lastActivity = this.deviceActivity.get(deviceId);
    if (
      !this.server ||
      !lastActivity ||
      Date.now() - lastActivity >= DEVICE_CONNECTION_TIMEOUT_MS
    ) {
      this.deviceConnectionStates.set(deviceId, "disconnected");
      return "disconnected";
    }
    return this.deviceConnectionStates.get(deviceId) ?? "connecting";
  }

  private clearDeviceConnectionState(deviceId: string): void {
    const timer = this.connectionTimers.get(deviceId);
    if (timer) clearTimeout(timer);
    this.connectionTimers.delete(deviceId);
    this.deviceActivity.delete(deviceId);
    this.deviceConnectionStates.delete(deviceId);
  }

  private clearConnectionStates(): void {
    for (const timer of this.connectionTimers.values()) clearTimeout(timer);
    this.connectionTimers.clear();
    this.deviceActivity.clear();
    this.deviceConnectionStates.clear();
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

  private sendOperationResult<T>(
    response: ServerResponse,
    result: CompanionOperationResult<T>,
    successStatus = 200,
  ): void {
    if (!result.success) {
      this.sendJson(response, 409, {
        success: false,
        error: result.error || "Download operation failed",
      });
      return;
    }
    this.sendJson(response, successStatus, {
      success: true,
      data: result.data ?? {},
    });
  }

  private sendImage(
    response: ServerResponse,
    image: CompanionLibraryImage,
  ): void {
    response.writeHead(200, {
      "Content-Type": image.contentType,
      ...(image.contentLength === undefined
        ? {}
        : { "Content-Length": image.contentLength }),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    image.stream.on("error", (error) => {
      console.error("[Companion] Image stream failed:", error);
      response.destroy(error);
    });
    image.stream.pipe(response);
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function withoutDownloadPath(item: DownloadQueueItem) {
  const { download_path: _downloadPath, ...safeItem } = item;
  void _downloadPath;
  return safeItem;
}

function parseNonNegativeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInteger(value: string): number | null {
  const parsed = parseNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function isSeriesAssignment(
  value: unknown,
): value is CompanionSeriesAssignment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const assignment = value as Record<string, unknown>;
  if (!isBoundedString(assignment.bookSyncId, 128)) return false;
  if (
    assignment.name !== null &&
    (!isBoundedString(assignment.name, 500) ||
      assignment.name.trim().length === 0)
  ) {
    return false;
  }
  return (
    isNonNegativeInteger(assignment.order) &&
    (assignment.modifiedAt === undefined ||
      isNonNegativeInteger(assignment.modifiedAt)) &&
    (assignment.baseVersion === undefined ||
      isNonNegativeInteger(assignment.baseVersion)) &&
    (assignment.mutationId === undefined ||
      isBoundedString(assignment.mutationId, 128))
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function decodeHeaderValue(
  value: string | string[] | undefined,
): string | null {
  const raw = headerValue(value);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.replace(/\+/g, "%20"));
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isSyncMutation(value: unknown): value is CompanionSyncMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const mutation = value as Record<string, unknown>;
  if (!isBoundedString(mutation.mutationId, 128)) return false;
  if (!isBoundedString(mutation.bookSyncId, 128)) return false;
  if (
    mutation.baseVersion !== undefined &&
    !isNonNegativeInteger(mutation.baseVersion)
  ) {
    return false;
  }
  if (
    mutation.modifiedAt !== undefined &&
    !isNonNegativeInteger(mutation.modifiedAt)
  ) {
    return false;
  }
  if (
    mutation.currentPage !== undefined &&
    !isNonNegativeInteger(mutation.currentPage)
  ) {
    return false;
  }
  if (
    mutation.isFavorite !== undefined &&
    typeof mutation.isFavorite !== "boolean"
  ) {
    return false;
  }

  for (const field of ["isRead", "isHidden", "seriesFavorite"] as const) {
    if (mutation[field] !== undefined && typeof mutation[field] !== "boolean") {
      return false;
    }
  }
  if (
    mutation.customTitle !== undefined &&
    mutation.customTitle !== null &&
    !isBoundedString(mutation.customTitle, 500)
  ) {
    return false;
  }

  let hasChange =
    mutation.currentPage !== undefined ||
    mutation.isFavorite !== undefined ||
    mutation.isRead !== undefined ||
    mutation.isHidden !== undefined ||
    mutation.customTitle !== undefined ||
    mutation.seriesFavorite !== undefined;
  if (mutation.historyEvent !== undefined) {
    if (
      !mutation.historyEvent ||
      typeof mutation.historyEvent !== "object" ||
      Array.isArray(mutation.historyEvent)
    ) {
      return false;
    }
    const history = mutation.historyEvent as Record<string, unknown>;
    if (!isBoundedString(history.eventId, 128)) return false;
    if (
      typeof history.viewedAt !== "string" ||
      !Number.isFinite(Date.parse(history.viewedAt))
    ) {
      return false;
    }
    if (
      history.currentPage !== undefined &&
      !isNonNegativeInteger(history.currentPage)
    ) {
      return false;
    }
    hasChange = true;
  }
  return hasChange;
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function toDeviceInfo(
  device: CompanionDevice,
  connectionState: CompanionDeviceInfo["connectionState"],
): CompanionDeviceInfo {
  return {
    id: device.id,
    name: device.name,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
    connectionState,
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
