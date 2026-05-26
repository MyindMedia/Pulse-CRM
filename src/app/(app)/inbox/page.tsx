"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Inbox as InboxIcon,
  Check,
  X,
  Clock,
  Mail,
  CalendarCheck,
  StickyNote,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { OpsActionSheet } from "@/components/ai/ops-action-sheet";

const DAY = 86_400_000;

/** Human label + grouping order for each agent / action type. */
const AGENT_META: Record<string, { label: string; group: string; order: number }> = {
  convert_lead: { label: "Booking Conversion", group: "Booking Conversion", order: 0 },
  no_show_risk: { label: "No-show Risk", group: "No-show Risk", order: 1 },
  confirm_unconfirmed_session: { label: "Confirm Session", group: "Confirm Session", order: 2 },
  deposit_unpaid_nudge: { label: "Deposit Nudge", group: "Deposit Nudge", order: 3 },
  session_prep_packet: { label: "Session Prep", group: "Session Prep", order: 4 },
  post_session_recap: { label: "Post-Session Recap", group: "Post-Session Recap", order: 5 },
  revision_triage: { label: "Revision Triage", group: "Revision Triage", order: 6 },
  payment_reminder: { label: "Payment Reminder", group: "Payment Reminder", order: 7 },
  reengage_quiet_artist: { label: "Re-engage Artist", group: "Re-engage Artist", order: 8 },
  chase_split_sheet: { label: "Rights & Splits", group: "Rights & Splits", order: 9 },
  complete_rights_metadata: { label: "Rights & Splits", group: "Rights & Splits", order: 9 },
  resolve_revision_overflow: { label: "Revision Budget", group: "Revision Budget", order: 10 },
  pricing_opportunity: { label: "Pricing", group: "Revenue Ops", order: 11 },
  weak_lead_source: { label: "Lead Source ROI", group: "Revenue Ops", order: 11 },
  promote_underused_room: { label: "Promote Room", group: "Revenue Ops", order: 11 },
};

const PRIORITY_TONE: Record<string, "critical" | "gold" | "neutral"> = {
  high: "critical",
  medium: "gold",
  low: "neutral",
};

function PayloadIcon({ kind }: { kind: string }) {
  if (kind === "email") return <Mail className="size-3.5" />;
  if (kind === "session_status") return <CalendarCheck className="size-3.5" />;
  return <StickyNote className="size-3.5" />;
}

/** A queued action - click to open the detail + edit modal; quick actions below. */
function InboxCard({ action, onOpen }: { action: Doc<"opsActions">; onOpen: (a: Doc<"opsActions">) => void }) {
  const approve = useMutation(api.opsActions.approve);
  const dismiss = useMutation(api.opsActions.dismiss);
  const snooze = useMutation(api.opsActions.snooze);
  const [pending, setPending] = React.useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setPending(true);
    try { await fn(); toast.success(ok); }
    catch { toast.error("Action failed."); }
    finally { setPending(false); }
  }

  const p = action.payload;
  const meta = AGENT_META[action.type] ?? { label: action.type, group: "Other", order: 99 };

  return (
    <div className="rounded-lg border border-hairline bg-coal p-4 shadow-elev-1">
      <button
        type="button"
        onClick={() => onOpen(action)}
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={PRIORITY_TONE[action.priority]}>{action.priority}</Badge>
              <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">{meta.label}</span>
              {action.source === "openai" && (
                <span className="inline-flex items-center gap-1 font-mono text-[0.5625rem] uppercase text-gold"><Sparkles className="size-3" /> AI</span>
              )}
            </div>
            <p className="mt-1 truncate font-display text-sm font-semibold text-bone">{action.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ash">{action.rationale}</p>
            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              <PayloadIcon kind={p.kind} />
              {p.kind === "email" && <span className="truncate">{p.to ?? "no recipient"}</span>}
              {p.kind === "session_status" && <span>will set → {p.newStatus}</span>}
              {p.kind === "note_only" && <span>{action.artifactId ? "draft attached" : "internal note"}</span>}
            </div>
          </div>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-ash-dim" />
        </div>
        <span className="mt-2 block font-mono text-[0.5625rem] uppercase tracking-wide text-gold">Tap to view &amp; edit</span>
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => approve({ id: action._id }), "Approved + sent.")}>
          <Check className="size-3.5" /> Approve
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => dismiss({ id: action._id }), "Dismissed.")}>
          <X className="size-3.5" /> Dismiss
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => snooze({ id: action._id, until: Date.now() + DAY }), "Snoozed 24h.")}>
          <Clock className="size-3.5" /> Snooze 24h
        </Button>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const queue = useQuery(api.opsActions.list, { limit: 100 });
  const counts = useQuery(api.opsActions.counts, {});
  const [openAction, setOpenAction] = React.useState<Doc<"opsActions"> | null>(null);

  const groups = React.useMemo(() => {
    if (!queue) return [];
    const byGroup = new Map<string, { order: number; rows: Doc<"opsActions">[] }>();
    for (const a of queue) {
      const meta = AGENT_META[a.type] ?? { group: "Other", order: 99 };
      const g = byGroup.get(meta.group) ?? { order: meta.order, rows: [] };
      g.rows.push(a);
      byGroup.set(meta.group, g);
    }
    return Array.from(byGroup.entries())
      .map(([name, g]) => ({ name, order: g.order, rows: g.rows }))
      .sort((a, b) => a.order - b.order);
  }, [queue]);

  return (
    <div className="space-y-7">
      <PageHeader
        overline="AI Agents"
        title="Approval Inbox"
        description="Every AI agent drops its drafts here. Click an item to review and edit the details, then approve to send - or dismiss / snooze."
        actions={
          counts ? (
            <Badge tone={counts.high ? "critical" : "gold"}>
              {counts.open} open{counts.high ? ` - ${counts.high} high` : ""}
            </Badge>
          ) : null
        }
      />

      {queue === undefined ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : queue.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="Inbox zero"
          description="No actions need your attention. The AI agents scan continuously and surface drafts here when something comes up."
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.name} className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="overline">{group.name}</h2>
                <Badge tone="neutral">{group.rows.length}</Badge>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {group.rows.map((a) => (
                  <InboxCard key={a._id} action={a} onOpen={setOpenAction} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <OpsActionSheet action={openAction} onClose={() => setOpenAction(null)} />
    </div>
  );
}
