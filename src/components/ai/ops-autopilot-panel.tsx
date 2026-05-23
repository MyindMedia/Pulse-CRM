"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Bot, Check, X, Clock, Mail, CalendarCheck, StickyNote, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Doc, Id } from "@convex/_generated/dataModel";

const PRIORITY_TONE: Record<string, string> = {
  high: "bg-red-500/15 text-red-300 border-red-500/30",
  medium: "bg-gold/15 text-gold border-gold-dim/40",
  low: "bg-bone/10 text-ash border-bone/15",
};

const DAY = 86_400_000;

function PayloadIcon({ kind }: { kind: string }) {
  if (kind === "email") return <Mail className="size-3.5" />;
  if (kind === "session_status") return <CalendarCheck className="size-3.5" />;
  return <StickyNote className="size-3.5" />;
}

function ActionCard({ action }: { action: Doc<"opsActions"> }) {
  const approve = useMutation(api.opsActions.approve);
  const dismiss = useMutation(api.opsActions.dismiss);
  const snooze = useMutation(api.opsActions.snooze);
  const [pending, setPending] = React.useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setPending(true);
    try {
      await fn();
      toast.success(ok);
    } catch {
      toast.error("Action failed.");
    } finally {
      setPending(false);
    }
  }

  const p = action.payload;
  return (
    <div className="rounded-md border border-bone/10 bg-bone/[0.02] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[0.5625rem] uppercase ${PRIORITY_TONE[action.priority]}`}>
              {action.priority}
            </span>
            <p className="truncate font-display text-sm font-semibold text-bone">{action.title}</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ash">{action.rationale}</p>
          {p.kind === "email" && (
            <div className="mt-2 rounded border border-bone/10 bg-ink/40 p-2 text-xs text-ash-dim">
              <span className="inline-flex items-center gap-1 font-mono text-[0.625rem] uppercase text-ash">
                <PayloadIcon kind={p.kind} /> {p.to ?? "no recipient"}
              </span>
              <p className="mt-1 font-medium text-bone">{p.subject}</p>
              <p className="mt-0.5 line-clamp-2">{p.body}</p>
            </div>
          )}
          {p.kind === "session_status" && (
            <p className="mt-2 inline-flex items-center gap-1 font-mono text-[0.625rem] uppercase text-ash">
              <PayloadIcon kind={p.kind} /> will set session → {p.newStatus}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => approve({ id: action._id }), "Approved + executed.")}>
          <Check className="size-3.5" /> Approve
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => dismiss({ id: action._id }), "Dismissed.")}>
          <X className="size-3.5" /> Dismiss
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => snooze({ id: action._id, until: Date.now() + DAY }), "Snoozed 24h.")}>
          <Clock className="size-3.5" /> Snooze
        </Button>
      </div>
    </div>
  );
}

/** Dashboard panel: the proposed operational-action queue + autonomy nudges. */
export function OpsAutopilotPanel() {
  const queue = useQuery(api.opsActions.list, { limit: 30 });
  const counts = useQuery(api.opsActions.counts, {});
  const suggestions = useQuery(api.opsActions.suggestions, {});
  const setMode = useMutation(api.opsActions.setMode);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-gold" />
            <p className="font-display text-sm font-semibold text-bone">Ops Autopilot</p>
            <span className="font-mono text-[0.625rem] uppercase text-ash-dim">
              {counts?.open ?? 0} open{counts?.high ? ` · ${counts.high} high` : ""}
            </span>
          </div>
        </div>

        {suggestions && suggestions.length > 0 && (
          <div className="rounded-md border border-gold-dim/40 bg-gold/[0.05] p-3 text-xs text-ash">
            <p className="font-medium text-bone">Ready for autopilot</p>
            <div className="mt-2 space-y-1.5">
              {suggestions.map((s) => (
                <div key={s.actionType} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-[0.625rem] uppercase text-gold">{s.actionType.replace(/_/g, " ")}</span>
                    {" "}approved {s.approvedCount}× with few dismissals.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await setMode({ actionType: s.actionType, mode: "auto" });
                        toast.success("Now on autopilot.");
                      } catch {
                        toast.error("Could not enable.");
                      }
                    }}
                  >
                    <Zap className="size-3.5" /> Enable
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {queue === undefined ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-24 rounded-md" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <div className="rounded-md border border-dashed border-bone/15 p-6 text-center text-sm text-ash-dim">
            All clear. The autopilot scans daily and surfaces actions here when something needs attention.
          </div>
        ) : (
          <div className="space-y-2">
            {queue.map((a: Doc<"opsActions">) => (
              <ActionCard key={a._id as Id<"opsActions">} action={a} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
