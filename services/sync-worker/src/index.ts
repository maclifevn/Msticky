import { authLoginSchema, opSchema, type Note } from "@msticky/shared";
import type { Env } from "./env";
import { signJwt, tokenFromRequest, verifyJwt } from "./auth";
import { notesSince, upsertNote } from "./notesRepo";

export { UserDO } from "./userDO";

const TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30 days

/** Length-independent string compare to avoid leaking the passphrase by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function claims(req: Request, env: Env) {
  const token = tokenFromRequest(req);
  return token ? verifyJwt(token, env.JWT_SECRET) : null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      // ── Auth: email + shared passphrase → JWT ─────────────────────────────
      if (url.pathname === "/auth/login" && req.method === "POST") {
        const { email, passphrase } = authLoginSchema.parse(await req.json());
        if (!env.ACCOUNT_PASSPHRASE || !timingSafeEqual(passphrase, env.ACCOUNT_PASSPHRASE)) {
          return json({ error: "invalid_passphrase" }, 401);
        }
        const userId = await ensureUser(env, email);
        const token = await signJwt(
          { sub: userId, email, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S },
          env.JWT_SECRET,
        );
        return json({ token, userId });
      }

      // ── WebSocket → per-user Durable Object ───────────────────────────────
      if (url.pathname === "/ws") {
        const c = await claims(req, env);
        if (!c) return new Response("unauthorized", { status: 401 });
        const device = url.searchParams.get("device") ?? crypto.randomUUID();

        const id = env.USER_DO.idFromName(c.sub);
        const stub = env.USER_DO.get(id);
        const doUrl = new URL(req.url);
        doUrl.searchParams.set("uid", c.sub);
        doUrl.searchParams.set("did", device);
        return stub.fetch(new Request(doUrl, req));
      }

      // ── REST sync fallback (used for first pull / when WS is down) ─────────
      if (url.pathname === "/notes" && req.method === "GET") {
        const c = await claims(req, env);
        if (!c) return json({ error: "unauthorized" }, 401);
        const since = Number(url.searchParams.get("since") ?? "0");
        const notes = await notesSince(env, c.sub, Number.isFinite(since) ? since : 0);
        return json({ notes });
      }

      if (url.pathname === "/notes/batch" && req.method === "POST") {
        const c = await claims(req, env);
        if (!c) return json({ error: "unauthorized" }, 401);
        const body = (await req.json()) as { ops?: unknown[] };
        const ops = opSchema.array().parse(body.ops ?? []);
        for (const op of ops) await upsertNote(env, c.sub, op.note);
        return json({ ok: true, applied: ops.length });
      }

      if (url.pathname === "/" || url.pathname === "/health") {
        return json({ ok: true, service: "msticky-sync" });
      }

      return json({ error: "not_found" }, 404);
    } catch (err) {
      return json({ error: "bad_request", detail: String(err) }, 400);
    }
  },
};

async function ensureUser(env: Env, email: string): Promise<string> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)")
    .bind(id, email, Date.now())
    .run();
  return id;
}

// Re-exported so the Note type is reachable for downstream typing if needed.
export type { Note };
