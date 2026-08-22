"use client";

import * as React from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

/* In-page card capture.

   The saved-card path and off-session charging already shipped; this is the
   form that puts a card on file in one step instead of sending an invoice and
   waiting.

   Two things this file is careful about:

   1. Elements must be mounted against the SAME connected account the
      SetupIntent was created on. The server returns that account id with the
      client secret so the client cannot pair them wrongly.
   2. No card data touches our code or our servers. The PaymentElement is an
      iframe served by Stripe; we only ever see the resulting token. That is
      the whole reason to use Elements rather than our own inputs. */

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// One Stripe instance per connected account, cached: loadStripe injects a
// script tag, and calling it on every render leaks them.
const cache = new Map<string, Promise<Stripe | null>>();
function stripeFor(accountId: string): Promise<Stripe | null> {
  if (!PUBLISHABLE_KEY) return Promise.resolve(null);
  let p = cache.get(accountId);
  if (!p) {
    p = loadStripe(PUBLISHABLE_KEY, { stripeAccount: accountId });
    cache.set(accountId, p);
  }
  return p;
}

type Intent = { clientSecret: string; stripeAccountId: string };

export function CardCapture({
  artistId,
  onSaved,
  returnUrl,
}: {
  artistId: Id<"artists">;
  onSaved?: () => void;
  returnUrl?: string;
}) {
  const createSetupIntent = useAction(api.cardOnFile.createSetupIntent);
  const [intent, setIntent] = React.useState<Intent | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  async function begin() {
    setStarting(true);
    setError(null);
    try {
      const res = await createSetupIntent({ artistId });
      if (!res.clientSecret) throw new Error("Stripe did not return a setup secret.");
      setIntent({ clientSecret: res.clientSecret, stripeAccountId: res.stripeAccountId });
    } catch (e) {
      const d = (e as { data?: string | { message?: string } })?.data;
      setError(
        typeof d === "string"
          ? d
          : d?.message ?? (e instanceof Error ? e.message : "Could not start card setup."),
      );
    } finally {
      setStarting(false);
    }
  }

  if (!PUBLISHABLE_KEY) {
    return (
      <p className="rounded-md border border-graphite/50 bg-coal/40 px-3 py-2.5 text-xs text-steel">
        Card capture needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY set. Until then, the studio can
        still hold a card by sending a deposit invoice.
      </p>
    );
  }

  if (!intent) {
    return (
      <div className="space-y-2">
        <Button onClick={begin} disabled={starting} size="sm">
          <CreditCard className="mr-1.5 size-3.5" />
          {starting ? "Starting…" : "Add a card"}
        </Button>
        {error && (
          <p className="text-xs text-critical" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <Elements
      stripe={stripeFor(intent.stripeAccountId)}
      options={{
        clientSecret: intent.clientSecret,
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "#FDB913",
            colorBackground: "#1C1A17",
            colorText: "#F2EFE9",
            borderRadius: "8px",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        },
      }}
    >
      <CardForm onSaved={onSaved} returnUrl={returnUrl} />
    </Elements>
  );
}

function CardForm({ onSaved, returnUrl }: { onSaved?: () => void; returnUrl?: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setMessage(null);

    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url:
          returnUrl ??
          (typeof window !== "undefined" ? window.location.href : "https://studiopulse.tech"),
      },
      // Stay on the page unless the card genuinely needs a redirect for 3DS.
      redirect: "if_required",
    });

    if (error) {
      // Stripe's own message is the useful one: it says what is wrong with the
      // card. Ours would only be vaguer.
      setMessage(error.message ?? "That card could not be saved.");
      setSaving(false);
      return;
    }

    toast.success("Card saved. No-show and late-cancel fees can be charged to it.");
    setSaving(false);
    onSaved?.();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement options={{ layout: "tabs" }} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!stripe || saving} size="sm">
          {saving ? "Saving…" : "Save card"}
        </Button>
        <span className="flex items-center gap-1.5 text-[0.7rem] text-steel/70">
          <ShieldCheck className="size-3.5" />
          Handled by Stripe. The card never touches this studio&apos;s systems.
        </span>
      </div>
      {message && (
        <p className="text-xs text-critical" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}
