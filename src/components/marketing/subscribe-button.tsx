"use client";

import * as React from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { BillingInterval, TierKey } from "@convex/lib/plans";
import { needsOptIn } from "@convex/lib/signupLeads";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";

/** Pay-first subscribe: asks for an email and studio name, saves them as a
 *  Signup Lead, then launches Stripe Checkout with the email filled in (no
 *  account needed yet). The Clerk login is created afterward on
 *  /welcome/activate. Someone who stops at checkout can be reminded, under
 *  the consent shown here (convex/signupLeads.ts). */
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
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [studioName, setStudioName] = React.useState("");
  const [optedIn, setOptedIn] = React.useState(false);
  // undefined = still asking; null = Netlify could not say.
  const [country, setCountry] = React.useState<string | null | undefined>(undefined);
  const id = React.useId();

  React.useEffect(() => {
    if (!open || country !== undefined) return;
    let live = true;
    fetch("/api/geo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { country: null }))
      .then((d: { country?: string | null }) => live && setCountry(d.country ?? null))
      .catch(() => live && setCountry(null));
    return () => {
      live = false;
    };
  }, [open, country]);

  // Until the country is known, ask: the box is the safe default.
  const askConsent = country === undefined || needsOptIn(country);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { checkoutUrl } = await begin({
        tier,
        interval,
        email: email.trim(),
        studioName: studioName.trim(),
        optedIn: askConsent ? optedIn : false,
        country: country ?? undefined,
      });
      if (checkoutUrl) window.location.href = checkoutUrl;
      else throw new Error("Could not start checkout.");
    } catch (err) {
      toast.error(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "w-full rounded-chrome px-5 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-60",
          featured
            ? "bg-gold text-gold-ink hover:-translate-y-0.5 hover:bg-gold-bright"
            : "chrome-ghost chrome-ghost-gold text-gold hover:text-gold-bright",
          className,
        )}
      >
        {label}
      </button>

      <Dialog open={open} onOpenChange={(o) => !loading && setOpen(o)}>
        <DialogContent size="sm">
          <form onSubmit={go}>
            <DialogHeader>
              <DialogTitle>Start your free trial</DialogTitle>
              <DialogDescription>
                Card required at the next step. Cancel within the trial and you pay nothing.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <Field label="Email" htmlFor={`${id}-email`}>
                <Input
                  id={`${id}-email`}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourstudio.com"
                />
              </Field>
              <Field label="Studio or group name" htmlFor={`${id}-studio`}>
                <Input
                  id={`${id}-studio`}
                  autoComplete="organization"
                  required
                  maxLength={120}
                  value={studioName}
                  onChange={(e) => setStudioName(e.target.value)}
                  placeholder="Blue Room Studios"
                />
              </Field>
              {askConsent ? (
                <label className="flex items-start gap-2.5 font-grotesk text-xs leading-relaxed text-mist">
                  <input
                    type="checkbox"
                    checked={optedIn}
                    onChange={(e) => setOptedIn(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-gold,#fdb913)]"
                  />
                  <span>
                    Email me up to three reminders if I don&apos;t finish setting up. Unsubscribe anytime.{" "}
                    <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy</Link>
                  </span>
                </label>
              ) : (
                <p className="font-grotesk text-xs leading-relaxed text-steel">
                  We&apos;ll send a few reminders to finish setup. Unsubscribe anytime.{" "}
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-gold">Privacy</Link>
                </p>
              )}
            </DialogBody>
            <DialogFooter>
              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="w-full min-h-11 rounded-chrome bg-gold px-5 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-colors hover:bg-gold-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-60"
              >
                {loading ? "Starting checkout" : "Continue to checkout"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
