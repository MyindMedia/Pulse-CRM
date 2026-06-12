"use client";
import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { brandStyle } from "@/lib/brand-theme";

/* Rethemes the authenticated app to the active org's brand by overriding
   the gold design-token CSS variables on a display:contents wrapper
   (no layout impact). Falls back to stock Pulse gold when the org has
   no custom accent. */
export function OrgTheme({ children }: { children: React.ReactNode }) {
  const org = useQuery(api.orgs.current);
  return (
    <div className="contents" style={brandStyle(org?.accentColor)}>
      {children}
    </div>
  );
}
