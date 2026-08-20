"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Trash2, AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Deleting a sub-account.

   Three steps, and each one asks for something different: read what dies,
   retype the name, type the word. The friction is the feature - this destroys
   a real business's records and there is no undo.

   The server enforces all three independently. Nothing here is the guard; it
   is the explanation. */

type Step = 0 | 1 | 2 | 3;

export function DeleteSubaccount({ orgId }: { orgId: string }) {
  const impact = useQuery(api.subaccountDeletion.impact, { orgId });
  const request = useMutation(api.subaccountDeletion.requestDeletion);
  const cancel = useMutation(api.subaccountDeletion.cancelDeletion);
  const confirm = useMutation(api.subaccountDeletion.confirmDeletion);
  const router = useRouter();

  const [step, setStep] = React.useState<Step>(0);
  const [token, setToken] = React.useState<string | null>(null);
  const [typedName, setTypedName] = React.useState("");
  const [typedPhrase, setTypedPhrase] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (impact === undefined) return null;
  if (impact === null) return null;

  const nameOk = typedName === impact.name;
  const phraseOk = typedPhrase.trim().toUpperCase() === impact.confirmPhrase;

  async function reset() {
    setStep(0);
    setToken(null);
    setTypedName("");
    setTypedPhrase("");
    try {
      await cancel({ orgId });
    } catch {
      // Nothing pending. Fine.
    }
  }

  async function beginConfirmation() {
    setBusy(true);
    try {
      const res = await request({ orgId });
      setToken(res.token);
      setStep(2);
    } catch (e) {
      const d = (e as { data?: { message?: string } })?.data;
      toast.error(d?.message ?? "Could not start that.");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await confirm({ orgId, token, typedName, typedPhrase });
      toast.success(`${res.name} deleted. ${res.deletedRows} records removed.`);
      router.push("/agency");
    } catch (e) {
      const d = (e as { data?: { message?: string } })?.data;
      toast.error(d?.message ?? "That did not go through.");
      setBusy(false);
    }
  }

  return (
    <Card className="border-critical/30">
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-critical/12 text-critical">
            <Trash2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="font-grotesk text-sm font-semibold text-bone">Delete this studio</p>
            <p className="mt-0.5 text-xs leading-relaxed text-steel">
              Permanently removes {impact.name} and everything in it. There is no undo and no
              backup you can restore from here. Pausing the studio keeps the data and stops the
              billing, which is what most people actually want.
            </p>
          </div>
        </div>

        {/* Step marker: three steps, so say three. */}
        {step > 0 && (
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  step >= (n as Step) ? "bg-critical" : "bg-graphite/50",
                )}
              />
            ))}
            <span className="font-mono text-[0.65rem] tabular-nums text-steel">
              {step} of 3
            </span>
          </div>
        )}

        {step === 0 && (
          <Button size="sm" variant="ghost" onClick={() => setStep(1)}>
            Delete this studio
          </Button>
        )}

        {/* ── Step 1: what dies ── */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="font-grotesk text-xs font-semibold uppercase tracking-[0.06em] text-critical">
              Step 1 · What will be destroyed
            </p>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-graphite/40 sm:grid-cols-4">
              {[
                ["Sessions", impact.counts.sessions],
                ["Clients", impact.counts.clients],
                ["Invoices", impact.counts.invoices],
                ["Payments", impact.counts.payments],
                ["Team", impact.counts.team],
                ["Rooms", impact.counts.rooms],
                ["Songs", impact.counts.songs],
                ["Files", impact.counts.deliverables],
              ].map(([label, n]) => (
                <div key={label as string} className="bg-coal/50 px-3 py-2">
                  <p className="font-meta text-[0.6rem] uppercase tracking-[0.06em] text-steel/60">
                    {label}
                  </p>
                  <p className="font-mono text-base tabular-nums text-bone">{n as number}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-steel">
              {money(impact.money.collectedCents)} collected through this studio will no longer
              appear in any report.
            </p>

            {impact.warnings.length > 0 && (
              <ul className="space-y-1.5 rounded-md border border-caution/30 bg-caution/10 px-3 py-2.5">
                {impact.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-xs text-caution">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={reset}>Keep it</Button>
              <Button size="sm" disabled={busy} onClick={beginConfirmation}>
                I understand, continue
                <ArrowRight className="ml-1.5 size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: retype the name ── */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="font-grotesk text-xs font-semibold uppercase tracking-[0.06em] text-critical">
              Step 2 · Type the studio&apos;s name
            </p>
            <p className="text-xs text-steel">
              Type <span className="font-mono text-bone">{impact.name}</span> exactly, including
              capitals.
            </p>
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={impact.name}
              autoComplete="off"
              aria-label="Type the studio name to confirm"
              className="w-full rounded-md border border-graphite/60 bg-coal/50 px-3 py-2.5 text-sm text-bone outline-none focus:border-critical"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
              <Button size="sm" disabled={!nameOk} onClick={() => setStep(3)}>
                Continue
                <ArrowRight className="ml-1.5 size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: the word ── */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="font-grotesk text-xs font-semibold uppercase tracking-[0.06em] text-critical">
              Step 3 · Confirm
            </p>
            <p className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical/10 px-3 py-2.5 text-xs text-critical">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              This deletes {impact.name} and every record in it, right now. It cannot be undone.
            </p>
            <p className="text-xs text-steel">
              Type <span className="font-mono text-bone">{impact.confirmPhrase}</span> to finish.
            </p>
            <input
              value={typedPhrase}
              onChange={(e) => setTypedPhrase(e.target.value)}
              placeholder={impact.confirmPhrase}
              autoComplete="off"
              aria-label={`Type ${impact.confirmPhrase} to confirm deletion`}
              className="w-full rounded-md border border-graphite/60 bg-coal/50 px-3 py-2.5 font-mono text-sm tracking-[0.2em] text-bone outline-none focus:border-critical"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!nameOk || !phraseOk || busy}
                onClick={destroy}
              >
                <Trash2 className="mr-1.5 size-3.5" />
                {busy ? "Deleting…" : `Delete ${impact.name} forever`}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
