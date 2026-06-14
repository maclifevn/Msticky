import { useEffect, useState } from "react";
import { type Note } from "@msticky/shared";
import { getActiveNotes, getNote } from "./repo";
import { onBulkChanged, onNoteChanged } from "../lib/native";

/** Live view of a single note, refreshing on cross-window change events. */
export function useNote(id: string): Note | undefined {
  const [note, setNote] = useState<Note | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void getNote(id).then((n) => {
        if (alive) setNote(n);
      });
    };
    load();
    const offNote = onNoteChanged((p) => {
      if (p.id === id) load();
    });
    const offBulk = onBulkChanged(load);
    return () => {
      alive = false;
      void offNote.then((f) => f());
      void offBulk.then((f) => f());
    };
  }, [id]);

  return note;
}

/** Live list of notes for the board, with optional archived inclusion. */
export function useNotes(includeArchived: boolean): Note[] {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void getActiveNotes(includeArchived).then((n) => {
        if (alive) setNotes(n);
      });
    };
    load();
    const offNote = onNoteChanged(load);
    const offBulk = onBulkChanged(load);
    return () => {
      alive = false;
      void offNote.then((f) => f());
      void offBulk.then((f) => f());
    };
  }, [includeArchived]);

  return notes;
}
