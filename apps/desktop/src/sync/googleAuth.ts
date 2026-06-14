import { start, onUrl, cancel } from "@fabianlars/tauri-plugin-oauth";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GOOGLE_CLIENT_ID, getServerUrl, setSession } from "./config";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64url(arr).slice(0, len);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

/**
 * Run the Google OAuth (Authorization Code + PKCE) flow:
 *  1. spin a loopback server (tauri-plugin-oauth) and open the system browser
 *  2. capture the redirect's `code`
 *  3. hand `code` + verifier to the worker, which exchanges + verifies it and
 *     returns our session JWT
 * Each Google account maps to its own private notes namespace.
 */
export async function signInWithGoogle(): Promise<void> {
  const port = await start();
  const redirectUri = `http://127.0.0.1:${port}`;

  const codeVerifier = randomString(64);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const state = randomString(24);
  const authUrl =
    `${GOOGLE_AUTH_URL}?` +
    new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      prompt: "select_account",
    }).toString();

  // Deferred resolved by the loopback redirect handler.
  let resolveCode!: (c: string) => void;
  let rejectCode!: (e: unknown) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });

  const unlisten = await onUrl((url) => {
    try {
      const u = new URL(url);
      const err = u.searchParams.get("error");
      if (err) throw new Error(err);
      if (u.searchParams.get("state") !== state) throw new Error("State mismatch");
      const c = u.searchParams.get("code");
      if (!c) throw new Error("No authorization code");
      resolveCode(c);
    } catch (e) {
      rejectCode(e);
    }
  });
  const timer = window.setTimeout(
    () => rejectCode(new Error("Sign-in timed out")),
    LOGIN_TIMEOUT_MS,
  );

  try {
    await openUrl(authUrl);
    const code = await codePromise;

    const res = await fetch(`${getServerUrl()}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, codeVerifier, redirectUri }),
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 ? "Google rejected the sign-in" : `Sign-in failed (${res.status})`,
      );
    }
    const body = (await res.json()) as {
      token: string;
      userId: string;
      email: string;
    };
    setSession(body.token, body.userId, body.email);
  } finally {
    window.clearTimeout(timer);
    unlisten();
    await cancel(port).catch(() => {});
  }
}
