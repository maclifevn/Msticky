import { type Note } from "@msticky/shared";
import { getNote, upsertNote } from "./repo";
import { announceNoteChanged } from "../lib/native";

function now(): number {
  return Date.now();
}

/**
 * Persist a note, stamp it, and notify other windows. The sync engine (running
 * in the board window) listens for the NOTE_CHANGED event and pushes the change
 * to the hub, so local edits from any window get synced without extra wiring.
 */
async function commit(note: Note): Promise<Note> {
  await upsertNote(note);
  await announceNoteChanged(note.id);
  return note;
}

export async function createNote(partial: Partial<Note> = {}): Promise<Note> {
  // Cascade new notes slightly so they don't stack exactly on top of each other.
  const jitter = Math.floor((now() % 9) * 24);
  const note: Note = {
    id: crypto.randomUUID(),
    content: "",
    color: "yellow",
    posX: 120 + jitter,
    posY: 120 + jitter,
    width: 280,
    height: 280,
    pinned: false,
    alwaysOnTop: false,
    archived: false,
    deleted: false,
    updatedAt: now(),
    ...partial,
  };
  return commit(note);
}

/** Apply a partial change to an existing note (LWW timestamp bumped). */
export async function patchNote(
  id: string,
  patch: Partial<Omit<Note, "id">>,
): Promise<Note | undefined> {
  const current = await getNote(id);
  if (!current) return undefined;
  return commit({ ...current, ...patch, updatedAt: now() });
}

export async function archiveNote(id: string, archived = true) {
  return patchNote(id, { archived });
}

/** Soft-delete (tombstone) so the deletion syncs to other devices. */
export async function deleteNote(id: string) {
  return patchNote(id, { deleted: true });
}

/**
 * Apply a note that arrived from the sync engine. Does NOT re-feed the sync
 * sink (it came from the network) but still notifies windows to refresh.
 */
export async function applyRemoteNote(note: Note): Promise<void> {
  await upsertNote(note);
  await announceNoteChanged(note.id);
}
