import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getServerUrl, getToken, getUserId } from "./config";

/**
 * Optional end-to-end encryption for note content.
 *
 * Off by default. When the user enables it, a passphrase derives an AES-256-GCM
 * key (PBKDF2); note `content` is encrypted on-device before sync so the server
 * (D1) only ever stores ciphertext. The server keeps a random `salt` and a
 * `verifier` (a known value encrypted with the key) — neither reveals the
 * passphrase/key. The derived key is cached in the OS keychain so each device
 * unlocks once. Metadata (color, position, timestamps) stays plaintext so the
 * sync/LWW logic is unaffected.
 */

const ENC_PREFIX = "enc:v1:";
const PBKDF2_ITERATIONS = 210_000;
const VERIFIER_PLAINTEXT = "msticky-e2e-verifier-v1";

export type E2eMode = "off" | "locked" | "unlocked";

/** In-memory key for this session. Never written to disk except the keychain. */
let activeKey: CryptoKey | null = null;

// ── base64 helpers ───────────────────────────────────────────────────────────

function b64encode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(str: string): Uint8Array<ArrayBuffer> {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** Copy bytes into a guaranteed ArrayBuffer-backed view (satisfies BufferSource). */
function utf8(s: string): Uint8Array<ArrayBuffer> {
  const e = new TextEncoder().encode(s);
  return new Uint8Array(e);
}

// ── crypto primitives ────────────────────────────────────────────────────────

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    true, // extractable, so we can cache the raw key in the keychain
    ["encrypt", "decrypt"],
  );
}

async function aesEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8(plaintext));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return ENC_PREFIX + b64encode(combined);
}

async function aesDecrypt(key: CryptoKey, stored: string): Promise<string> {
  const data = b64decode(stored.slice(ENC_PREFIX.length));
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

async function exportRaw(key: CryptoKey): Promise<string> {
  return b64encode(await crypto.subtle.exportKey("raw", key));
}
async function importRaw(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", b64decode(b64), { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

// ── OS keychain (per-account key cache) ──────────────────────────────────────

function keychainAccount(): string {
  return `e2e:${getUserId() ?? "unknown"}`;
}
async function cacheKey(key: CryptoKey): Promise<void> {
  await invoke("keychain_set", { account: keychainAccount(), value: await exportRaw(key) });
}
async function loadCachedKey(): Promise<CryptoKey | null> {
  const raw = await invoke<string | null>("keychain_get", { account: keychainAccount() });
  return raw ? importRaw(raw) : null;
}
async function clearCachedKey(): Promise<void> {
  await invoke("keychain_delete", { account: keychainAccount() });
}

// ── server config (salt + verifier) ──────────────────────────────────────────

interface ServerConfig {
  salt: string | null;
  verifier?: string;
}
async function getServerConfig(): Promise<ServerConfig> {
  const res = await tauriFetch(`${getServerUrl()}/e2e`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`e2e config fetch failed (${res.status})`);
  return (await res.json()) as ServerConfig;
}
async function putServerConfig(salt: string, verifier: string): Promise<void> {
  const res = await tauriFetch(`${getServerUrl()}/e2e`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify({ salt, verifier }),
  });
  if (!res.ok) throw new Error(`enabling encryption failed (${res.status})`);
}

// ── public API ───────────────────────────────────────────────────────────────

export function isUnlocked(): boolean {
  return activeKey !== null;
}

/** Whether encryption is enabled for this account, and if it's unlocked here. */
export async function currentMode(): Promise<E2eMode> {
  const cfg = await getServerConfig();
  if (!cfg.salt) return "off";
  if (activeKey) return "unlocked";
  return "locked";
}

/** On startup: if E2E is on and the key is cached on this device, unlock silently. */
export async function tryUnlockFromKeychain(): Promise<boolean> {
  const cached = await loadCachedKey();
  if (cached) {
    activeKey = cached;
    return true;
  }
  return false;
}

/** Turn on encryption for this account (first device). */
export async function enableEncryption(passphrase: string): Promise<void> {
  const cfg = await getServerConfig();
  if (cfg.salt) {
    // Already enabled elsewhere — unlock instead of re-enabling.
    await unlock(passphrase);
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  const verifier = await aesEncrypt(key, VERIFIER_PLAINTEXT);
  await putServerConfig(b64encode(salt), verifier);
  activeKey = key;
  await cacheKey(key);
}

/** Unlock encryption on this device with the passphrase. */
export async function unlock(passphrase: string): Promise<void> {
  const cfg = await getServerConfig();
  if (!cfg.salt || !cfg.verifier) throw new Error("Encryption is not enabled");
  const key = await deriveKey(passphrase, b64decode(cfg.salt));
  // Verify by decrypting the known verifier value.
  try {
    const check = await aesDecrypt(key, cfg.verifier);
    if (check !== VERIFIER_PLAINTEXT) throw new Error("bad");
  } catch {
    throw new Error("Wrong passphrase");
  }
  activeKey = key;
  await cacheKey(key);
}

/** Forget the key on this device (does not disable encryption for the account). */
export async function lockThisDevice(): Promise<void> {
  activeKey = null;
  await clearCachedKey();
}

/** Encrypt content for sync. Passthrough when encryption is off/locked. */
export async function encryptContent(content: string): Promise<string> {
  if (!activeKey) return content;
  return aesEncrypt(activeKey, content);
}

/** Decrypt content from sync. Legacy/plaintext values pass through unchanged. */
export async function decryptContent(content: string): Promise<string> {
  if (!content.startsWith(ENC_PREFIX)) return content;
  if (!activeKey) return "🔒 Locked — unlock to view";
  try {
    return await aesDecrypt(activeKey, content);
  } catch {
    return "🔒 Unable to decrypt";
  }
}
