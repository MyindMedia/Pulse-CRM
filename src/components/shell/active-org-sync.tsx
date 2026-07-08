"use client";

import * as React from "react";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";

/**
 * Clerk only stamps the org claim on the session token once an organization is
 * ACTIVE, and nothing activates one automatically after a plain sign-in - so a
 * freshly-invited member's first session had no org claim and every org-scoped
 * query denied (blank app after login). When the signed-in user has org
 * memberships but no active org, activate the first one. resolveViewer also
 * has a server-side fallback for the single-studio case; this keeps the Clerk
 * session itself correct (org roles, middleware auth().orgId, multi-org).
 * Renders nothing. Clerk-only, mirroring MemberSync's gating.
 */
const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function ActiveOrgSync() {
  if (!CLERK_ENABLED) return null;
  return <ActiveOrgSyncInner />;
}

function ActiveOrgSyncInner() {
  const { isLoaded, isSignedIn, orgId } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const busy = React.useRef(false);

  React.useEffect(() => {
    if (!isLoaded || !isSignedIn || orgId || busy.current) return;
    const membership = user?.organizationMemberships?.[0];
    if (!membership) return;
    busy.current = true;
    void clerk
      .setActive({ organization: membership.organization.id })
      .catch(() => {
        // Non-fatal: the server-side resolveViewer fallback still covers the
        // single-studio case; allow a retry on the next render.
        busy.current = false;
      });
  }, [isLoaded, isSignedIn, orgId, user, clerk]);

  return null;
}
