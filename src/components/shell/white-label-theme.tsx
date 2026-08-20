"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Paints the workspace's white-label theme onto the document root.
 *
 * Values arrive already validated and merged server-side (theme.get returns
 * Pulse's own palette for any tier below Label), so this component never
 * decides what is allowed - it only applies. Anything it writes is a CSS
 * custom property, and every value was checked against a hex or enum
 * allowlist before it was stored.
 */
export function WhiteLabelTheme() {
  const theme = useQuery(api.theme.get);

  React.useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const applied: string[] = [];

    for (const [prop, value] of Object.entries(theme.cssVars ?? {})) {
      if (typeof value !== "string") continue;
      root.style.setProperty(prop, value);
      applied.push(prop);
    }
    if (theme.fontHeading) {
      root.style.setProperty("--font-display", `"${theme.fontHeading}"`);
      applied.push("--font-display");
    }
    if (theme.fontBody) {
      root.style.setProperty("--font-body", `"${theme.fontBody}"`);
      applied.push("--font-body");
    }
    root.dataset.whitelabel = theme.active ? "true" : "false";

    // Clean up on unmount or tier change so a downgrade instantly reverts the
    // shell to Pulse chrome without a reload.
    return () => {
      for (const prop of applied) root.style.removeProperty(prop);
      delete root.dataset.whitelabel;
    };
  }, [theme]);

  return null;
}
