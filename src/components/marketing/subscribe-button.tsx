"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

/** Pay-first subscribe: launches Stripe Checkout (no account needed yet). The
 *  Clerk login is created afterward on /welcome/activate. */
export function SubscribeButton({
  tier,
  label,
  featured,
}: {
  tier: "studio" | "pro" | "growth";
  label: string;
  featured?: boolean;
}) {
  const begin = useAction(api.billing.beginPublicCheckout);
  const [loading, setLoading] = React.useState(false);

  async function go() {
    setLoading(true);
    try {
      const { checkoutUrl } = await begin({ tier });
      if (checkoutUrl) window.location.href = checkoutUrl;
      else throw new Error("Could not start checkout.");
    } catch (e) {
      toast.error(errorMessage(e));
      setLoading(false);
    }
  }

  return (
    <Button
      onClick={go}
      disabled={loading}
      className="w-full"
      variant={featured ? "primary" : "outline"}
    >
      {loading ? "Starting…" : label}
    </Button>
  );
}
