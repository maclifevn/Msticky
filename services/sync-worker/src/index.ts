import { googleAuthSchema, e2eConfigSchema, opSchema, type Note } from "@msticky/shared";
import type { Env } from "./env";
import { decodeJwtPayload, signJwt, tokenFromRequest, verifyJwt } from "./auth";
import { notesSince, upsertNote } from "./notesRepo";

export { UserDO } from "./userDO";

const TOKEN_TTL_S = 30 * 24 * 60 * 60; // 30 days

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

interface GoogleIdClaims {
  iss: string;
  aud: string;
  exp: number;
  email?: string;
  email_verified?: boolean | string;
  sub?: string;
}

/**
 * Exchange a PKCE authorization code for Google tokens and return the verified
 * email. Throws on any failure (bad code, wrong audience, unverified email).
 */
async function verifyGoogleCode(
  env: Env,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`google_token_exchange_failed_${res.status}`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("no_id_token");

  const claims = decodeJwtPayload<GoogleIdClaims>(tokens.id_token);
  if (!claims) throw new Error("bad_id_token");
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("aud_mismatch");
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error("iss_mismatch");
  if (claims.exp * 1000 < Date.now()) throw new Error("id_token_expired");
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!claims.email || !verified) throw new Error("email_not_verified");
  return claims.email;
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
      // ── Auth: Google OAuth code → verified email → session JWT ────────────
      if (url.pathname === "/auth/google" && req.method === "POST") {
        const { code, codeVerifier, redirectUri } = googleAuthSchema.parse(
          await req.json(),
        );
        let email: string;
        try {
          email = await verifyGoogleCode(env, code, codeVerifier, redirectUri);
        } catch (e) {
          return json({ error: "google_auth_failed", detail: String(e) }, 401);
        }
        const userId = await ensureUser(env, email);
        const token = await signJwt(
          { sub: userId, email, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S },
          env.JWT_SECRET,
        );
        return json({ token, userId, email });
      }

      // ── E2E config (salt + verifier) per user ─────────────────────────────
      if (url.pathname === "/e2e" && req.method === "GET") {
        const c = await claims(req, env);
        if (!c) return json({ error: "unauthorized" }, 401);
        const row = await env.DB.prepare(
          "SELECT e2e_salt, e2e_verifier FROM users WHERE id = ?1",
        )
          .bind(c.sub)
          .first<{ e2e_salt: string | null; e2e_verifier: string | null }>();
        if (!row?.e2e_salt || !row?.e2e_verifier) return json({ salt: null });
        return json({ salt: row.e2e_salt, verifier: row.e2e_verifier });
      }

      if (url.pathname === "/e2e" && req.method === "POST") {
        const c = await claims(req, env);
        if (!c) return json({ error: "unauthorized" }, 401);
        const { salt, verifier } = e2eConfigSchema.parse(await req.json());
        // First write wins: changing the passphrase later would orphan existing
        // ciphertext, so refuse to overwrite an existing config.
        const existing = await env.DB.prepare(
          "SELECT e2e_salt FROM users WHERE id = ?1",
        )
          .bind(c.sub)
          .first<{ e2e_salt: string | null }>();
        if (existing?.e2e_salt) return json({ error: "already_configured" }, 409);
        await env.DB.prepare(
          "UPDATE users SET e2e_salt = ?2, e2e_verifier = ?3 WHERE id = ?1",
        )
          .bind(c.sub, salt, verifier)
          .run();
        return json({ ok: true });
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
