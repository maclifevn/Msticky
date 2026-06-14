import { useEffect, useMemo, useState } from "react";
import type { Note } from "@msticky/shared";
import { useNotes } from "../store/hooks";
import { createNote, archiveNote, deleteNote } from "../store/actions";
import { openNoteWindow } from "../lib/native";
import { swatch } from "../lib/colors";
import { useTheme } from "../lib/theme";
import { noteTitle } from "../lib/markdown";
import { getSyncEngine, type SyncStatus } from "../sync/syncEngine";
import { AccountPanel } from "../components/AccountPanel";
import {
  PlusIcon,
  SearchIcon,
  ArchiveIcon,
  TrashIcon,
  SunIcon,
  MoonIcon,
} from "../components/Icons";

const STATUS_COLOR: Record<SyncStatus, string> = {
  "signed-out": "#94a3b8",
  connecting: "#f59e0b",
  online: "#10b981",
  offline: "#ef4444",
};

export function BoardWindow() {
  const [theme, setTheme] = useTheme();
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("signed-out");
  const [showAccount, setShowAccount] = useState(false);
  const notes = useNotes(showArchived);

  // The sync engine runs in the board window; it bridges every window's edits
  // to the hub and applies remote changes back into the shared SQLite cache.
  useEffect(() => {
    const engine = getSyncEngine();
    const off = engine.onStatus(setSyncStatus);
    void engine.start();
    return () => {
      off();
      engine.stop();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = showArchived ? notes : notes.filter((n) => !n.archived);
    if (!q) return base;
    return base.filter((n) => n.content.toLowerCase().includes(q));
  }, [notes, query, showArchived]);

  const newNote = async () => {
    const n = await createNote();
    await openNoteWindow(n.id);
  };

  const isDark = theme === "dark";

  return (
    <div
      className={`flex h-screen w-screen flex-col ${
        isDark ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-800"
      }`}
    >
      {/* Title bar (draggable) */}
      <header
        data-tauri-drag-region
        className="drag-region flex items-center gap-2 px-4 py-3"
      >
        <span className="text-lg font-bold tracking-tight">Msticky</span>
        <span className="text-xs opacity-50">{filtered.length} notes</span>
        <div className="flex-1" />
        <button
          title="Account & sync"
          onClick={() => setShowAccount(true)}
          className="no-drag flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-black/10"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: STATUS_COLOR[syncStatus] }}
          />
          {syncStatus === "online"
            ? "Synced"
            : syncStatus === "signed-out"
              ? "Sign in"
              : syncStatus === "connecting"
                ? "…"
                : "Offline"}
        </button>
        <IconBtn title="Toggle theme" onClick={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? <SunIcon /> : <MoonIcon />}
        </IconBtn>
        <button
          onClick={newNote}
          className="no-drag flex items-center gap-1 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-300"
        >
          <PlusIcon /> New
        </button>
      </header>

      {/* Search + filter */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <div
          className={`no-drag flex flex-1 items-center gap-2 rounded-lg px-3 py-1.5 ${
            isDark ? "bg-slate-800" : "bg-white shadow-sm"
          }`}
        >
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`no-drag flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm ${
            showArchived
              ? "bg-amber-400 text-amber-950"
              : isDark
                ? "bg-slate-800"
                : "bg-white shadow-sm"
          }`}
        >
          <ArchiveIcon /> {showArchived ? "All" : "Active"}
        </button>
      </div>

      {/* Grid */}
      <div className="grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 overflow-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <div className="col-span-full mt-16 text-center text-sm opacity-50">
            {query ? "No notes match your search." : "No notes yet — hit New."}
          </div>
        ) : (
          filtered.map((n) => (
            <NoteCard key={n.id} note={n} theme={theme} />
          ))
        )}
      </div>

      {showAccount && (
        <AccountPanel
          status={syncStatus}
          isDark={isDark}
          onClose={() => setShowAccount(false)}
        />
      )}
    </div>
  );
}

function NoteCard({ note, theme }: { note: Note; theme: "light" | "dark" }) {
  const s = swatch(note.color, theme);
  return (
    <div
      className="group relative flex h-40 cursor-pointer flex-col overflow-hidden rounded-lg p-2 shadow-sm transition hover:shadow-md"
      style={{ background: s.bg, color: s.fg }}
      onClick={() => void openNoteWindow(note.id)}
    >
      <div className="line-clamp-1 text-xs font-semibold">{noteTitle(note.content)}</div>
      <div className="mt-1 flex-1 overflow-hidden whitespace-pre-wrap text-[11px] leading-snug opacity-80">
        {note.content.slice(0, 240) || "Empty note"}
      </div>
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <CardBtn
          title={note.archived ? "Unarchive" : "Archive"}
          onClick={(e) => {
            e.stopPropagation();
            void archiveNote(note.id, !note.archived);
          }}
        >
          <ArchiveIcon width={13} height={13} />
        </CardBtn>
        <CardBtn
          title="Delete"
          onClick={(e) => {
            e.stopPropagation();
            void deleteNote(note.id);
          }}
        >
          <TrashIcon width={13} height={13} />
        </CardBtn>
      </div>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="no-drag flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/10"
    >
      {children}
    </button>
  );
}

function CardBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-md bg-black/15 hover:bg-black/30"
    >
      {children}
    </button>
  );
}
