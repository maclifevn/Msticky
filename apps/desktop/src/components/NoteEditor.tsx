import { useEffect, useRef, useState } from "react";
import { renderMarkdown, toggleTaskLine } from "../lib/markdown";

interface Props {
  content: string;
  fg: string;
  /** Called (debounced) as the user types, and immediately on checkbox toggle. */
  onChange: (next: string) => void;
}

const SAVE_DEBOUNCE_MS = 300;

/**
 * Dual-mode note body: a rendered markdown view that flips to a raw textarea on
 * click. Task-list checkboxes stay clickable in the view and toggle the source.
 */
export function NoteEditor({ content, fg, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | undefined>(undefined);

  // Keep the draft in step with external (remote/sync) changes while not typing.
  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const scheduleSave = (next: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(next), SAVE_DEBOUNCE_MS);
  };

  const enterEdit = () => {
    setDraft(content);
    setEditing(true);
    // focus after the textarea mounts
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const commitNow = () => {
    window.clearTimeout(timer.current);
    setEditing(false);
    if (draft !== content) onChange(draft);
  };

  const onViewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" && target.getAttribute("type") === "checkbox") {
      const line = Number(target.getAttribute("data-line"));
      if (!Number.isNaN(line)) {
        e.preventDefault();
        onChange(toggleTaskLine(content, line));
      }
      return;
    }
    if (target.tagName === "A") return; // let links open
    enterEdit();
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        className="no-drag h-full w-full flex-1 resize-none bg-transparent px-3 py-2 text-[13px] leading-snug outline-none"
        style={{ color: fg }}
        value={draft}
        placeholder="Write something…  ( - [ ] for a checklist )"
        onChange={(e) => {
          setDraft(e.target.value);
          scheduleSave(e.target.value);
        }}
        onBlur={commitNow}
        onKeyDown={(e) => {
          if (e.key === "Escape") commitNow();
        }}
      />
    );
  }

  return (
    <div
      className="no-drag note-md h-full flex-1 overflow-auto px-3 py-2 text-[13px] leading-snug"
      style={{ color: fg }}
      onClick={onViewClick}
    >
      {content.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
      ) : (
        <span className="opacity-40">Write something…</span>
      )}
    </div>
  );
}
