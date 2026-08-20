"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Attaches a signed-in beta owner to the studio waiting for them.
 *
 * Someone who created their Clerk account outside the invite flow ends up with
 * a workspace whose members row has no clerkUserId. The access engine resolves
 * studio members by clerkUserId, so every query throws and the app shows its
 * error boundary - a person locked out of a studio they just built.
 *
 * This runs once per session on the onboarding route and repairs that link.
 * It only ever fills an EMPTY seat matching the caller's own verified email in
 * a beta workspace, so it cannot take over an account. On success it reloads,
 * because the queries that already failed will not retry on their own.
 */
export function BetaLinkRecovery() {
  const linkMe = useMutation(api.betaAccess.linkMe);
  const tried = React.useRef(false);

  React.useEffect(() => {
    if (tried.current) return;
    tried.current = true;

    const KEY = "pulse:beta-link-tried";
    try {
      if (window.sessionStorage.getItem(KEY)) return;
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      // Private mode. Trying once per mount is still correct.
    }

    void linkMe({})
      .then((res) => {
        if (res.linked) window.location.reload();
      })
      .catch(() => {
        // Nothing waiting, or not signed in yet. Not an error worth showing.
      });
  }, [linkMe]);

  return null;
}
