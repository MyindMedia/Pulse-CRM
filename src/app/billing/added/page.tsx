"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { Button } from "@/components/ui/button";

/* Stripe setup-mode redirect lands here after a studio adds a card. The webhook
   (checkout.session.completed / subaccount_billing) flips the account to active;
   this page just confirms and routes back into the app. */
export default function BillingAddedPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-4">
      <div className="w-full max-w-md rounded-2xl border border-graphite/60 bg-obsidian p-8 text-center shadow-2xl">
        <div className="mb-6 flex justify-center">
          <PulseLogo size="md" asLink={false} />
        </div>
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-positive/30 bg-positive/10 text-positive">
          <CheckCircle2 className="size-6" />
        </span>
        <h1 className="font-grotesk text-xl font-semibold text-bone">You&apos;re all set</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-steel">
          Your payment method is on file and your studio is active. Thanks for being here.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/dashboard">Back to Pulse</Link>
        </Button>
      </div>
    </div>
  );
}
