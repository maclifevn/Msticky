# Msticky

Realtime sticky notes for **Windows & macOS**. Paper-style notes you can pin to the
desktop or keep always-on-top, with markdown + checklists, colors, dark/light themes,
a global quick-note hotkey, search & archive — and **realtime sync** of your own notes
across every machine you sign in on.

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Desktop  | [Tauri 2](https://tauri.app) (Rust) + React + TS + Tailwind |
| Sync     | Cloudflare Workers + Durable Objects + D1 (WebSocket)       |
| Auth     | Email magic link → JWT                                      |
| Local DB | SQLite (offline-first cache via `tauri-plugin-sql`)         |

## Repo layout

```
apps/desktop        Tauri desktop app (React UI + Rust core)
packages/shared     Shared TS types + zod schemas (Note / Op)
services/sync-worker Cloudflare Worker + Durable Object + D1
```

## Prerequisites

- Node ≥ 22, pnpm ≥ 9
- Rust stable (`rustup`) — required to compile the Tauri app
- macOS: Xcode Command Line Tools. Windows: MSVC build tools + WebView2.
- `wrangler` for the sync worker

## Quick start

```bash
pnpm install
pnpm build:shared          # build shared types first
pnpm dev                   # run the desktop app (tauri dev)
pnpm worker:dev            # run the Cloudflare worker locally
```

See [docs/](docs/) for milestone notes.
