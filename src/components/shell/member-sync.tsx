"use client";

import * as React from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Fires once when the user becomes authenticated: links their Clerk account to
 * their pre-created member row (by verified email) and flips their invite to
 * accepted. Idempotent + a no-op for users already linked. Renders nothing.
 */
export function MemberSync() {
  const { isAuthenticated } = useConvexAuth();
  const sync = useMutation(api.members.syncMyClerkLink);
  const ran = React.useRef(false);

  React.useEffect(() => {
    if (isAuthenticated && !ran.current) {
      ran.current = true;
      void sync({}).catch(() => {
        // Non-fatal: markAccepted already links on the normal accept path; this
        // is only the safety net, so a transient failure can be retried later.
        ran.current = false;
      });
    }
  }, [isAuthenticated, sync]);

  return null;
}
