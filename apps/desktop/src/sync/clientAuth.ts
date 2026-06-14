import { getServerUrl, setSession } from "./config";

/** Ask the server to send (or, in dev, return) a login code for this email. */
export async function requestCode(email: string): Promise<{ devCode?: string }> {
  const res = await fetch(`${getServerUrl()}/auth/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`request failed (${res.status})`);
  const body = (await res.json()) as { ok: boolean; code?: string };
  return { devCode: body.code };
}

/** Exchange an email + code for a JWT and persist the session. */
export async function verifyCode(email: string, code: string): Promise<void> {
  const res = await fetch(`${getServerUrl()}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) throw new Error("invalid or expired code");
  const body = (await res.json()) as { token: string; userId: string };
  setSession(body.token, body.userId, email);
}
