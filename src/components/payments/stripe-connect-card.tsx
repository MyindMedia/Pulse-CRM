"use client";

import * as React from "react";
import { useQuery, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CreditCard, CheckCircle2, ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmbeddedConnectOnboarding, embeddedConnectAvailable } from "./embedded-connect-onboarding";

/**
 * Stripe Connect onboarding card. The studio connects its OWN Stripe (Express)
 * to collect client deposits directly. Reused in onboarding + settings. On
 * return from Stripe (?stripe=return) it refreshes the live status.
 */
export function StripeConnectCard({ compact = false }: { compact?: boolean }) {
  const status = useQuery(api.stripeConnect.status, {});
  const createAccountLink = useAction(api.stripeConnect.createAccountLink);
  const createDashboardLink = useAction(api.stripeConnect.createDashboardLink);
  const refreshStatus = useAction(api.stripeConnect.refreshStatus);
  const [busy, setBusy] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [embedOpen, setEmbedOpen] = React.useState(false);

  // Coming back from Stripe → pull the latest account state.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("stripe") === "return" || p.get("stripe") === "refresh") {
      void refreshStatus({}).catch(() => undefined);
    }
  }, [refreshStatus]);

  async function connect() {
    // Branded, in-app onboarding when configured; otherwise hosted redirect.
    if (embeddedConnectAvailable) {
      setEmbedOpen(true);
      return;
    }
    setBusy(true);
    try {
      const { url } = await createAccountLink({});
      window.location.href = url;
    } catch (err) {
      toast.error(
        err instanceof ConvexError ? String(err.data) : "Could not start Stripe setup.",
      );
      setBusy(false);
    }
  }

  async function openDashboard() {
    setOpening(true);
    try {
      const { url } = await createDashboardLink({});
      window.open(url, "_blank", "noopener");
    } catch (err) {
      toast.error(
        err instanceof ConvexError ? String(err.data) : "Could not open your Stripe dashboard.",
      );
    } finally {
      setOpening(false);
    }
  }

  const connected = status?.connected && status?.chargesEnabled;
  const pending = status?.connected && !status?.chargesEnabled;

  return (
    <div className="rounded-chrome border border-graphite/50 bg-coal/40 p-5">
      <div className="flex items-start gap-4">
        <span
          className={
            "grid size-10 shrink-0 place-items-center rounded-lg " +
            (connected ? "bg-positive/10 text-positive" : "bg-gold/10 text-gold")
          }
        >
          {connected ? <CheckCircle2 className="size-5" /> : <CreditCard className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-grotesk text-sm font-semibold text-bone">
            {connected ? "Stripe connected" : "Collect deposits with Stripe"}
          </p>
          <p className="mt-0.5 text-sm text-steel">
            {status === undefined
              ? "Checking…"
              : !status.configured
                ? "Payments aren’t enabled on this workspace yet - your admin needs to configure Stripe."
                : connected
                  ? "Your studio collects client deposits directly into your own Stripe account."
                  : pending
                    ? "Almost there - finish your Stripe details to start accepting deposits."
                    : "Connect your Stripe account so clients pay deposits straight to you. Takes ~2 minutes."}
          </p>
          {!compact && connected && (
            <p className="mt-2 text-[0.6875rem] text-steel/70">
              Payouts, refunds, and tax live in your Stripe dashboard.
            </p>
          )}
        </div>
      </div>

      {status?.configured && !connected && (
        <div className="mt-4">
          <Button size="sm" disabled={busy} onClick={connect}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
            {pending ? "Finish Stripe setup" : "Connect Stripe"}
            {!busy && <ArrowUpRight className="size-3.5" />}
          </Button>
        </div>
      )}

      {connected && (
        <div className="mt-4">
          <Button variant="outline" size="sm" disabled={opening} onClick={openDashboard}>
            {opening ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpRight className="size-3.5" />}
            Open Stripe dashboard
          </Button>
        </div>
      )}

      <EmbeddedConnectOnboarding
        open={embedOpen}
        onOpenChange={setEmbedOpen}
        onComplete={() => void refreshStatus({}).catch(() => undefined)}
      />
    </div>
  );
}
