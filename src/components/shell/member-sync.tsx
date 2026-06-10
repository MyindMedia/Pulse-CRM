"use client";

import * as React from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Fires once when the user becomes authenticated: links their Clerk account to
 * their pre-created member row (by verified email) and flips their invite to
 * accepted. Idempotent + a no-op for users already linked. Renders nothing.
 *
 * Clerk-only: in demo mode (no publishable key) the Convex provider has no auth
 * integration, so `useConvexAuth` would throw. Gate the hook behind a child that
 * only mounts when Clerk is configured.
 */
const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function MemberSync() {
  if (!CLERK_ENABLED) return null;
  return <MemberSyncInner />;
}

function MemberSyncInner() {
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
