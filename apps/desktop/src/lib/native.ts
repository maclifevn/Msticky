import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Cross-window event fired whenever any note is created/updated/deleted. */
export const NOTE_CHANGED = "msticky://note-changed";
/** Fired when a batch of notes changed (e.g. after a sync pull). */
export const NOTES_BULK_CHANGED = "msticky://notes-bulk-changed";

export interface NoteChangedPayload {
  id: string;
  /** label of the window that made the change, so it can ignore its own echo */
  origin: string;
}

export function thisWindowLabel(): string {
  return getCurrentWindow().label;
}

/** `note:<id>` → id, else null. */
export function noteIdFromLabel(label: string): string | null {
  return label.startsWith("note:") ? label.slice("note:".length) : null;
}

export async function announceNoteChanged(id: string): Promise<void> {
  const payload: NoteChangedPayload = { id, origin: thisWindowLabel() };
  await emit(NOTE_CHANGED, payload);
}

export async function announceBulkChanged(): Promise<void> {
  await emit(NOTES_BULK_CHANGED, { origin: thisWindowLabel() });
}

export function onNoteChanged(
  cb: (p: NoteChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<NoteChangedPayload>(NOTE_CHANGED, (e) => cb(e.payload));
}

export function onBulkChanged(cb: () => void): Promise<UnlistenFn> {
  return listen(NOTES_BULK_CHANGED, () => cb());
}

// ── Native window commands (implemented in Rust) ──────────────────────────

/** Open (or focus) the floating window for a note. */
export function openNoteWindow(id: string): Promise<void> {
  return invoke("open_note_window", { id });
}

/** Open (or focus) the board / manager window. */
export function openBoard(): Promise<void> {
  return invoke("open_board");
}

/**
 * Pin a note to the desktop: keep it visible across workspaces and below normal
 * windows but above the desktop, and hide it from the taskbar/dock switcher.
 */
export function setPinned(pinned: boolean): Promise<void> {
  return invoke("set_pinned", { label: thisWindowLabel(), pinned });
}

export function setAlwaysOnTop(value: boolean): Promise<void> {
  return invoke("set_always_on_top_cmd", { label: thisWindowLabel(), value });
}

export async function closeThisWindow(): Promise<void> {
  await getCurrentWindow().close();
}
