import { type Note, noteSchema } from "@msticky/shared";
import type { Env } from "./env";

/** D1 row ⇄ Note mapping for the server side (notes are scoped by user_id). */
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

export function rowToNote(r: Row): Note {
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

/** Last-write-wins upsert: only overwrites when the incoming note is newer. */
export async function upsertNote(env: Env, userId: string, note: Note): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notes
       (id, user_id, content, color, pos_x, pos_y, width, height, pinned, always_on_top, archived, deleted, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
     ON CONFLICT(user_id, id) DO UPDATE SET
       content=excluded.content, color=excluded.color,
       pos_x=excluded.pos_x, pos_y=excluded.pos_y,
       width=excluded.width, height=excluded.height,
       pinned=excluded.pinned, always_on_top=excluded.always_on_top,
       archived=excluded.archived, deleted=excluded.deleted,
       updated_at=excluded.updated_at
     WHERE excluded.updated_at >= notes.updated_at`,
  )
    .bind(
      note.id,
      userId,
      note.content,
      note.color,
      note.posX,
      note.posY,
      note.width,
      note.height,
      note.pinned ? 1 : 0,
      note.alwaysOnTop ? 1 : 0,
      note.archived ? 1 : 0,
      note.deleted ? 1 : 0,
      note.updatedAt,
    )
    .run();
}

export async function notesSince(env: Env, userId: string, since: number): Promise<Note[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM notes WHERE user_id = ?1 AND updated_at > ?2 ORDER BY updated_at ASC",
  )
    .bind(userId, since)
    .all<Row>();
  return results.map(rowToNote);
}
