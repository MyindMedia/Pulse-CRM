"use client";
import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { BRAND_THEME_KEYS, brandGuardFor, deriveBrandTheme } from "@/lib/brand-theme";
import { useUiStyleRoot } from "@/lib/ui-style";

/* Rethemes the authenticated app to the ACTIVE org's brand (agency view-as
   included - orgs.current resolves the acting studio) by overriding the gold
   design tokens, the hardware UI's --pl-yellow family and the room light's
   glow colors on <html>. Every plan gets this (decision 2026-10-14); the Max
   white-label theme (WhiteLabelTheme) is a separate layer on top.
   Root-level matters: Radix dialogs, dropdowns, the command palette and
   toasts render in portals at document.body, OUTSIDE any wrapper element - a
   wrapper-scoped theme left every overlay stock gold. Tokens are cleaned up
   on unmount so the public pages (/book, /visit, /kiosk), which carry their
   own brand wrappers, are never contaminated. A studio with no brand set
   writes nothing, so it renders exactly like stock Pulse. */
export function OrgTheme({ children }: { children: React.ReactNode }) {
  const org = useQuery(api.orgs.current);
  const accent = org?.accentColor ?? null;
  const secondary = org?.brandSecondary ?? null;
  // Pulse Hardware (default) or iOS Glass: a root attribute glass.css keys on.
  useUiStyleRoot(org?.uiStyle, org !== undefined);
  // A Max white-label theme driven by these brand colors may be light; the
  // accent is then guarded against its surface instead of the dark face.
  // Same guard WhiteLabelTheme uses, so the two layers write equal values.
  const wl = useQuery(api.theme.get);
  const guard = brandGuardFor(wl);
  // Nothing is written or cleared while either answer is still loading, so
  // the cached first-paint theme (src/lib/boot-cache.ts) holds until the
  // live one is known instead of flashing stock gold in between.
  const ready = org !== undefined && wl !== undefined;

  React.useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const theme = deriveBrandTheme(accent, secondary, guard);
    for (const key of BRAND_THEME_KEYS) {
      const value = theme?.tokens[key];
      if (value) root.style.setProperty(key, value);
      else root.style.removeProperty(key);
    }
    // Switches the room light's tiles from baked stock SVGs to brand-tinted
    // masks (hardware.css). Unset for the stock look.
    if (theme) root.dataset.brandTheme = "on";
    else delete root.dataset.brandTheme;
    return () => {
      for (const key of BRAND_THEME_KEYS) root.style.removeProperty(key);
      delete root.dataset.brandTheme;
    };
  }, [ready, accent, secondary, guard]);

  return <>{children}</>;
}
