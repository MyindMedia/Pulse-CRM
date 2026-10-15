"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { buildThemeVars, hardwareRadiusVars, isDark } from "@/lib/theme-ramp";
import { ensureFontStylesheet, themeFontVars } from "@/lib/theme-fonts";
import { BRAND_OWNED_THEME_VARS, brandGoldFor, brandGuardFor } from "@/lib/brand-theme";
import { RADIUS_PX } from "@convex/lib/themeSpec";

/**
 * Paints a studio's theme onto its client-facing pages.
 *
 * These are the surfaces that most need to look like the studio: a booking
 * page, a portal link, a review form. The client never signs in, so the org is
 * resolved from the slug or the grant token in the URL.
 *
 * Renders nothing, and falls back to Pulse chrome for any studio below the
 * white-label tier.
 */
export function PublicTheme({
  slug,
  token,
}: {
  slug?: string;
  token?: string;
}) {
  const bySlug = useQuery(api.theme.publicBySlug, slug ? { slug } : "skip");
  const byGrant = useQuery(api.theme.publicByGrant, token ? { token } : "skip");
  const theme = bySlug ?? byGrant;

  React.useEffect(() => {
    if (!theme?.active) return;
    const root = document.documentElement;
    const applied: string[] = [];
    const set = (prop: string, value: string) => {
      root.style.setProperty(prop, value);
      applied.push(prop);
    };

    const c = theme.colors;
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

    const r = RADIUS_PX[theme.radius as keyof typeof RADIUS_PX];
    if (r) {
      set("--radius-chrome", r);
      set("--radius-md", r);
    }
    for (const [prop, value] of Object.entries(hardwareRadiusVars(theme.radius))) set(prop, value);
    // Load the chosen faces, then point the type voices at them.
    ensureFontStylesheet(document, theme.fontHeading);
    ensureFontStylesheet(document, theme.fontBody);
    for (const [prop, value] of Object.entries(themeFontVars(theme.fontHeading, theme.fontBody))) {
      set(prop, value);
    }
    root.dataset.themeMode = isDark(c.background) ? "dark" : "light";
    root.dataset.whitelabel = "true";

    return () => {
      for (const prop of applied) root.style.removeProperty(prop);
      delete root.dataset.whitelabel;
      delete root.dataset.themeMode;
    };
  }, [theme]);

  return null;
}
