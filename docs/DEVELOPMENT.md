# Development guide

## Prerequisites

- **Node ≥ 20**, **pnpm ≥ 9** (`npm i -g pnpm`)
- **Rust stable** via [rustup](https://rustup.rs)
- macOS: Xcode Command Line Tools — `xcode-select --install`
- Windows: Visual Studio Build Tools (C++), and [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Win 11)
- `wrangler` (bundled as a dev dependency of the worker)

## First-time setup

```bash
pnpm install
pnpm build:shared          # shared types must be built before app/worker typecheck
```

## Running the desktop app

```bash
pnpm dev                   # = tauri dev (spawns vite on :1420 + the Rust shell)
```

The **board window** opens first. From it you can create notes (each opens as its
own frameless paper window), search, archive, switch theme, and sign in for sync.

Quick-note global hotkey: **⌘/Ctrl + Shift + N** (works from any app).

### Window behaviors

- **Pin to desktop** — keeps the note visible on every workspace and hides it
  from the taskbar/dock switcher, so it behaves like a sticky on the desktop.
  (A true "embedded in the wallpaper, below all windows" mode is OS-specific and
  intentionally out of scope for v1; this gives the always-visible behavior
  cross-platform.)
- **Always on top** — standard OS always-on-top, independent of Pin.

## Running the sync worker

```bash
cd services/sync-worker
pnpm db:migrate:local      # apply schema.sql to the local D1
pnpm dev                   # wrangler dev on http://localhost:8787
```

`DEV_RETURN_CODE=1` (set in `wrangler.jsonc`) returns the login code in the API
response so you can sign in locally without wiring up email. The desktop
**Account & Sync** panel pre-fills it for you in dev.

### Manual backend checks

```bash
# auth + REST round-trip is exercised by curl in the README verification steps
node services/sync-worker/ws-test.mjs   # two-device WebSocket broadcast test
```

## Deploying the worker (production)

```bash
cd services/sync-worker
wrangler d1 create msticky                       # paste the id into wrangler.jsonc
pnpm db:migrate:remote
wrangler secret put JWT_SECRET                    # a long random string
# set DEV_RETURN_CODE to "0" and wire real email (see cloudflare-email-service)
wrangler deploy
```

Then point the desktop app's **Server URL** (Account panel) at the deployed
worker, e.g. `https://msticky-sync.<account>.workers.dev`.

## Building installers

Locally you can only build for the OS you're on:

```bash
pnpm --filter @msticky/desktop build      # → src-tauri/target/release/bundle/
```

For **both** macOS (`.dmg`) and Windows (`.msi`/`.exe`), push a `vX.Y.Z` tag and
let `.github/workflows/release.yml` build them on a matrix of runners. macOS
code-signing/notarization is wired but optional — fill in the `APPLE_*` secrets
to ship a Gatekeeper-friendly build.

## Architecture at a glance

```
packages/shared   Note/Op types + zod schemas + LWW merge (used by app & worker)
apps/desktop      Tauri shell (Rust) + React UI; SQLite cache; sync engine
services/sync-worker  Worker router + per-user Durable Object hub + D1
```

- **Offline-first:** edits hit local SQLite immediately and fire a cross-window
  `NOTE_CHANGED` event. The sync engine (in the board window) hears it, queues an
  op (persisted in localStorage), and pushes over WebSocket.
- **Conflict resolution:** note-level last-write-wins by `updatedAt`, applied
  both on the device and in the worker's D1 upsert.
- **Deletes** are tombstones (`deleted = 1`) so they propagate instead of
  resurrecting on the next pull.
