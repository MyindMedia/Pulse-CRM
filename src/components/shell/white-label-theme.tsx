"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { buildThemeVars, isDark } from "@/lib/theme-ramp";

/**
 * Paints the workspace's white-label theme onto the document root.
 *
 * The earlier version wrote --brand-* variables that no stylesheet read, so a
 * studio could pick a palette and watch nothing happen. This writes the tokens
 * the app is actually styled against: the surface ladder, the hairlines, the
 * four weights of text, the accent family and the brand-tinted shadows. Change
 * the background here and the nav, the cards and the page all move with it.
 *
 * The values arrive validated server-side (hex or an enum, checked against an
 * allowlist), and theme.get hands back Pulse's own palette for any tier below
 * Label. This component only ever applies; it never decides what is allowed.
 */
export function WhiteLabelTheme() {
  const theme = useQuery(api.theme.get);

  React.useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const applied: string[] = [];

    const set = (prop: string, value: string) => {
      root.style.setProperty(prop, value);
      applied.push(prop);
    };

    if (theme.active) {
      const c = theme.colors;
      // One ramp derived from what they picked, rather than eleven pickers
      // and a mess.
      for (const [prop, value] of Object.entries(
        buildThemeVars({
          background: c.background,
          surface: c.surface,
          text: c.text,
          primary: c.primary,
          accent: c.accent,
          muted: c.muted,
          border: c.border,
        }),
      )) {
        set(prop, value);
      }

      // Shape and density, which are as much a part of a brand as its colour.
      if (theme.cssVars?.["--radius"]) {
        const r = theme.cssVars["--radius"];
        set("--radius-chrome", r);
        set("--radius-md", r);
      }

      // Tells the rest of the CSS which way round this theme is, so anything
      // keyed on light or dark reacts instead of assuming.
      root.dataset.themeMode = isDark(c.background) ? "dark" : "light";
    }

    if (theme.fontHeading) {
      set("--font-grotesk", `"${theme.fontHeading}", ui-sans-serif, sans-serif`);
      set("--font-chrome", `"${theme.fontHeading}", ui-sans-serif, sans-serif`);
    }
    if (theme.fontBody) {
      set("--font-inter", `"${theme.fontBody}", ui-sans-serif, sans-serif`);
    }
    root.dataset.whitelabel = theme.active ? "true" : "false";

    // Clean up on unmount or tier change, so a downgrade reverts the whole
    // interface to Pulse chrome without a reload.
    return () => {
      for (const prop of applied) root.style.removeProperty(prop);
      delete root.dataset.whitelabel;
      delete root.dataset.themeMode;
    };
  }, [theme]);

  return null;
}
