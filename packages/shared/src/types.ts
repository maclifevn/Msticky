import { z } from "zod";

/**
 * Preset paper colors. The actual hex values live in the desktop theme so the
 * UI can render light/dark variants; here we only persist the palette key.
 */
export const NOTE_COLORS = [
  "yellow",
  "pink",
  "blue",
  "green",
  "purple",
  "orange",
  "gray",
] as const;
export const noteColorSchema = z.enum(NOTE_COLORS);
export type NoteColor = z.infer<typeof noteColorSchema>;

/**
 * A sticky note. `updatedAt` is an epoch-millis logical timestamp used for
 * last-write-wins conflict resolution. `deleted` is a tombstone so deletions
 * propagate across devices instead of silently reappearing on the next pull.
 */
export const noteSchema = z.object({
  id: z.string().min(1),
  content: z.string().default(""),
  color: noteColorSchema.default("yellow"),
  posX: z.number().default(80),
  posY: z.number().default(80),
  width: z.number().positive().default(280),
  height: z.number().positive().default(280),
  pinned: z.boolean().default(false),
  alwaysOnTop: z.boolean().default(false),
  archived: z.boolean().default(false),
  deleted: z.boolean().default(false),
  /** epoch millis; the authority for LWW merges */
  updatedAt: z.number().int().nonnegative(),
});
export type Note = z.infer<typeof noteSchema>;

/**
 * An operation flowing between a device and the sync hub. We ship the full note
 * snapshot (not a diff) so the receiver can apply note-level LWW with no prior
 * state, which keeps reconnect/replay trivial.
 */
export const opSchema = z.object({
  /** client-generated id, lets the server ack and the client dedupe */
  opId: z.string().min(1),
  /** which device produced this op, so the hub never echoes it back */
  deviceId: z.string().min(1),
  note: noteSchema,
});
export type Op = z.infer<typeof opSchema>;

/** Messages sent over the WebSocket between device and UserDO. */
export const clientMessageSchema = z.discriminatedUnion("type", [
  // device → hub: apply these ops
  z.object({ type: z.literal("push"), ops: z.array(opSchema) }),
  // device → hub: send me everything changed since this timestamp
  z.object({ type: z.literal("pull"), since: z.number().int().nonnegative() }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  // hub → device: ops originating elsewhere, or the answer to a pull
  z.object({ type: z.literal("sync"), notes: z.array(noteSchema) }),
  // hub → device: ack of a push (opIds that were applied)
  z.object({ type: z.literal("ack"), opIds: z.array(z.string()) }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

/**
 * Note-level last-write-wins merge. Returns whichever note is newer; ties favor
 * the incoming note so a re-broadcast of an equal-timestamp note is idempotent.
 */
export function mergeNote(local: Note | undefined, incoming: Note): Note {
  if (!local) return incoming;
  return incoming.updatedAt >= local.updatedAt ? incoming : local;
}

/**
 * Auth payload. The desktop app runs the Google OAuth (PKCE, loopback) flow and
 * sends the authorization `code` here; the worker exchanges it for a Google
 * id_token, verifies it, and issues a session JWT scoped to the verified email.
 * Each Google account is its own private notes namespace.
 */
export const googleAuthSchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(1),
  redirectUri: z.string().url(),
});
export type GoogleAuth = z.infer<typeof googleAuthSchema>;

/**
 * End-to-end encryption config, stored per user. `salt` feeds PBKDF2 on the
 * device; `verifier` is a known value encrypted with the derived key so a
 * device can check a passphrase is correct. Neither reveals the key/passphrase,
 * so the server stays unable to decrypt note content.
 */
export const e2eConfigSchema = z.object({
  salt: z.string().min(1),
  verifier: z.string().min(1),
});
export type E2eConfig = z.infer<typeof e2eConfigSchema>;
