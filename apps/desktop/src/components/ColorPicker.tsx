import { NOTE_COLORS, type NoteColor } from "@msticky/shared";
import { PALETTE } from "../lib/colors";
import type { Theme } from "../lib/theme";

interface Props {
  value: NoteColor;
  theme: Theme;
  onPick: (c: NoteColor) => void;
}

/** A compact row of paper swatches. */
export function ColorPicker({ value, theme, onPick }: Props) {
  return (
    <div className="no-drag flex items-center gap-1 rounded-full bg-black/15 px-1.5 py-1 backdrop-blur-sm">
      {NOTE_COLORS.map((c) => {
        const s = PALETTE[c][theme];
        const active = c === value;
        return (
          <button
            key={c}
            title={c}
            onClick={() => onPick(c)}
            className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
              active ? "ring-2 ring-current ring-offset-0" : "border-black/20"
            }`}
            style={{ background: s.bg, borderColor: s.accent }}
          />
        );
      })}
    </div>
  );
}
