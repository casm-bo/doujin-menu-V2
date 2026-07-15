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
