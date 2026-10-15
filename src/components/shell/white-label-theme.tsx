"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { buildThemeVars, hardwareRadiusVars, isDark } from "@/lib/theme-ramp";
import { ensureFontStylesheet, themeFontVars } from "@/lib/theme-fonts";
import { BRAND_OWNED_THEME_VARS, brandGoldFor, brandGuardFor } from "@/lib/brand-theme";

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
      // Brand colors, when the studio set them, own the accent family; the
      // rest of the ramp is the theme's (lib/themePrecedence.ts).
      const ramp = buildThemeVars({
        background: c.background,
        surface: c.surface,
        text: c.text,
        primary: c.primary,
        accent: c.accent,
        muted: c.muted,
        border: c.border,
      });
      if (theme.brandDriven) {
        for (const k of BRAND_OWNED_THEME_VARS) delete ramp[k];
        Object.assign(ramp, brandGoldFor(c.primary, brandGuardFor(theme)));
      }
      for (const [prop, value] of Object.entries(ramp)) {
        set(prop, value);
      }

      // Shape and density, which are as much a part of a brand as its colour.
      if (theme.cssVars?.["--radius"]) {
        const r = theme.cssVars["--radius"];
        set("--radius-chrome", r);
        set("--radius-md", r);
      }
      for (const [prop, value] of Object.entries(hardwareRadiusVars(theme.radius))) set(prop, value);

      // Tells the rest of the CSS which way round this theme is, so anything
      // keyed on light or dark reacts instead of assuming.
      root.dataset.themeMode = isDark(c.background) ? "dark" : "light";
    } else {
      // Clears a first-paint guess the boot cache may have left.
      delete root.dataset.themeMode;
    }

    // Load the chosen faces, then point the type voices at them.
    ensureFontStylesheet(document, theme.fontHeading);
    ensureFontStylesheet(document, theme.fontBody);
    for (const [prop, value] of Object.entries(themeFontVars(theme.fontHeading, theme.fontBody))) {
      set(prop, value);
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
