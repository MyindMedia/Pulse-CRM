"use client";
import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { deriveBrandTokens } from "@/lib/brand-theme";

const TOKEN_KEYS = [
  "--color-gold",
  "--color-gold-bright",
  "--color-gold-deep",
  "--color-gold-dim",
  "--color-gold-ink",
] as const;

/* Rethemes the authenticated app to the ACTIVE org's brand (agency view-as
   included - orgs.current resolves the acting studio) by overriding the gold
   design-token CSS variables on <html>. Root-level matters: Radix dialogs,
   dropdowns, the command palette and toasts render in portals at
   document.body, OUTSIDE any wrapper element - a wrapper-scoped theme left
   every overlay stock gold. Tokens are cleaned up on unmount so the public
   pages (/book, /visit, /kiosk), which carry their own brand wrappers, are
   never contaminated. */
export function OrgTheme({ children }: { children: React.ReactNode }) {
  const org = useQuery(api.orgs.current);
  const accent = org?.accentColor ?? null;

  React.useEffect(() => {
    const root = document.documentElement;
    const tokens = deriveBrandTokens(accent);
    if (tokens) {
      for (const key of TOKEN_KEYS) root.style.setProperty(key, tokens[key]);
    } else {
      for (const key of TOKEN_KEYS) root.style.removeProperty(key);
    }
    return () => {
      for (const key of TOKEN_KEYS) root.style.removeProperty(key);
    };
  }, [accent]);

  return <>{children}</>;
}
