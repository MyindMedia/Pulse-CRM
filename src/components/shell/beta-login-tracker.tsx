"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Records that a beta recipient signed in to the studio they built.
 *
 * Fires once per browser session, and only for a workspace that actually came
 * out of a beta invite. Deliberately best-effort: a failed write costs one
 * data point and must never interrupt anybody's session.
 */
export function BetaLoginTracker() {
  const org = useQuery(api.orgs.current);
  const record = useMutation(api.betaAccess.recordLogin);
  const done = React.useRef<string | null>(null);

  React.useEffect(() => {
    const orgId = org?.orgId;
    if (!orgId || done.current === orgId) return;

    // Once per tab per workspace: the metric is "they came back", not
    // "they navigated".
    const key = `pulse:beta-login:${orgId}`;
    try {
      if (window.sessionStorage.getItem(key)) {
        done.current = orgId;
        return;
      }
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Private mode. Recording twice is better than not at all.
    }
    done.current = orgId;
    void record({ orgId }).catch(() => {});
  }, [org?.orgId, record]);

  return null;
}
