"use client";

import { Button } from "@/components/ui/button";
import type { Id } from "@convex/_generated/dataModel";
import type { Platform } from "@convex/lib/ghl";
import { PLATFORM_META } from "./platforms";

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

/** One connected account row - platform icon, name, follower count, and a
 *  Remove action. `needs_reconnect` surfaces inline rather than as a badge so
 *  it reads in the same line the owner is already scanning.
 *
 *  `canRemove` gates the Remove button client-side (`marketing.approve` -
 *  owner/manager and agency owner/admin only; `marketing.read` holders get
 *  the row without it). This is presentation only, matching the
 *  `rooms.edit`/`patch.edit` precedent - the mutation re-checks the same
 *  capability on the server regardless. */
export function AccountRow({
  account,
  canRemove,
  onRemove,
}: {
  account: Account;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const meta = PLATFORM_META[account.platform];
  return (
    <li className="flex items-center justify-between rounded-xl border border-graphite/50 bg-coal-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <meta.icon className="size-5 shrink-0 text-steel/70" />
        <div>
          <div className="font-medium text-bone">{account.name}</div>
          <div className="text-xs text-steel/70">
            {meta.label}
            {account.stats?.followers ? ` · ${account.stats.followers.toLocaleString("en-US")} followers` : ""}
            {account.status === "needs_reconnect" ? " · needs reconnect" : ""}
          </div>
        </div>
      </div>
      {canRemove && (
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      )}
    </li>
  );
}
