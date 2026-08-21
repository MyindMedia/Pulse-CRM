"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { buildThemeVars, isDark } from "@/lib/theme-ramp";
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

    const r = RADIUS_PX[theme.radius as keyof typeof RADIUS_PX];
    if (r) {
      set("--radius-chrome", r);
      set("--radius-md", r);
    }
    if (theme.fontHeading) {
      set("--font-grotesk", `"${theme.fontHeading}", ui-sans-serif, sans-serif`);
      set("--font-chrome", `"${theme.fontHeading}", ui-sans-serif, sans-serif`);
    }
    if (theme.fontBody) {
      set("--font-inter", `"${theme.fontBody}", ui-sans-serif, sans-serif`);
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
