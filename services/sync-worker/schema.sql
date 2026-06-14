-- D1 schema for the Msticky sync worker.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

-- Short-lived login codes for the email magic-link/code flow.
CREATE TABLE IF NOT EXISTS auth_codes (
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (email)
);

-- The authoritative copy of every note, scoped to a user. Mirrors the desktop
-- SQLite schema; `updated_at` drives last-write-wins.
CREATE TABLE IF NOT EXISTS notes (
  id            TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT 'yellow',
  pos_x         REAL NOT NULL DEFAULT 80,
  pos_y         REAL NOT NULL DEFAULT 80,
  width         REAL NOT NULL DEFAULT 280,
  height        REAL NOT NULL DEFAULT 280,
  pinned        INTEGER NOT NULL DEFAULT 0,
  always_on_top INTEGER NOT NULL DEFAULT 0,
  archived      INTEGER NOT NULL DEFAULT 0,
  deleted       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_notes_user_updated ON notes(user_id, updated_at);
