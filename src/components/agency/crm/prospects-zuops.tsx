"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { Send } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog, READ_ONLY_REASON, WriteButton, plural, type ConfirmGrant } from "./crm-ui";

/* Outreach prospects into Zuops (eval U-17). One card above the prospecting tabs:
   how many prospects are leads in Zuops, and a button that adds the rest to the
   Outreach stage. The push runs in batches of 25 until none remain or a batch
   fails; one confirm covers the run. The confirm flag comes only from
   ConfirmDialog's grant. Without a Zuops key the card is one quiet line and the
   rest of Prospects works as before. */

export type ProspectsPlan = {
  total: number;
  eligible: number;
  linked: number;
  toPush: number;
  skippedNoEmail: number;
  skippedOptedOut: number;
  keyConfigured: boolean;
  writesOn: boolean;
  stageReady: boolean;
};

type PushResult = { ok: boolean; pushed: number; matched: number; failed: number; remaining: number; reason?: string; retryAfter?: number };

const BATCH = 25;

export function prospectsWord(n: number): string {
  return plural(n, "prospect");
}

/** The confirm dialog's title and body for K prospects. */
export function pushConfirmCopy(k: number): { title: string; body: string } {
  return {
    title: `Add ${prospectsWord(k)} to Zuops?`,
    body: "They go into the Outreach stage as leads with their email only. No phone number is sent, so Zuops cannot text or call them. Nobody is emailed by this.",
  };
}

/** The summary line and the skipped counts, in words. */
export function planLines(p: ProspectsPlan): { summary: string; skipped: string | null } {
  const summary = `${p.linked} of ${prospectsWord(p.total)} ${p.total === 1 ? "is" : "are"} in Zuops, in the Outreach stage.`;
  const parts: string[] = [];
  if (p.skippedNoEmail > 0) parts.push(`${p.skippedNoEmail} ${p.skippedNoEmail === 1 ? "has" : "have"} no email, so ${p.skippedNoEmail === 1 ? "it is" : "they are"} not added`);
  if (p.skippedOptedOut > 0) parts.push(`${p.skippedOptedOut} opted out and ${p.skippedOptedOut === 1 ? "is" : "are"} never added`);
  return { summary, skipped: parts.length ? `${parts.join(". ")}.` : null };
}

type Progress = { running: boolean; added: number; line: string | null; error: string | null };

export function ProspectsToZuops() {
  const plan = useQuery(api.crmProspects.plan, {}) as ProspectsPlan | null | undefined;
  const push = useAction(api.crmProspects.push);
  const [open, setOpen] = React.useState(false);
  const [progress, setProgress] = React.useState<Progress>({ running: false, added: 0, line: null, error: null });

  if (!plan) return null;
  if (!plan.keyConfigured) {
    return <p className="text-xs text-steel" role="status">Zuops not connected</p>;
  }

  const runAll = async (grant: ConfirmGrant) => {
    let added = 0;
    setProgress({ running: true, added: 0, line: "Adding prospects to Zuops", error: null });
    for (;;) {
      let r: PushResult;
      try {
        r = await push({ ...grant, limit: BATCH });
      } catch {
        setProgress({ running: false, added, line: null, error: "Could not reach Pulse. Nothing more was added." });
        return;
      }
      added += r.pushed + r.matched;
      if (!r.ok || r.pushed + r.matched === 0 || r.remaining === 0) {
        const wait = r.retryAfter !== undefined ? ` Try again in ${r.retryAfter} seconds.` : "";
        setProgress({
          running: false,
          added,
          line: `Added ${prospectsWord(added)} to Zuops.`,
          error: r.ok ? null : `${r.reason ?? "Zuops did not accept the last batch."}${wait}`,
        });
        return;
      }
      setProgress({ running: true, added, line: `Added ${added} so far, ${r.remaining} to go`, error: null });
    }
  };

  const { summary, skipped } = planLines(plan);
  const copy = pushConfirmCopy(plan.toPush);
  const readOnly = !plan.writesOn;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium text-bone">{summary}</p>
          {skipped && <p className="text-steel">{skipped}</p>}
          {plan.toPush === 0 && <p className="text-steel">Every prospect with an email is in Zuops.</p>}
          {readOnly && <p className="text-caution">{READ_ONLY_REASON}</p>}
          {progress.line && <p role="status" className="text-steel">{progress.line}</p>}
          {progress.error && <p role="alert" className="text-critical">{progress.error}</p>}
        </div>
        {plan.toPush > 0 && (
          <>
            <WriteButton
              type="button"
              blockedReason={readOnly ? READ_ONLY_REASON : null}
              disabled={progress.running}
              onClick={() => setOpen(true)}
            >
              <Send className="size-4" aria-hidden />
              Add {prospectsWord(plan.toPush)} to Zuops
            </WriteButton>
            <ConfirmDialog
              open={open}
              onOpenChange={setOpen}
              title={copy.title}
              body={copy.body}
              confirmLabel={`Add ${prospectsWord(plan.toPush)}`}
              onConfirm={(grant) => { void runAll(grant); }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
