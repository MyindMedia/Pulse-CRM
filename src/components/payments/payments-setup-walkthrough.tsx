"use client";

import * as React from "react";
import { useQuery, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CreditCard, CheckCircle2, Circle, Loader2, ArrowUpRight, Landmark, ShieldCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Clear, guided Stripe setup so a studio can start collecting money ASAP.
 * Three numbered steps with live status; collapses to a slim "live" confirmation
 * once charges are enabled. Reads/acts via stripeConnect.
 */
export function PaymentsSetupWalkthrough() {
  const status = useQuery(api.stripeConnect.status, {});
  const createAccountLink = useAction(api.stripeConnect.createAccountLink);
  const refreshStatus = useAction(api.stripeConnect.refreshStatus);
  const [busy, setBusy] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  // Returning from Stripe → pull the latest account state.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("stripe") === "return" || p.get("stripe") === "refresh") {
      void refreshStatus({}).catch(() => undefined);
    }
  }, [refreshStatus]);

  if (status === undefined) return <div className="skeleton h-28 w-full rounded-xl" />;

  const connected = Boolean(status.connected);
  const live = connected && Boolean(status.chargesEnabled);
  const pending = connected && !status.chargesEnabled;

  async function connect() {
    setBusy(true);
    try {
      const { url } = await createAccountLink({});
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not start Stripe setup.");
      setBusy(false);
    }
  }
  async function refresh() {
    setRefreshing(true);
    try {
      const r = await refreshStatus({});
      toast.success(r.chargesEnabled ? "You're live - payments are on." : "Still verifying with Stripe.");
    } catch {
      toast.error("Could not refresh status.");
    } finally {
      setRefreshing(false);
    }
  }

  // Live → slim confirmation.
  if (live) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-positive/30 bg-positive/[0.06] px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-positive/15 text-positive"><CheckCircle2 className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-bone">Payments are live</p>
          <p className="truncate text-xs text-ash">Deposits, balances and invoice pay links deposit straight to your bank.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </Button>
      </div>
    );
  }

  const steps = [
    { n: 1, title: "Connect your Stripe account", desc: "Sign in or create one - takes about 3 minutes.", done: connected, active: !connected },
    { n: 2, title: "Verify your details", desc: "Stripe collects your bank + ID to enable payouts.", done: live, active: pending },
    { n: 3, title: "Start collecting", desc: "Booking deposits, balances, and invoice links go live automatically.", done: live, active: false },
  ];

  return (
    <div className="rounded-xl border border-gold-dim/40 bg-gold/[0.05] p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold"><CreditCard className="size-5" /></span>
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-bone">
            {pending ? "Finish setting up payments" : "Start collecting money"}
          </p>
          <p className="mt-0.5 text-sm text-ash">
            Connect Stripe to take deposits and get invoices paid online. Money goes straight to your bank - Pulse never holds it.
          </p>
        </div>
      </div>

      <ol className="mt-4 space-y-2.5">
        {steps.map((s) => (
          <li key={s.n} className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">
              {s.done ? (
                <CheckCircle2 className="size-5 text-positive" />
              ) : s.active ? (
                <span className="grid size-5 place-items-center rounded-full bg-gold text-[0.625rem] font-bold text-gold-ink">{s.n}</span>
              ) : (
                <Circle className="size-5 text-ash-dim" />
              )}
            </span>
            <div className={cn("min-w-0", s.done && "opacity-70")}>
              <p className="text-sm font-medium text-bone">{s.title}</p>
              <p className="text-xs text-ash-dim">{s.desc}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={connect} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className="size-4" />}
          {pending ? "Finish Stripe setup" : "Connect Stripe"}
        </Button>
        {pending && (
          <Button variant="secondary" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Check status
          </Button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.625rem] text-ash-dim">
        <span className="inline-flex items-center gap-1"><Landmark className="size-3" /> paid out to your bank</span>
        <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3" /> secured by Stripe</span>
      </div>
    </div>
  );
}
