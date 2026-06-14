import {
  type Op,
  type ServerMessage,
  serverMessageSchema,
} from "@msticky/shared";
import { getNote, getAllNotes } from "../store/repo";
import { applyRemoteNote } from "../store/actions";
import { onNoteChanged, announceBulkChanged } from "../lib/native";
import { encryptContent, decryptContent, isUnlocked } from "./e2e";
import {
  getDeviceId,
  getLastSyncAt,
  getToken,
  setLastSyncAt,
  wsUrl,
} from "./config";

export type SyncStatus = "signed-out" | "connecting" | "online" | "offline";

const QUEUE_KEY = "msticky.opQueue";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * Lives in the board window. Bridges local note mutations (heard via the
 * cross-window NOTE_CHANGED event) to the sync hub and applies remote changes
 * back into the local SQLite cache. Offline-first: unsent ops are queued in
 * localStorage and replayed on reconnect; the server's LWW makes re-sends safe.
 */
export class SyncEngine {
  private ws: WebSocket | null = null;
  private status: SyncStatus = "signed-out";
  private listeners = new Set<(s: SyncStatus) => void>();
  private unlistenNote: (() => void) | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | undefined;
  private stopped = false;
  /** notes we just applied from the network, so we don't echo them back */
  private remoteApplied = new Map<string, number>();

  onStatus(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => this.listeners.delete(cb);
  }

  private setStatus(s: SyncStatus) {
    this.status = s;
    for (const cb of this.listeners) cb(s);
  }

  async start(): Promise<void> {
    this.stopped = false;
    // Push local edits from any window to the hub. Idempotent: attach once.
    if (!this.unlistenNote) {
      this.unlistenNote = await onNoteChanged(async ({ id }) => {
        const note = await getNote(id);
        if (!note) return;
        // Skip if this change is just us re-applying a note from the network.
        if (this.remoteApplied.get(id) === note.updatedAt) {
          this.remoteApplied.delete(id);
          return;
        }
        this.enqueue({ opId: crypto.randomUUID(), deviceId: getDeviceId(), note });
        void this.flush();
      });
    }
    this.reconnectNow();
  }

  stop(): void {
    this.stopped = true;
    this.unlistenNote?.();
    this.unlistenNote = null;
    window.clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  // ── Connection lifecycle ───────────────────────────────────────────────

  private connect(): void {
    const token = getToken();
    if (!token) {
      this.setStatus("signed-out");
      return;
    }
    this.setStatus("connecting");
    const ws = new WebSocket(wsUrl(token, getDeviceId()));
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("online");
      // Pull anything we missed, then replay queued local ops.
      ws.send(JSON.stringify({ type: "pull", since: getLastSyncAt() }));
      void this.flush();
    };
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onclose = () => {
      this.ws = null;
      if (!this.stopped) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    this.setStatus("offline");
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts += 1;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  /** Call after sign-in (or server URL change) to (re)establish the socket. */
  reconnectNow(): void {
    window.clearTimeout(this.reconnectTimer);
    this.reconnectAttempts = 0;
    this.ws?.close();
    this.ws = null;
    this.connect();
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: ServerMessage;
    try {
      msg = serverMessageSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }
    if (msg.type === "sync") {
      let maxTs = getLastSyncAt();
      let skippedLocked = false;
      for (const note of msg.notes) {
        // If a note is encrypted but this device is locked, skip it — applying
        // a placeholder would clobber any local plaintext. Hold the watermark so
        // it re-syncs once unlocked.
        if (note.content.startsWith("enc:v1:") && !isUnlocked()) {
          skippedLocked = true;
          continue;
        }
        const decoded = { ...note, content: await decryptContent(note.content) };
        this.remoteApplied.set(note.id, note.updatedAt);
        await applyRemoteNote(decoded);
        if (note.updatedAt > maxTs) maxTs = note.updatedAt;
      }
      if (!skippedLocked) setLastSyncAt(maxTs);
      if (msg.notes.length) void announceBulkChanged();
    } else if (msg.type === "ack") {
      this.removeFromQueue(msg.opIds);
    }
  }

  // ── Offline op queue (persisted) ────────────────────────────────────────

  private readQueue(): Op[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") as Op[];
    } catch {
      return [];
    }
  }
  private writeQueue(ops: Op[]): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
  }
  private enqueue(op: Op): void {
    const q = this.readQueue();
    // collapse to the latest op per note id to avoid unbounded growth
    const filtered = q.filter((o) => o.note.id !== op.note.id);
    filtered.push(op);
    this.writeQueue(filtered);
  }
  private removeFromQueue(opIds: string[]): void {
    const set = new Set(opIds);
    this.writeQueue(this.readQueue().filter((o) => !set.has(o.opId)));
  }

  private async flush(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const q = this.readQueue();
    if (!q.length) return;
    // Encrypt content just before it leaves the device (passthrough when off).
    const ops = await Promise.all(
      q.map(async (o) => ({
        ...o,
        note: { ...o.note, content: await encryptContent(o.note.content) },
      })),
    );
    this.ws.send(JSON.stringify({ type: "push", ops }));
  }

  /** Re-push every local note (used right after enabling encryption so existing
   *  notes get re-stored as ciphertext on the server). */
  async repushAll(): Promise<void> {
    for (const note of await getAllNotes()) {
      // Never re-encrypt a locked placeholder — that would overwrite the real
      // ciphertext on the server with garbage.
      if (note.content.startsWith("🔒")) continue;
      this.enqueue({ opId: crypto.randomUUID(), deviceId: getDeviceId(), note });
    }
    void this.flush();
  }
}

/** Singleton for the board window. */
let engine: SyncEngine | null = null;
export function getSyncEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine();
  return engine;
}
