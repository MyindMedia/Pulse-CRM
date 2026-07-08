"use client";

import { useClerk, useUser } from "@clerk/nextjs";

/* Demo mode (no publishable key) boots without <ClerkProvider>, and Clerk
   hooks throw when called outside it - which used to crash the whole app
   shell (Sidebar/ProfileMenu) in demo deployments. CLERK_ENABLED is a
   build-time constant, so the conditional hook calls below never change
   order across renders; the targeted rules-of-hooks disables are safe. */
const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

/** Clerk's user when Clerk is configured; { user: null } in demo mode. */
export function useOptionalUser(): { user: ReturnType<typeof useUser>["user"] } {
  if (!CLERK_ENABLED) return { user: null };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user } = useUser();
  return { user };
}

/** Clerk's signOut when configured; null in demo mode (hide the control). */
export function useOptionalSignOut(): ReturnType<typeof useClerk>["signOut"] | null {
  if (!CLERK_ENABLED) return null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { signOut } = useClerk();
  return signOut;
}
