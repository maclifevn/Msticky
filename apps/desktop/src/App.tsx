import { thisWindowLabel, noteIdFromLabel } from "./lib/native";
import { NoteWindow } from "./windows/NoteWindow";
import { BoardWindow } from "./windows/BoardWindow";

/**
 * Each Tauri window runs its own copy of this app. We pick the view from the
 * window label: `note-<id>` renders that note, anything else is the board.
 */
export function App() {
  const label = thisWindowLabel();
  const noteId = noteIdFromLabel(label);
  return noteId ? <NoteWindow id={noteId} /> : <BoardWindow />;
}
