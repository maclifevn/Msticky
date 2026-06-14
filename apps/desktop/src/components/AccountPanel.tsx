import { useState } from "react";
import { login } from "../sync/clientAuth";
import {
  clearSession,
  getEmail,
  getServerUrl,
  setServerUrl,
} from "../sync/config";
import { getSyncEngine, type SyncStatus } from "../sync/syncEngine";

interface Props {
  status: SyncStatus;
  isDark: boolean;
  onClose: () => void;
}

/** Sign-in (email → code) and sync settings, shown as a modal from the board. */
export function AccountPanel({ status, isDark, onClose }: Props) {
  const signedIn = status !== "signed-out";
  const [email, setEmail] = useState(getEmail() ?? "");
  const [server, setServer] = useState(getServerUrl());
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const card = isDark ? "bg-slate-800 text-slate-100" : "bg-white text-slate-800";
  const field = isDark
    ? "bg-slate-900 border-slate-700"
    : "bg-slate-50 border-slate-200";

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      setServerUrl(server);
      await login(email, passphrase);
      getSyncEngine().reconnectNow();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    clearSession();
    getSyncEngine().reconnectNow();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={`w-80 rounded-2xl p-5 shadow-xl ${card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-bold">Account & Sync</h2>

        {signedIn ? (
          <div className="space-y-3">
            <p className="text-sm">
              Signed in as <span className="font-medium">{getEmail()}</span>
            </p>
            <p className="text-xs opacity-60">
              Status: <StatusText status={status} />
            </p>
            <button
              onClick={signOut}
              className="w-full rounded-lg bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-400"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs font-medium opacity-70">Server URL</label>
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${field}`}
              placeholder="https://msticky-sync.<you>.workers.dev"
            />

            <label className="block text-xs font-medium opacity-70">Email</label>
            <input
              value={email}
              type="email"
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${field}`}
              placeholder="you@example.com"
            />

            <label className="block text-xs font-medium opacity-70">
              Account passphrase
            </label>
            <input
              value={passphrase}
              type="password"
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email && passphrase) void signIn();
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${field}`}
              placeholder="shared secret"
            />

            <p className="text-xs opacity-50">
              Use the same email + passphrase on every device to sync them.
            </p>
            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              disabled={busy || !email || !passphrase}
              onClick={signIn}
              className="w-full rounded-lg bg-amber-400 py-2 text-sm font-medium text-amber-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {busy ? "…" : "Sign in"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusText({ status }: { status: SyncStatus }) {
  const map: Record<SyncStatus, string> = {
    "signed-out": "signed out",
    connecting: "connecting…",
    online: "synced",
    offline: "offline (will retry)",
  };
  return <span>{map[status]}</span>;
}
