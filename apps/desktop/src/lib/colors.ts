import type { NoteColor } from "@msticky/shared";

/**
 * Paper palette. Each note color has a light and dark rendering so the same
 * note key looks right under either theme. `bg` is the paper, `fg` the ink,
 * `accent` the toolbar/handle tint.
 */
export interface Swatch {
  bg: string;
  fg: string;
  accent: string;
}

export const PALETTE: Record<NoteColor, { light: Swatch; dark: Swatch }> = {
  yellow: {
    light: { bg: "#fef9c3", fg: "#3f3a16", accent: "#fde047" },
    dark: { bg: "#4d4416", fg: "#fef9c3", accent: "#a3850f" },
  },
  pink: {
    light: { bg: "#fce7f3", fg: "#4a1d34", accent: "#f9a8d4" },
    dark: { bg: "#4a1d34", fg: "#fce7f3", accent: "#be3a7e" },
  },
  blue: {
    light: { bg: "#dbeafe", fg: "#1e2f4d", accent: "#93c5fd" },
    dark: { bg: "#1e2f4d", fg: "#dbeafe", accent: "#3b6fc4" },
  },
  green: {
    light: { bg: "#dcfce7", fg: "#14361f", accent: "#86efac" },
    dark: { bg: "#14361f", fg: "#dcfce7", accent: "#2f9e54" },
  },
  purple: {
    light: { bg: "#ede9fe", fg: "#2e1f4d", accent: "#c4b5fd" },
    dark: { bg: "#2e1f4d", fg: "#ede9fe", accent: "#7c5cd4" },
  },
  orange: {
    light: { bg: "#ffedd5", fg: "#4a2410", accent: "#fdba74" },
    dark: { bg: "#4a2410", fg: "#ffedd5", accent: "#c2641f" },
  },
  gray: {
    light: { bg: "#f1f5f9", fg: "#1e293b", accent: "#cbd5e1" },
    dark: { bg: "#27313f", fg: "#e2e8f0", accent: "#64748b" },
  },
};

export function swatch(color: NoteColor, theme: "light" | "dark"): Swatch {
  return PALETTE[color][theme];
}
