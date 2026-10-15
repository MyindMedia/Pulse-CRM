"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { wipeBootSnapshots } from "./boot-snapshot";

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

type SignOut = ReturnType<typeof useClerk>["signOut"];

/** Clerk's signOut when configured; null in demo mode (hide the control).
 *  Signing out first wipes the boot cache (the cached dashboard and theme,
 *  src/lib/boot-cache.ts), so the next person on this browser sees none of it. */
export function useOptionalSignOut(): SignOut | null {
  if (!CLERK_ENABLED) return null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { signOut } = useClerk();
  return ((...args: Parameters<SignOut>) => {
    wipeBootSnapshots();
    return signOut(...args);
  }) as SignOut;
}
