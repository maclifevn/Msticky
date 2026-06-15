import { start, onUrl, onInvalidUrl, cancel } from "@fabianlars/tauri-plugin-oauth";
import { openUrl } from "@tauri-apps/plugin-opener";
// Route the worker call through Rust (native HTTP). The webview's own fetch is
// blocked from the custom `tauri://` origin to remote HTTPS ("Load failed").
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GOOGLE_CLIENT_ID, getServerUrl, setSession } from "./config";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

/** Page the browser shows after the redirect; tries to close itself. */
const DONE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Msticky</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#fef9c3;color:#3f3a16;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.card{background:#fff;padding:2rem 2.5rem;border-radius:1rem;box-shadow:0 10px 30px rgba(0,0,0,.1)}
h1{margin:0 0 .25rem;font-size:1.25rem}p{margin:0;opacity:.6;font-size:.9rem}</style></head>
<body><div class="card"><h1>✓ Signed in to Msticky</h1><p>You can close this tab.</p></div>
<script>setTimeout(function(){window.close()},800)</script></body></html>`;

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

  // Extract the authorization code from the loopback redirect URL. Some
  // platforms route the captured URL through onInvalidUrl instead of onUrl, so
  // both feed this same handler.
  const handleRedirect = (raw: string) => {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return; // not a URL (onInvalidUrl may pass an error string) — ignore
    }
    const err = u.searchParams.get("error");
    if (err) return rejectCode(new Error(err));
    const c = u.searchParams.get("code");
    if (!c) return; // not the redirect we care about (e.g. favicon) — ignore
    if (u.searchParams.get("state") !== state) {
      return rejectCode(new Error("State mismatch"));
    }
    stage("exchanging");
    resolveCode(c);
  };

  // Register BOTH listeners BEFORE start() so we can't miss an early redirect.
  const unlistenUrl = await onUrl(handleRedirect);
  const unlistenInvalid = await onInvalidUrl(handleRedirect);

  const port = await start({ response: DONE_HTML });
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
    unlistenUrl();
    unlistenInvalid();
    await cancel(port).catch(() => {});
  }
}
