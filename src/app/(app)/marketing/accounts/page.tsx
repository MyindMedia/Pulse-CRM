"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PLAN_LIMITS, priceLabel, type TierKey } from "@convex/lib/plans";
import { Section } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/lib/use-capabilities";
import { ConnectButton } from "@/components/social/connect-button";
import { AccountRow, type Account } from "@/components/social/account-row";
import { PLATFORM_ORDER } from "@/components/social/platforms";

/** The tier the "at limit" message points a studio at - the cheapest tier
 *  above the cap this screen ever shows (studio is the only capped tier
 *  today; pro and everything above it are unlimited). */
const UPGRADE_TIER: TierKey = "pro";

/** Rows needing attention read first - a broken token is the one thing on
 *  this screen that is actively costing the studio posts, so it should never
 *  be scrolled past. Array.prototype.sort is stable, so accounts within each
 *  group keep the order `list` returned them in. */
function sortAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort((a, b) => {
    const aBroken = a.status === "needs_reconnect" ? 0 : 1;
    const bBroken = b.status === "needs_reconnect" ? 0 : 1;
    return aBroken - bBroken;
  });
}

export default function AccountsPage() {
  const accounts = useQuery(api.marketing.accounts.list, {});
  const limitStatus = useQuery(api.marketing.accounts.limitStatus, {});
  const remove = useMutation(api.marketing.accounts.remove);
  const { can, loaded } = useCapabilities();
  // Connect, Remove and Reconnect all require marketing.approve on the
  // server (owner, manager, and agency owner/admin) - marketing.read holders
  // can see this page but not act on it. Hidden rather than disabled,
  // matching the rooms.edit / patch.edit precedent (src/app/(app)/studio/page.tsx,
  // src/app/(app)/patch/page.tsx) rather than a new disabled-button style.
  const canApprove = can("marketing.approve");
  const sorted = React.useMemo(() => (accounts ? sortAccounts(accounts) : accounts), [accounts]);
  const atLimit = limitStatus !== undefined && limitStatus.cap !== null && limitStatus.used >= limitStatus.cap;

  async function handleRemove(id: Id<"socialAccounts">) {
    try {
      await remove({ id });
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove that account. Try again."));
    }
  }

  return (
    <div className="space-y-8">
      <Section
        title="Connected accounts"
        trailing={limitStatus && <AccountLimitBadge used={limitStatus.used} cap={limitStatus.cap} />}
      >
        <p className="text-sm text-steel">
          Your studio’s own profiles. Pulse posts to these on your schedule.
        </p>
        {sorted === undefined ? null : sorted.length === 0 ? (
          <EmptyState
            title="Nothing connected yet"
            description="Connect Instagram or Facebook first. Google Business Profile gets you the Book button and coupon offers."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((a) => (
              <AccountRow
                key={a._id}
                account={a}
                canManage={canApprove}
                onRemove={() => handleRemove(a._id)}
              />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Add an account">
        {canApprove ? (
          atLimit ? (
            <div className="rounded-xl border border-caution/30 bg-caution/10 px-4 py-3.5">
              <p className="text-sm text-bone">
                You’ve used all {limitStatus?.cap} connected-account slots on the {limitStatus?.tierLabel} plan.
              </p>
              <p className="mt-1 text-xs text-steel">
                Remove one to free a slot, or upgrade for unlimited connected accounts.
              </p>
              <Button asChild size="sm" className="mt-3">
                <a href="/settings">
                  Upgrade to {PLAN_LIMITS[UPGRADE_TIER].label} · {priceLabel(UPGRADE_TIER)}/mo
                </a>
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {PLATFORM_ORDER.map((p) => (
                <ConnectButton key={p} platform={p} />
              ))}
            </div>
          )
        ) : (
          loaded && (
            <p className="text-sm text-steel">
              Ask a studio owner or manager to connect accounts.
            </p>
          )
        )}
      </Section>
    </div>
  );
}

/** "2 of 3 connected" plus a small segmented meter when the plan caps
 *  connected accounts; a plain count when it does not (pro and above).
 *  Buffer shows a progress bar for this - a short segmented track fits this
 *  product's existing step-marker language (see DeleteSubaccount) better
 *  than a literal percentage bar for a number this small. */
function AccountLimitBadge({ used, cap }: { used: number; cap: number | null }) {
  if (cap === null) {
    return <span className="text-xs text-steel/70">{used} connected</span>;
  }
  const atOrOverCap = used >= cap;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {Array.from({ length: cap }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-4 rounded-full",
              i < used ? (atOrOverCap ? "bg-critical" : "bg-gold") : "bg-graphite/50",
            )}
          />
        ))}
      </div>
      <span className={cn("text-xs", atOrOverCap ? "text-critical" : "text-steel/70")}>
        {used} of {cap} connected
      </span>
    </div>
  );
}
