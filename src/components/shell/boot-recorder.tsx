"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { captureBootTheme, releaseBootTheme } from "@/lib/boot-cache";
import { useBootSnapshotStore } from "@/lib/boot-snapshot";

/* Renders nothing. Once the live org and theme are known it:
   1. tells the boot cache which studio is live (a record for another studio
      is dropped: org switch),
   2. hands first paint back to the live theme (removes the cached <style>
      rule the (app) layout's inline script added), and
   3. records the theme as it now stands on <html>, for the next cold load.
   Sits inside OrgTheme, after WhiteLabelTheme, so both have painted by the
   frame the capture runs in. */
export function BootRecorder() {
  const store = useBootSnapshotStore();
  const org = useQuery(api.orgs.current);
  const theme = useQuery(api.theme.get);
  const ready = org !== undefined && theme !== undefined;
  const orgId = org?.orgId ?? null;

  React.useEffect(() => {
    if (!ready) return;
    releaseBootTheme(document);
    if (!store || !orgId) return;
    store.setOrg(orgId);
    const frame = requestAnimationFrame(() => store.setTheme(captureBootTheme(document)));
    return () => cancelAnimationFrame(frame);
  }, [ready, store, orgId, org?.accentColor, org?.brandSecondary, org?.uiStyle, theme]);

  return null;
}
