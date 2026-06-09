"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Sparkles, Play, ShieldCheck, Inbox } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/toggle";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ApprovalEditDialog, type ApprovalItem } from "@/components/agent/approval-edit-dialog";
import { relativeTime } from "@/lib/format";

const RISK_TONE = { low: "neutral", medium: "caution", high: "critical", critical: "critical" } as const;
const BAND_TONE = { strong: "positive", steady: "info", watch: "caution", "at risk": "critical" } as const;

export default function AgencyAgentsPage() {
  const fleet = useQuery(api.agentFleet.fleet, {});
  const approvals = useQuery(api.agentFleet.pendingApprovals, {});
  const setEnabled = useMutation(api.agentFleet.setEnabled);
  const setAutonomy = useMutation(api.agentFleet.setAutonomy);
  const runNow = useMutation(api.agentFleet.runNow);
  const [running, setRunning] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ApprovalItem | null>(null);

  async function run(orgId: string, name: string) {
    setRunning(orgId);
    try {
      await runNow({ orgId });
      toast.success(`Agent running for ${name}.`);
    } catch {
      toast.error("Could not start the agent.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Agency"
        title="Agents"
        description="A dedicated AI operations manager per studio. Toggle each one on, set how much autonomy it has, run it on demand, and clear its prepared actions - all from here."
      />

      <Section title="Studio agents">
        {fleet === undefined ? (
          <SkeletonRows rows={3} />
        ) : fleet.length === 0 ? (
          <EmptyState icon={Sparkles} title="No sub-accounts yet" description="Provision a studio and its dedicated agent appears here." />
        ) : (
          <div className="space-y-2">
            {fleet.map((s) => (
              <Card key={s.orgId}>
                <CardContent className="flex flex-wrap items-center gap-4 p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md border border-gold-dim/40 bg-gold/10 text-gold">
                    <Sparkles className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-grotesk text-sm font-semibold text-bone">{s.name}</p>
                    <p className="text-xs text-steel/70">
                      {s.lastRunAt ? `Last run ${relativeTime(s.lastRunAt)}` : "Not run yet"}
                      {s.activeInsights > 0 && ` · ${s.activeInsights} insights`}
                    </p>
                  </div>

                  <Badge tone={BAND_TONE[s.healthBand as keyof typeof BAND_TONE]}>{s.healthScore} {s.healthBand}</Badge>
                  {s.pendingApprovals > 0 && (
                    <Badge tone="caution"><Inbox className="size-3" />{s.pendingApprovals} pending</Badge>
                  )}

                  <Select value={s.autonomy} onValueChange={(v) => setAutonomy({ orgId: s.orgId, autonomy: v as never }).catch(() => toast.error("Failed"))}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="suggest">Suggest only</SelectItem>
                      <SelectItem value="auto_low">Auto low-risk</SelectItem>
                      <SelectItem value="auto_trusted">Auto trusted</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button size="sm" variant="secondary" disabled={running === s.orgId || !s.enabled} onClick={() => run(s.orgId, s.name)}>
                    <Play className="size-3.5" />Run now
                  </Button>

                  <div className="flex items-center gap-2">
                    <span className="text-[0.6875rem] text-steel/70">{s.enabled ? "On" : "Off"}</span>
                    <Switch checked={s.enabled} onCheckedChange={(v) => setEnabled({ orgId: s.orgId, enabled: v }).catch(() => toast.error("Failed"))} aria-label={`Toggle agent for ${s.name}`} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Approvals across studios">
        {approvals === undefined ? (
          <SkeletonRows rows={2} />
        ) : approvals.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nothing waiting" description="Actions any studio's agent prepares show up here for approval." />
        ) : (
          <div className="space-y-2">
            {approvals.map((a) => (
              <Card key={a._id as string}>
                <button
                  onClick={() => setEditing(a as unknown as ApprovalItem)}
                  className="block w-full p-4 text-left outline-none transition-colors hover:bg-coal/40 focus-visible:ring-2 focus-visible:ring-gold/30"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{a.studioName as string}</Badge>
                    <p className="truncate font-grotesk text-sm font-semibold text-bone">{a.title as string}</p>
                    <Badge tone={RISK_TONE[a.riskLevel as keyof typeof RISK_TONE]}>{a.riskLevel as string}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-steel">{a.explanation as string}</p>
                  <p className="mt-1.5 font-meta text-[0.625rem] uppercase tracking-wide text-gold">Tap to review &amp; edit</p>
                </button>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <ApprovalEditDialog item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
