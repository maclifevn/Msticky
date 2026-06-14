import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import type { NoteColor } from "@msticky/shared";
import { useNote } from "../store/hooks";
import { getNote } from "../store/repo";
import { patchNote, createNote, deleteNote } from "../store/actions";
import {
  openNoteWindow,
  openBoard,
  setPinned,
  setAlwaysOnTop,
  closeThisWindow,
} from "../lib/native";
import { swatch } from "../lib/colors";
import { useTheme } from "../lib/theme";
import { NoteEditor } from "../components/NoteEditor";
import { ColorPicker } from "../components/ColorPicker";
import {
  PinIcon,
  TopIcon,
  PlusIcon,
  TrashIcon,
  BoardIcon,
  PaletteIcon,
  CloseIcon,
} from "../components/Icons";

const SAVE_GEOMETRY_MS = 400;

export function NoteWindow({ id }: { id: string }) {
  const note = useNote(id);
  const [theme] = useTheme();
  const [showColors, setShowColors] = useState(false);
  const appliedGeometry = useRef(false);
  const geomTimer = useRef<number | undefined>(undefined);

  // A note window may be opened (e.g. by the global hotkey) before its row
  // exists. Create it on first mount if missing so the window has content.
  useEffect(() => {
    let alive = true;
    void getNote(id).then((existing) => {
      if (alive && !existing) void createNote({ id });
    });
    return () => {
      alive = false;
    };
  }, [id]);

  // Push native window state (size/pos, pinned, on-top) from the note, once.
  useEffect(() => {
    if (!note || appliedGeometry.current) return;
    appliedGeometry.current = true;
    const w = getCurrentWindow();
    void w.setSize(new LogicalSize(note.width, note.height));
    void w.setPosition(new LogicalPosition(note.posX, note.posY));
    void setAlwaysOnTop(note.alwaysOnTop);
    void setPinned(note.pinned);
  }, [note]);

  // Persist geometry on user move/resize (debounced, converted to logical px).
  useEffect(() => {
    const w = getCurrentWindow();
    const save = () => {
      window.clearTimeout(geomTimer.current);
      geomTimer.current = window.setTimeout(async () => {
        const scale = await w.scaleFactor();
        const pos = (await w.outerPosition()).toLogical(scale);
        const size = (await w.innerSize()).toLogical(scale);
        await patchNote(id, {
          posX: Math.round(pos.x),
          posY: Math.round(pos.y),
          width: Math.round(size.width),
          height: Math.round(size.height),
        });
      }, SAVE_GEOMETRY_MS);
    };
    const unMoved = w.onMoved(save);
    const unResized = w.onResized(save);
    return () => {
      window.clearTimeout(geomTimer.current);
      void unMoved.then((f) => f());
      void unResized.then((f) => f());
    };
  }, [id]);

  if (!note || note.deleted) {
    return <div className="h-full w-full" />;
  }

  const s = swatch(note.color, theme);

  const togglePin = async () => {
    await patchNote(id, { pinned: !note.pinned });
    await setPinned(!note.pinned);
  };
  const toggleTop = async () => {
    await patchNote(id, { alwaysOnTop: !note.alwaysOnTop });
    await setAlwaysOnTop(!note.alwaysOnTop);
  };
  const newNote = async () => {
    const n = await createNote({ color: note.color });
    await openNoteWindow(n.id);
  };
  const removeNote = async () => {
    await deleteNote(id);
    await closeThisWindow();
  };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden rounded-xl shadow-lg"
      style={{ background: s.bg, color: s.fg }}
      data-color={note.color}
    >
      {/* Toolbar / drag handle */}
      <div
        data-tauri-drag-region
        className="drag-region group flex items-center gap-0.5 px-1.5 py-1"
        style={{ background: s.accent + "55" }}
      >
        <ToolButton title="Pin to desktop" active={note.pinned} onClick={togglePin}>
          <PinIcon />
        </ToolButton>
        <ToolButton title="Always on top" active={note.alwaysOnTop} onClick={toggleTop}>
          <TopIcon />
        </ToolButton>
        <ToolButton title="Color" active={showColors} onClick={() => setShowColors((v) => !v)}>
          <PaletteIcon />
        </ToolButton>

        <div className="flex-1" />

        <ToolButton title="New note" onClick={newNote}>
          <PlusIcon />
        </ToolButton>
        <ToolButton title="Open board" onClick={() => void openBoard()}>
          <BoardIcon />
        </ToolButton>
        <ToolButton title="Delete note" onClick={removeNote}>
          <TrashIcon />
        </ToolButton>
        <ToolButton title="Close" onClick={() => void closeThisWindow()}>
          <CloseIcon />
        </ToolButton>
      </div>

      {showColors && (
        <div className="px-1.5 pb-1">
          <ColorPicker
            value={note.color}
            theme={theme}
            onPick={(c: NoteColor) => {
              void patchNote(id, { color: c });
              setShowColors(false);
            }}
          />
        </div>
      )}

      <NoteEditor
        content={note.content}
        fg={s.fg}
        onChange={(content) => void patchNote(id, { content })}
      />
    </div>
  );
}

function ToolButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`no-drag flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition group-hover:opacity-70 hover:!opacity-100 hover:bg-black/10 ${
        active ? "!opacity-100 bg-black/15" : ""
      }`}
    >
      {children}
    </button>
  );
}
