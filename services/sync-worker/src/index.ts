import {
  authRequestSchema,
  authVerifySchema,
  opSchema,
  type Note,
} from "@msticky/shared";
import type { Env } from "./env";
import { generateCode, signJwt, tokenFromRequest, verifyJwt } from "./auth";
import { notesSince, upsertNote } from "./notesRepo";

export { UserDO } from "./userDO";

const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30 days

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
      // ── Auth ────────────────────────────────────────────────────────────
      if (url.pathname === "/auth/request" && req.method === "POST") {
        const { email } = authRequestSchema.parse(await req.json());
        const code = generateCode();
        await env.DB.prepare(
          `INSERT INTO auth_codes (email, code, expires_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(email) DO UPDATE SET code=?2, expires_at=?3`,
        )
          .bind(email, code, Date.now() + CODE_TTL_MS)
          .run();

        await sendLoginEmail(env, email, code);
        // In dev we hand the code straight back so you can sign in without email.
        return json(env.DEV_RETURN_CODE === "1" ? { ok: true, code } : { ok: true });
      }

      if (url.pathname === "/auth/verify" && req.method === "POST") {
        const { email, code } = authVerifySchema.parse(await req.json());
        const row = await env.DB.prepare(
          "SELECT code, expires_at FROM auth_codes WHERE email = ?1",
        )
          .bind(email)
          .first<{ code: string; expires_at: number }>();
        if (!row || row.code !== code || row.expires_at < Date.now()) {
          return json({ error: "invalid_or_expired_code" }, 401);
        }
        await env.DB.prepare("DELETE FROM auth_codes WHERE email = ?1").bind(email).run();

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

/**
 * Deliver the login code. Wire this to Cloudflare Email Routing / Email Service
 * for production (see the cloudflare-email-service skill). In dev with
 * DEV_RETURN_CODE=1 the code also comes back in the API response, so this is a
 * no-op fallback rather than a hard dependency.
 */
async function sendLoginEmail(env: Env, email: string, code: string): Promise<void> {
  if (env.DEV_RETURN_CODE === "1") {
    console.log(`[msticky] login code for ${email}: ${code}`);
    return;
  }
  // TODO(M2+): send via Email binding. Intentionally left unimplemented so a
  // missing email setup never blocks auth during early development.
  console.log(`[msticky] (email send not configured) code for ${email}`);
}

// Re-exported so the Note type is reachable for downstream typing if needed.
export type { Note };
