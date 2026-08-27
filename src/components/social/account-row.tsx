"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Id } from "@convex/_generated/dataModel";
import type { Platform } from "@convex/lib/ghl";
import { cn } from "@/lib/utils";
import { PLATFORM_META } from "./platforms";
import { ReconnectAction } from "./reconnect-action";

/** A connected social account, as returned by api.marketing.accounts.list. */
export type Account = {
  _id: Id<"socialAccounts">;
  platform: Platform;
  name: string;
  avatarUrl?: string;
  status: "connected" | "needs_reconnect" | "removed";
  stats?: { followers?: number; reach?: number; refreshedAt: number };
  connectedAt: number;
};

/** One connected account row - platform icon, name, follower count, and
 *  Reconnect/Remove actions.
 *
 *  `needs_reconnect` gets a red `Badge`, a tinted border, and a Reconnect
 *  button so a broken token reads as something to fix, not as quiet
 *  metadata next to the follower count. The page sorts these rows to the
 *  top of the list.
 *
 *  `canManage` gates both Reconnect and Remove client-side (`marketing.approve` -
 *  owner/manager and agency owner/admin only; `marketing.read` holders get
 *  the row without either). This is presentation only, matching the
 *  `rooms.edit`/`patch.edit` precedent - the mutation and the reconnect
 *  action's own capability check both re-run the same check on the server
 *  regardless. */
export function AccountRow({
  account,
  canManage,
  onRemove,
}: {
  account: Account;
  canManage: boolean;
  onRemove: () => Promise<void> | void;
}) {
  const meta = PLATFORM_META[account.platform];
  const needsReconnect = account.status === "needs_reconnect";
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  return (
    <>
      <li
        className={cn(
          "flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
          needsReconnect ? "border-critical/40 bg-critical/5" : "border-graphite/50 bg-coal-2",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <meta.icon className="size-5 shrink-0 text-steel/70" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-medium text-bone">{account.name}</span>
              {needsReconnect && (
                <Badge tone="critical" dot>
                  Needs reconnect
                </Badge>
              )}
            </div>
            <div className="text-xs text-steel/70">
              {meta.label}
              {account.stats?.followers ? ` · ${account.stats.followers.toLocaleString("en-US")} followers` : ""}
            </div>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-2">
            {needsReconnect && <ReconnectAction platform={account.platform} accountName={account.name} />}
            <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
              Remove
            </Button>
          </div>
        )}
      </li>
      {canManage && (
        <RemoveAccountDialog
          account={account}
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={onRemove}
        />
      )}
    </>
  );
}

/** Confirmation dialog for removing a connected social account. Names the
 *  account and says what removing it does (and does not do) before the
 *  destructive mutation fires - clicking Remove used to disconnect the
 *  account instantly with no way back from this screen. */
function RemoveAccountDialog({
  account,
  open,
  onOpenChange,
  onConfirm,
}: {
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}) {
  const meta = PLATFORM_META[account.platform];
  const [submitting, setSubmitting] = React.useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Remove {account.name}?</DialogTitle>
          <DialogDescription>Pulse stops posting to this {meta.label} account right away.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-steel">
            This does not revoke access on {meta.label} itself. You can reconnect the same account
            later, and it will use a connected-account slot again.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={() => void handleConfirm()} disabled={submitting}>
            <Trash2 className="size-4" />
            {submitting ? "Removing…" : `Remove ${account.name}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
