"use client";

import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Section } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/errors";
import { ConnectButton } from "@/components/social/connect-button";
import { AccountRow } from "@/components/social/account-row";
import { PLATFORM_ORDER } from "@/components/social/platforms";

export default function AccountsPage() {
  const accounts = useQuery(api.marketing.accounts.list, {});
  const remove = useMutation(api.marketing.accounts.remove);

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
              <AccountRow key={a._id} account={a} onRemove={() => void handleRemove(a._id)} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Add an account">
        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORM_ORDER.map((p) => (
            <ConnectButton key={p} platform={p} />
          ))}
        </div>
      </Section>
    </div>
  );
}
