"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Sparkles, Send, Loader2, Check, X, Lightbulb, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/toggle";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

const SEV_TONE = { info: "neutral", opportunity: "positive", warning: "caution", critical: "critical" } as const;
const RISK_TONE = { low: "neutral", medium: "caution", high: "critical", critical: "critical" } as const;

const SUGGESTED = [
  "How is my studio doing right now?",
  "Which leads should I follow up with today?",
  "Find overdue invoices and draft reminders.",
  "What sessions this week are missing deposits or files?",
];

export default function AgentPage() {
  return (
    <div className="space-y-7">
      <PageHeader
        overline="Studio intelligence"
        title="Pulse Agent"
        description="Your AI studio operations manager. It reads this studio's data, flags what matters, and prepares actions for your approval - it never sends anything on its own."
      />
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <CommandBar />
          <Insights />
        </div>
        <div className="space-y-5">
          <ApprovalInbox />
          <AgentSettings />
        </div>
      </div>
    </div>
  );
}

function CommandBar() {
  const createRun = useMutation(api.agent.createRun);
  const [prompt, setPrompt] = React.useState("");
  const [runId, setRunId] = React.useState<Id<"agentRuns"> | null>(null);
  const [busy, setBusy] = React.useState(false);
  const result = useQuery(api.agent.getRun, runId ? { id: runId } : "skip");

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const id = await createRun({ prompt: q });
      setRunId(id);
      setPrompt("");
    } catch {
      toast.error("Could not reach the agent.");
    } finally {
      setBusy(false);
    }
  }

  const run = result?.run;
  const assistant = result?.messages.filter((m) => m.role === "assistant").at(-1);
  const thinking = runId && (!run || run.status === "queued" || run.status === "running");

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-gold/12 text-gold"><Sparkles className="size-4" /></span>
          <p className="font-display text-sm font-semibold text-bone">Ask the agent</p>
        </div>
        <Textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask anything about this studio - bookings, revenue, leads, sessions, follow-ups..."
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") ask(prompt); }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}
              className="rounded-full border border-hairline-2 bg-coal/60 px-2.5 py-1 text-[0.6875rem] text-ash transition-colors hover:border-gold-dim hover:text-bone disabled:opacity-50">
              {s}
            </button>
          ))}
          <Button size="sm" className="ml-auto" disabled={busy || !prompt.trim()} onClick={() => ask(prompt)}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Ask
          </Button>
        </div>

        {thinking && (
          <div className="flex items-center gap-2 rounded-md border border-hairline bg-coal/40 px-3 py-3 text-sm text-ash">
            <Loader2 className="size-4 animate-spin text-gold" /> Analyzing your studio...
          </div>
        )}
        {run && run.status !== "queued" && run.status !== "running" && assistant && (
          <div className="rounded-md border border-hairline bg-coal-2 px-4 py-3.5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-bone">{assistant.body}</p>
            {run.status === "needs_approval" && (
              <p className="mt-2 text-xs text-gold">Prepared actions are waiting in your approval inbox.</p>
            )}
            {run.source === "fallback" && (
              <p className="mt-2 text-[0.6875rem] text-ash-dim">Connect an AI key (OPENAI_API_KEY) for full analysis and drafting.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Insights() {
  const insights = useQuery(api.agent.listInsights, {});
  const dismiss = useMutation(api.agent.dismissInsight);
  if (insights === undefined) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Lightbulb className="size-4 text-gold" />Insights</CardTitle></CardHeader>
      <CardContent className="space-y-2 pt-1">
        {insights.length === 0 ? (
          <p className="py-4 text-center text-sm text-ash-dim">No active insights yet. Ask the agent or wait for the daily brief.</p>
        ) : (
          insights.map((i) => (
            <div key={i._id} className="rounded-md border border-hairline bg-coal-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={SEV_TONE[i.severity]}>{i.severity}</Badge>
                  <p className="font-display text-sm font-semibold text-bone">{i.title}</p>
                </div>
                <button onClick={() => dismiss({ id: i._id })} aria-label="Dismiss" className="text-ash-dim hover:text-bone"><X className="size-3.5" /></button>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ash">{i.explanation}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ApprovalInbox() {
  const approvals = useQuery(api.agent.listApprovals, {});
  const approve = useMutation(api.agent.approveRequest);
  const reject = useMutation(api.agent.rejectRequest);
  if (approvals === undefined) return null;
  const pending = approvals.filter((a) => a.status === "pending");

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-gold" />Approval inbox</CardTitle></CardHeader>
      <CardContent className="space-y-2 pt-1">
        {pending.length === 0 ? (
          <p className="py-4 text-center text-sm text-ash-dim">Nothing waiting. Actions the agent prepares show up here for one-tap approval.</p>
        ) : (
          pending.map((a) => (
            <div key={a._id} className="rounded-md border border-hairline bg-coal-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display text-sm font-semibold text-bone">{a.title}</p>
                <Badge tone={RISK_TONE[a.riskLevel]}>{a.riskLevel}</Badge>
              </div>
              <p className="mt-1 text-xs text-ash">{a.explanation}</p>
              <p className="mt-1 font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">{a.actionType.replace(/_/g, " ")}</p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => approve({ id: a._id }).then(() => toast.success("Approved + executing.")).catch(() => toast.error("Could not approve."))}>
                  <Check className="size-3.5" />Approve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => reject({ id: a._id })}><X className="size-3.5" />Reject</Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AgentSettings() {
  const policy = useQuery(api.agent.getPolicy, {});
  const update = useMutation(api.agent.updatePolicy);
  if (policy === undefined) return null;
  const set = (patch: Record<string, unknown>) =>
    update(patch).catch(() => toast.error("Could not update settings."));

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Agent settings</CardTitle></CardHeader>
      <CardContent className="space-y-3 pt-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-ash">Agent enabled</span>
          <Switch checked={policy.enabled} onCheckedChange={(v) => set({ enabled: v })} aria-label="Toggle agent" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ash">Tone</span>
          <Select value={policy.defaultTone} onValueChange={(v) => set({ defaultTone: v })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["professional", "friendly", "luxury", "direct"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ash">Autonomy</span>
          <Select value={policy.autonomy} onValueChange={(v) => set({ autonomy: v })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="suggest">Suggest only</SelectItem>
              <SelectItem value="auto_low">Auto low-risk</SelectItem>
              <SelectItem value="auto_trusted">Auto trusted</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ash">Daily brief</span>
          <Switch checked={policy.digestEnabled} onCheckedChange={(v) => set({ digestEnabled: v })} aria-label="Toggle daily brief" />
        </div>
        <p className="text-[0.6875rem] text-ash-dim">Approval-first: client, money, file, and automation actions always wait for your approval unless you raise autonomy.</p>
      </CardContent>
    </Card>
  );
}
