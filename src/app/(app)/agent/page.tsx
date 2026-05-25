"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Sparkles, Send, Loader2, Check, X, Lightbulb, ShieldCheck, Gauge, Brain, Trash2, Plus, Repeat } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/toggle";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const SEV_TONE = { info: "neutral", opportunity: "positive", warning: "caution", critical: "critical" } as const;
const RISK_TONE = { low: "neutral", medium: "caution", high: "critical", critical: "critical" } as const;
const BAND_TONE = { strong: "positive", steady: "info", watch: "caution", "at risk": "critical" } as const;
const MEMORY_TYPES = ["studio_profile", "tone_preferences", "business_rules", "client_patterns", "risk_notes", "automation_history"] as const;

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
      <HealthPanel />
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <CommandBar />
          <Insights />
          <AutomationsPanel />
        </div>
        <div className="space-y-5">
          <ApprovalInbox />
          <AgentSettings />
          <MemoryPanel />
        </div>
      </div>
    </div>
  );
}

function HealthPanel() {
  const health = useQuery(api.agentHealth.studioHealth, {});
  if (health === undefined) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-xl bg-gold/12 text-gold"><Gauge className="size-6" /></span>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-bold text-bone">{health.overall}</span>
                <span className="text-sm text-ash-dim">/100</span>
                <Badge tone={BAND_TONE[health.band as keyof typeof BAND_TONE]}>{health.band}</Badge>
              </div>
              <p className="text-xs text-ash-dim">Studio health</p>
            </div>
          </div>
          <div className="grid flex-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {health.components.map((c) => (
              <div key={c.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ash">{c.label}</span>
                  <span className="font-mono text-ash-dim">{c.score}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-coal-3">
                  <div className={cn("h-full rounded-full", c.score >= 70 ? "bg-positive" : c.score >= 45 ? "bg-gold" : "bg-critical")} style={{ width: `${c.score}%` }} />
                </div>
                <p className="mt-0.5 text-[0.625rem] text-ash-dim">{c.signal}</p>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AutomationsPanel() {
  const list = useQuery(api.agentAutomations.list, {});
  const create = useMutation(api.agentAutomations.create);
  const toggle = useMutation(api.agentAutomations.toggle);
  const remove = useMutation(api.agentAutomations.remove);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [cadence, setCadence] = React.useState<"daily" | "weekly">("weekly");

  async function save() {
    if (!name.trim() || !prompt.trim()) return;
    try {
      await create({ name: name.trim(), prompt: prompt.trim(), cadence });
      setName(""); setPrompt(""); setOpen(false);
      toast.success("Automation saved - it runs on schedule.");
    } catch {
      toast.error("Could not save the automation.");
    }
  }
  if (list === undefined) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm"><Repeat className="size-4 text-gold" />Automations</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}><Plus className="size-3.5" />New</Button>
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        <p className="text-[0.6875rem] text-ash-dim">Save a recurring agent task. It runs daily or weekly and surfaces insights + approvals automatically.</p>
        {open && (
          <div className="space-y-2 rounded-md border border-hairline bg-coal/40 p-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Weekly collections sweep)" />
            <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What should it do? e.g. Find overdue invoices and draft reminders." />
            <div className="flex items-center gap-2">
              <Select value={cadence} onValueChange={(v) => setCadence(v as "daily" | "weekly")}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="ml-auto" onClick={save} disabled={!name.trim() || !prompt.trim()}>Save</Button>
            </div>
          </div>
        )}
        {list.length === 0 && !open ? (
          <p className="py-2 text-xs text-ash-dim">No automations yet.</p>
        ) : (
          list.map((a) => (
            <div key={a._id} className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-coal-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold text-bone">{a.name}</p>
                <p className="text-[0.625rem] text-ash-dim">{a.cadence} · {a.runCount} run{a.runCount === 1 ? "" : "s"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch checked={a.enabled} onCheckedChange={(v) => toggle({ id: a._id, enabled: v })} aria-label="Toggle automation" />
                <button onClick={() => remove({ id: a._id })} aria-label="Delete" className="text-ash-dim hover:text-critical"><Trash2 className="size-3.5" /></button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function MemoryPanel() {
  const memories = useQuery(api.agent.listMemories, {});
  const add = useMutation(api.agent.addMemory);
  const del = useMutation(api.agent.deleteMemory);
  const [type, setType] = React.useState<string>("business_rules");
  const [text, setText] = React.useState("");

  async function save() {
    if (!text.trim()) return;
    try {
      await add({ memoryType: type as never, summary: text.trim() });
      setText("");
      toast.success("Saved to the agent's memory.");
    } catch {
      toast.error("Could not save that memory.");
    }
  }
  if (memories === undefined) return null;

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Brain className="size-4 text-gold" />Agent memory</CardTitle></CardHeader>
      <CardContent className="space-y-3 pt-1">
        <p className="text-[0.6875rem] text-ash-dim">What the agent should always remember about this studio. Per-studio only, never shared.</p>
        <div className="space-y-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MEMORY_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Require 50% deposit before confirming sessions." />
            <Button size="sm" onClick={save} disabled={!text.trim()}><Plus className="size-3.5" /></Button>
          </div>
        </div>
        <div className="space-y-1.5">
          {memories.length === 0 ? (
            <p className="text-xs text-ash-dim">No memories yet.</p>
          ) : (
            memories.map((m) => (
              <div key={m._id} className="flex items-start justify-between gap-2 rounded-md border border-hairline bg-coal-2 px-2.5 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-[0.5625rem] uppercase tracking-wide text-ash-dim">{m.memoryType.replace(/_/g, " ")}</p>
                  <p className="text-xs text-ash">{m.summary}</p>
                </div>
                <button onClick={() => del({ id: m._id })} aria-label="Delete memory" className="shrink-0 text-ash-dim hover:text-critical"><Trash2 className="size-3.5" /></button>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
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
