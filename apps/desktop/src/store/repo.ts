import Database from "@tauri-apps/plugin-sql";
import { type Note, noteSchema } from "@msticky/shared";

/**
 * Local SQLite cache. Schema/migrations are declared on the Rust side via
 * tauri-plugin-sql, so loading here just opens the already-migrated db.
 */
let dbPromise: Promise<Database> | null = null;
function db(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:msticky.db");
  return dbPromise;
}

interface Row {
  id: string;
  content: string;
  color: string;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  pinned: number;
  always_on_top: number;
  archived: number;
  deleted: number;
  updated_at: number;
}

function rowToNote(r: Row): Note {
  return noteSchema.parse({
    id: r.id,
    content: r.content,
    color: r.color,
    posX: r.pos_x,
    posY: r.pos_y,
    width: r.width,
    height: r.height,
    pinned: !!r.pinned,
    alwaysOnTop: !!r.always_on_top,
    archived: !!r.archived,
    deleted: !!r.deleted,
    updatedAt: r.updated_at,
  });
}

const b = (v: boolean) => (v ? 1 : 0);

/** Insert or replace a note wholesale (used by edits and by sync). */
export async function upsertNote(note: Note): Promise<void> {
  const d = await db();
  await d.execute(
    `INSERT INTO notes
       (id, content, color, pos_x, pos_y, width, height, pinned, always_on_top, archived, deleted, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(id) DO UPDATE SET
       content=$2, color=$3, pos_x=$4, pos_y=$5, width=$6, height=$7,
       pinned=$8, always_on_top=$9, archived=$10, deleted=$11, updated_at=$12`,
    [
      note.id,
      note.content,
      note.color,
      note.posX,
      note.posY,
      note.width,
      note.height,
      b(note.pinned),
      b(note.alwaysOnTop),
      b(note.archived),
      b(note.deleted),
      note.updatedAt,
    ],
  );
}

export async function getNote(id: string): Promise<Note | undefined> {
  const d = await db();
  const rows = await d.select<Row[]>("SELECT * FROM notes WHERE id = $1", [id]);
  return rows[0] ? rowToNote(rows[0]) : undefined;
}

/** All live (non-deleted) notes, newest first. */
export async function getActiveNotes(includeArchived = false): Promise<Note[]> {
  const d = await db();
  const where = includeArchived
    ? "deleted = 0"
    : "deleted = 0 AND archived = 0";
  const rows = await d.select<Row[]>(
    `SELECT * FROM notes WHERE ${where} ORDER BY updated_at DESC`,
  );
  return rows.map(rowToNote);
}

export async function getAllNotes(): Promise<Note[]> {
  const d = await db();
  const rows = await d.select<Row[]>(
    "SELECT * FROM notes ORDER BY updated_at DESC",
  );
  return rows.map(rowToNote);
}

/** Notes changed since a timestamp — feeds the sync engine's push queue. */
export async function getNotesSince(since: number): Promise<Note[]> {
  const d = await db();
  const rows = await d.select<Row[]>(
    "SELECT * FROM notes WHERE updated_at > $1 ORDER BY updated_at ASC",
    [since],
  );
  return rows.map(rowToNote);
}
