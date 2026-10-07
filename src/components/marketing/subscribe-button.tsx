"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { BillingInterval, TierKey } from "@convex/lib/plans";
import { cn } from "@/lib/utils";

/** Pay-first subscribe: launches Stripe Checkout (no account needed yet). The
 *  Clerk login is created afterward on /welcome/activate. */
export function SubscribeButton({
  tier,
  interval = "month",
  label,
  featured,
  className,
}: {
  tier: TierKey;
  interval?: BillingInterval;
  label: string;
  featured?: boolean;
  className?: string;
}) {
  const begin = useAction(api.billing.beginPublicCheckout);
  const [loading, setLoading] = React.useState(false);

  async function go() {
    setLoading(true);
    try {
      const { checkoutUrl } = await begin({ tier, interval });
      if (checkoutUrl) window.location.href = checkoutUrl;
      else throw new Error("Could not start checkout.");
    } catch (e) {
      toast.error(errorMessage(e));
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={loading}
      aria-busy={loading}
      className={cn(
        "w-full rounded-chrome px-5 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-60",
        featured
          ? "bg-gold text-gold-ink hover:-translate-y-0.5 hover:bg-gold-bright"
          : "chrome-ghost chrome-ghost-gold text-gold hover:text-gold-bright",
        className,
      )}
    >
      {loading ? "Starting checkout" : label}
    </button>
  );
}
