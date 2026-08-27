"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Section } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/errors";
import { useCapabilities } from "@/lib/use-capabilities";
import { ConnectButton } from "@/components/social/connect-button";
import { AccountRow } from "@/components/social/account-row";
import { PLATFORM_ORDER } from "@/components/social/platforms";

export default function AccountsPage() {
  const accounts = useQuery(api.marketing.accounts.list, {});
  const remove = useMutation(api.marketing.accounts.remove);
  const { can, loaded } = useCapabilities();
  // Connect and Remove both require marketing.approve on the server (owner,
  // manager, and agency owner/admin) - marketing.read holders can see this
  // page but not act on it. Hidden rather than disabled, matching the
  // rooms.edit / patch.edit precedent (src/app/(app)/studio/page.tsx,
  // src/app/(app)/patch/page.tsx) rather than a new disabled-button style.
  const canApprove = can("marketing.approve");

  async function handleRemove(id: Id<"socialAccounts">) {
    try {
      await remove({ id });
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove that account. Try again."));
    }
  }

  return (
    <div className="space-y-8">
      <Section title="Connected accounts">
        <p className="text-sm text-steel">
          Your studio’s own profiles. Pulse posts to these on your schedule.
        </p>
        {accounts === undefined ? null : accounts.length === 0 ? (
          <EmptyState
            title="Nothing connected yet"
            description="Connect Instagram or Facebook first. Google Business Profile gets you the Book button and coupon offers."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((a) => (
              <AccountRow
                key={a._id}
                account={a}
                canRemove={canApprove}
                onRemove={() => void handleRemove(a._id)}
              />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Add an account">
        {canApprove ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {PLATFORM_ORDER.map((p) => (
              <ConnectButton key={p} platform={p} />
            ))}
          </div>
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
