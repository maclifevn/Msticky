import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "msticky.theme";

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === "light" || saved === "dark" ? saved : systemTheme();
}

/**
 * Theme is a per-machine preference (not synced), persisted in localStorage and
 * mirrored to other windows via the `storage` event.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = (t: Theme) => {
    localStorage.setItem(KEY, t);
    setThemeState(t);
  };

  return [theme, setTheme];
}
