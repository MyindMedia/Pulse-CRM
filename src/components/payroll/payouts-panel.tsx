"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { HandCoins, Check, Ban, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/toggle";
import { money } from "@/lib/format";

/* Engineer payouts.

   The list is deliberately boring: who, how much, and the arithmetic that
   produced it. An engineer who disagrees with a number gets shown the working
   rather than asked to trust it.

   Two separate actions on purpose. Approve says "yes, we owe this"; Mark paid
   says "the money has left". Collapsing them into one button is how studios
   end up paying twice. */

const TONE = {
  queued: "caution",
  approved: "info",
  paid: "positive",
  void: "neutral",
} as const;

export function PayoutsPanel() {
  const data = useQuery(api.payouts.list, {});
  const settings = useQuery(api.payouts.settings);
  const approve = useMutation(api.payouts.approve);
  const markPaid = useMutation(api.payouts.markPaid);
  const voidPayout = useMutation(api.payouts.voidPayout);
  const setSettings = useMutation(api.payouts.setSettings);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const d = (e as { data?: { message?: string } })?.data;
      toast.error(d?.message ?? "That did not go through.");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];
  const totals = data?.totals;

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
              <HandCoins className="size-4" />
            </span>
            <div>
              <p className="font-grotesk text-sm font-semibold text-bone">Engineer payouts</p>
              <p className="text-xs text-steel">
                Queued when a session completes. Nothing pays itself.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2.5 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2">
            <span className="text-xs text-steel">Queue automatically</span>
            <Switch
              checked={settings?.autoPayouts ?? false}
              onCheckedChange={(v) =>
                run("settings", () => setSettings({ autoPayouts: v }), v ? "Payouts will queue on completion." : "Automatic payouts off.")
              }
              disabled={busy === "settings"}
              aria-label="Queue payouts automatically when a session completes"
            />
          </label>
        </div>

        {totals && (
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-graphite/40">
            <Tile label="Queued" cents={totals.queuedCents} />
            <Tile label="Approved" cents={totals.approvedCents} />
            <Tile label="Paid" cents={totals.paidCents} />
          </div>
        )}

        {items.length === 0 ? (
          <p className="rounded-md border border-graphite/50 bg-coal/30 px-3 py-6 text-center text-sm text-steel">
            {settings?.autoPayouts
              ? "No payouts yet. They queue as sessions complete."
              : "Turn on automatic queueing to start tracking what each engineer is owed."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((p) => (
              <li
                key={p._id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-bone">{p.memberName}</span>
                    <Badge tone={TONE[p.status]}>{p.status}</Badge>
                  </span>
                  {/* The working, not just the answer. */}
                  <span className="mt-0.5 block text-xs text-steel/70">{p.explanation}</span>
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-bone">
                  {money(p.amountCents)}
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {p.status === "queued" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === p._id}
                      onClick={() =>
                        run(p._id, () => approve({ id: p._id as Id<"payouts"> }), "Approved.")
                      }
                    >
                      <Check className="mr-1 size-3.5" />
                      Approve
                    </Button>
                  )}
                  {p.status === "approved" && (
                    <Button
                      size="sm"
                      disabled={busy === p._id}
                      onClick={() =>
                        run(p._id, () => markPaid({ id: p._id as Id<"payouts"> }), "Marked paid and posted to the P&L.")
                      }
                    >
                      <Wallet className="mr-1 size-3.5" />
                      Mark paid
                    </Button>
                  )}
                  {(p.status === "queued" || p.status === "approved") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === p._id}
                      onClick={() =>
                        run(
                          p._id,
                          () => voidPayout({ id: p._id as Id<"payouts">, reason: "Voided from payroll" }),
                          "Voided. The row stays on the record.",
                        )
                      }
                      aria-label={`Void the payout for ${p.memberName}`}
                    >
                      <Ban className="size-3.5" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="bg-coal/50 px-3 py-2.5">
      <p className="font-meta text-[0.625rem] uppercase tracking-[0.08em] text-steel/60">{label}</p>
      <p className="mt-0.5 font-mono text-base tabular-nums text-bone">{money(cents)}</p>
    </div>
  );
}
