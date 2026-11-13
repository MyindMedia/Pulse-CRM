"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useOptionalUser } from "@/lib/use-optional-clerk";
import { uploads } from "@/lib/upload-manager";

/* Tells the session upload store who is signed in and in which studio
   (R3-07). Uploads outlive the panel that started them, so a file queued by
   one person must not upload after they sign out, another person signs in, or
   the studio changes; the store cancels those (src/lib/upload-manager.ts).

   Mounted in the app shell OUTSIDE AuthGate, so it still sees the sign-out
   that makes AuthGate unmount the rest of the shell. Nothing is reported while
   either answer is loading. Demo mode has no Clerk user at all: that is the
   stable value null, not a change. A studio id of null while the user id is
   unchanged (the session refreshing) is ignored by the store (R4-07). Renders
   nothing. */
export function UploadIdentitySync() {
  // undefined while Clerk loads, null when signed out (and always in demo mode).
  const { user } = useOptionalUser();
  // undefined while loading, null when there is no studio for this caller.
  const org = useQuery(api.orgs.current);
  const userId = user === undefined ? undefined : (user?.id ?? null);
  const orgId = org === undefined ? undefined : (org?.orgId ?? null);

  useEffect(() => {
    if (userId === undefined || orgId === undefined) return;
    uploads.setIdentity({ userId, orgId });
  }, [userId, orgId]);

  return null;
}
