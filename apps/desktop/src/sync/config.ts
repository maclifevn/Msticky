/** Per-machine sync settings, persisted in localStorage (shared across windows). */

const KEYS = {
  server: "msticky.serverUrl",
  token: "msticky.token",
  userId: "msticky.userId",
  email: "msticky.email",
  device: "msticky.deviceId",
  lastSync: "msticky.lastSyncAt",
};

/** Default points at the deployed worker; override per-machine in the panel. */
const DEFAULT_SERVER_URL = "https://msticky-sync.mac-dda.workers.dev";

/**
 * Public Google OAuth client id (Desktop type). Not a secret — the client
 * secret lives only in the worker. Replace after creating the OAuth client.
 */
export const GOOGLE_CLIENT_ID =
  "902036415026-qki2nu6jlcm8c4rrrfhhb4lrbtup3vja.apps.googleusercontent.com";

export function getServerUrl(): string {
  return localStorage.getItem(KEYS.server) || DEFAULT_SERVER_URL;
}
export function setServerUrl(url: string): void {
  localStorage.setItem(KEYS.server, url.replace(/\/$/, ""));
}

export function getToken(): string | null {
  return localStorage.getItem(KEYS.token);
}
export function getUserId(): string | null {
  return localStorage.getItem(KEYS.userId);
}
export function getEmail(): string | null {
  return localStorage.getItem(KEYS.email);
}
export function setSession(token: string, userId: string, email: string): void {
  localStorage.setItem(KEYS.token, token);
  localStorage.setItem(KEYS.userId, userId);
  localStorage.setItem(KEYS.email, email);
}
export function clearSession(): void {
  localStorage.removeItem(KEYS.token);
  localStorage.removeItem(KEYS.userId);
  localStorage.removeItem(KEYS.email);
  localStorage.removeItem(KEYS.lastSync);
}

/** Stable id for this installation, used so the hub never echoes our own ops. */
export function getDeviceId(): string {
  let id = localStorage.getItem(KEYS.device);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEYS.device, id);
  }
  return id;
}

export function getLastSyncAt(): number {
  return Number(localStorage.getItem(KEYS.lastSync) || "0");
}
export function setLastSyncAt(ts: number): void {
  localStorage.setItem(KEYS.lastSync, String(ts));
}

/** http(s)://host → ws(s)://host for the WebSocket endpoint. */
export function wsUrl(token: string, device: string): string {
  const base = getServerUrl().replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}&device=${encodeURIComponent(device)}`;
}
