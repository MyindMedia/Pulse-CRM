"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Re-issues + re-sends the branded invite for a sub-account whose owner
 *  has not accepted yet. */
export function ResendInviteButton({ orgId }: { orgId: string }) {
  const resend = useAction(api.invites.resend);
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await resend({ orgId });
          toast.success(r.inviteSent ? "Invite re-sent." : "Invite re-issued (email simulated).");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not resend.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Sending..." : "Resend invite"}
    </Button>
  );
}
