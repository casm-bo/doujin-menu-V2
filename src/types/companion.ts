export interface CompanionDevice {
  id: string;
  name: string;
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

export interface CompanionDeviceInfo {
  id: string;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

export interface CompanionServerStatus {
  running: boolean;
  enabled: boolean;
  port: number;
  addresses: string[];
  pairedDeviceCount: number;
  pairingAvailable: boolean;
}

export interface CompanionPairingCode {
  code: string;
  expiresAt: string;
  port: number;
  addresses: string[];
}

export interface CompanionSyncBookState {
  syncId: string;
  currentPage: number;
  isFavorite: boolean;
  lastReadAt: string | null;
  version: number;
  updatedAt: string | null;
}

export interface CompanionSyncHistoryEvent {
  eventId: string;
  bookSyncId: string;
  viewedAt: string;
  currentPage: number | null;
  deviceId: string;
}

export interface CompanionSyncChange {
  cursor: number;
  state: CompanionSyncBookState;
  changedFields: ("currentPage" | "isFavorite" | "history")[];
  historyEvent?: CompanionSyncHistoryEvent;
}

export interface CompanionSyncMutation {
  mutationId: string;
  bookSyncId: string;
  baseVersion?: number;
  currentPage?: number;
  isFavorite?: boolean;
  historyEvent?: {
    eventId: string;
    viewedAt: string;
    currentPage?: number;
  };
}

export interface CompanionSyncMutationResult {
  mutationId: string;
  status: "applied" | "duplicate" | "not_found";
  conflict: boolean;
  state?: CompanionSyncBookState;
}
