import { getServerUrl, setSession } from "./config";

/**
 * Sign in with an email + the shared account passphrase. The email picks which
 * notes namespace to join (use the same one on every device); the passphrase is
 * checked against the server's ACCOUNT_PASSPHRASE secret. On success the JWT
 * session is persisted.
 */
export async function login(email: string, passphrase: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, passphrase }),
  });
  if (res.status === 401) throw new Error("Wrong passphrase");
  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  const body = (await res.json()) as { token: string; userId: string };
  setSession(body.token, body.userId, email);
}
