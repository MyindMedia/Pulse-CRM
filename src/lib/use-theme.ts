"use client";

import * as React from "react";

export type Theme = "light" | "dark";

/** Read + control the active theme. The actual source of truth is the
    `data-theme` attribute on <html> (set before paint by the inline script in
    the root layout); this hook mirrors it into React state and persists the
    user's manual choice to localStorage. */
export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>("dark");

  React.useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) ?? "dark";
    setThemeState(current === "light" ? "light" : "dark");
  }, []);

  const setTheme = React.useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("pulse-theme", t);
    } catch {
      /* storage unavailable - still applies for this session */
    }
    setThemeState(t);
  }, []);

  const toggle = React.useCallback(() => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    setTheme(next);
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
