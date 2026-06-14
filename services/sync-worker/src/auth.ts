/** Minimal HS256 JWT + login-code helpers, built on Web Crypto (no deps). */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface JwtClaims {
  sub: string; // user id
  email: string;
  exp: number; // epoch seconds
}

export async function signJwt(claims: JwtClaims, secret: string): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    b64urlDecode(sig),
    enc.encode(`${header}.${payload}`),
  );
  if (!ok) return null;
  try {
    const claims = JSON.parse(dec.decode(b64urlDecode(payload))) as JwtClaims;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** 6-digit numeric login code. */
export function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** Extract a bearer token from the Authorization header or `token` query param. */
export function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const url = new URL(req.url);
  return url.searchParams.get("token");
}
