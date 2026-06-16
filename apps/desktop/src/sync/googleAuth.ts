import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
// Route the worker call through Rust (native HTTP). The webview's own fetch is
// blocked from the custom `tauri://` origin to remote HTTPS ("Load failed").
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GOOGLE_CLIENT_ID, getServerUrl, setSession } from "./config";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;
// Emitted by the Rust loopback server (lib.rs) carrying the redirect's
// path+query, e.g. "/?code=...&state=...".
const OAUTH_REDIRECT_EVENT = "msticky://oauth-redirect";

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
 *  1. bind our Rust loopback server (oauth_bind) and open the system browser
 *  2. capture the redirect's `code` via the OAUTH_REDIRECT_EVENT it emits
 *  3. hand `code` + verifier to the worker, which exchanges + verifies it and
 *     returns our session JWT
 * Each Google account maps to its own private notes namespace.
 */
export async function signInWithGoogle(
  onStage?: (stage: string) => void,
): Promise<void> {
  const stage = (s: string) => onStage?.(s);

  const codeVerifier = randomString(64);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const state = randomString(24);

  // Deferred resolved by the loopback redirect handler.
  let resolveCode!: (c: string) => void;
  let rejectCode!: (e: unknown) => void;
  let settled = false;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = (c) => {
      if (!settled) {
        settled = true;
        res(c);
      }
    };
    rejectCode = (e) => {
      if (!settled) {
        settled = true;
        rej(e);
      }
    };
  });

  // Extract the authorization code from the loopback redirect path+query.
  const handleRedirect = (pathAndQuery: string) => {
    const qi = pathAndQuery.indexOf("?");
    const params = new URLSearchParams(qi >= 0 ? pathAndQuery.slice(qi + 1) : "");
    const err = params.get("error");
    if (err) return rejectCode(new Error(err));
    const c = params.get("code");
    if (!c) return; // not the redirect we care about — ignore
    if (params.get("state") !== state) {
      return rejectCode(new Error("State mismatch"));
    }
    stage("exchanging");
    resolveCode(c);
  };

  // Listen BEFORE binding the server so we can't miss an early redirect.
  const unlisten = await listen<string>(OAUTH_REDIRECT_EVENT, (e) =>
    handleRedirect(e.payload),
  );

  const port = await invoke<number>("oauth_bind");
  const redirectUri = `http://127.0.0.1:${port}`;
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

  const timer = window.setTimeout(
    () => rejectCode(new Error("Sign-in timed out")),
    LOGIN_TIMEOUT_MS,
  );

  try {
    stage("opening-browser");
    await openUrl(authUrl);
    stage("waiting");
    const code = await codePromise;

    stage("exchanging");
    const res = await tauriFetch(`${getServerUrl()}/auth/google`, {
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
    stage("done");
    // Bring the app back to the front so the user doesn't have to leave the
    // browser tab manually.
    try {
      const win = getCurrentWindow();
      await win.unminimize();
      await win.show();
      await win.setFocus();
    } catch {
      /* focus is best-effort */
    }
  } finally {
    window.clearTimeout(timer);
    unlisten();
  }
}
