import { useState } from "react";
import { signInWithGoogle } from "../sync/clientAuth";
import { clearSession, getEmail, getServerUrl, setServerUrl } from "../sync/config";
import { getSyncEngine, type SyncStatus } from "../sync/syncEngine";
import type { E2eMode } from "../sync/e2e";

interface Props {
  status: SyncStatus;
  e2eMode: E2eMode;
  isDark: boolean;
  onEnableEncryption: (passphrase: string) => Promise<void>;
  onUnlock: (passphrase: string) => Promise<void>;
  onClose: () => void;
}

/** Sign in with Google and manage the sync session. */
export function AccountPanel({
  status,
  e2eMode,
  isDark,
  onEnableEncryption,
  onUnlock,
  onClose,
}: Props) {
  const signedIn = status !== "signed-out";
  const [server, setServer] = useState(getServerUrl());
  const [showAdvanced, setShowAdvanced] = useState(false);
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
      await signInWithGoogle();
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

            <EncryptionSection
              mode={e2eMode}
              field={field}
              onEnableEncryption={onEnableEncryption}
              onUnlock={onUnlock}
            />

            <button
              onClick={signOut}
              className="w-full rounded-lg bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-400"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs opacity-60">
              Sign in with your Google account to sync your notes across devices.
              Your notes are private to you.
            </p>

            <button
              disabled={busy}
              onClick={signIn}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <GoogleGlyph />
              {busy ? "Opening browser…" : "Sign in with Google"}
            </button>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs opacity-50 hover:opacity-80"
            >
              {showAdvanced ? "Hide" : "Advanced"} settings
            </button>
            {showAdvanced && (
              <div className="space-y-1">
                <label className="block text-xs font-medium opacity-70">
                  Server URL
                </label>
                <input
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${field}`}
                  placeholder="https://msticky-sync.<you>.workers.dev"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EncryptionSection({
  mode,
  field,
  onEnableEncryption,
  onUnlock,
}: {
  mode: E2eMode;
  field: string;
  onEnableEncryption: (p: string) => Promise<void>;
  onUnlock: (p: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(mode === "locked");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (mode === "unlocked") {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
        🔒 End-to-end encryption: <span className="font-semibold">on</span>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    if (mode === "off" && pass !== confirm) {
      setError("Passphrases don't match");
      return;
    }
    if (pass.length < 6) {
      setError("Use at least 6 characters");
      return;
    }
    setBusy(true);
    try {
      if (mode === "off") await onEnableEncryption(pass);
      else await onUnlock(pass);
      setPass("");
      setConfirm("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isUnlock = mode === "locked";

  return (
    <div className="rounded-lg border border-black/10 px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span>
          🔒 End-to-end encryption:{" "}
          <span className="font-semibold">{isUnlock ? "locked" : "off"}</span>
        </span>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="rounded-md bg-black/10 px-2 py-1 font-medium hover:bg-black/20"
          >
            {isUnlock ? "Unlock" : "Enable"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {!isUnlock && (
            <p className="opacity-60">
              Encrypts note text on your device so the server can't read it. If you
              forget this passphrase, encrypted notes can't be recovered.
            </p>
          )}
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={isUnlock ? "Encryption passphrase" : "New passphrase"}
            className={`w-full rounded-md border px-2 py-1.5 outline-none ${field}`}
          />
          {!isUnlock && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="Confirm passphrase"
              className={`w-full rounded-md border px-2 py-1.5 outline-none ${field}`}
            />
          )}
          {error && <p className="text-red-500">{error}</p>}
          <button
            disabled={busy || !pass}
            onClick={submit}
            className="w-full rounded-md bg-amber-400 py-1.5 font-medium text-amber-950 hover:bg-amber-300 disabled:opacity-50"
          >
            {busy ? "…" : isUnlock ? "Unlock this device" : "Enable encryption"}
          </button>
        </div>
      )}
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

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
