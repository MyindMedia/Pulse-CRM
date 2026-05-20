"use client";

import * as React from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { Sparkles, TrendingDown, Calendar as CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AiDraftCard, NoArtifactsYet } from "./draft-card";
import type { Doc } from "@convex/_generated/dataModel";

const TAB_KINDS = [
  { id: "all", label: "All", kindFilter: undefined as string | undefined },
  { id: "weekly", label: "Briefings", kindFilter: "weekly_briefing" },
  { id: "rate_cut", label: "Rate-cut promos", kindFilter: "rate_cut_promo" },
  { id: "recap", label: "Recaps", kindFilter: "session_recap" },
  { id: "prep", label: "Prep packets", kindFilter: "prep_packet" },
  { id: "reminders", label: "Reminders", kindFilter: "reminder_24h" },
] as const;

/** Dashboard panel that surfaces every AI artifact + generators for the
 * two studio-wide artifacts (weekly briefing, rate-cut promos). */
export function PulseAiPanel() {
  const [tab, setTab] = React.useState<typeof TAB_KINDS[number]["id"]>("all");
  const all = useQuery(api.aiArtifacts.list, { limit: 30 });

  const generateBriefing = useAction(api.aiActions.generateWeeklyBriefing);
  const generatePromos = useAction(api.aiActions.generateRateCutPromos);
  const [briefingPending, setBriefingPending] = React.useState(false);
  const [promoPending, setPromoPending] = React.useState(false);

  async function runBriefing() {
    setBriefingPending(true);
    try {
      await generateBriefing({});
      toast.success("Weekly briefing generated.");
    } catch {
      toast.error("Briefing failed.");
    } finally {
      setBriefingPending(false);
    }
  }

  async function runPromos() {
    setPromoPending(true);
    try {
      await generatePromos({});
      toast.success("Rate-cut promos generated (if any underused windows).");
    } catch {
      toast.error("Promo generation failed.");
    } finally {
      setPromoPending(false);
    }
  }

  const filtered: Doc<"aiArtifacts">[] = React.useMemo(() => {
    if (!all) return [];
    if (tab === "all") return all;
    if (tab === "reminders") {
      return all.filter(
        (a) => a.kind === "reminder_24h" || a.kind === "reminder_1h",
      );
    }
    const cfg = TAB_KINDS.find((t) => t.id === tab);
    return all.filter((a) => a.kind === cfg?.kindFilter);
  }, [all, tab]);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-gold" />
            <p className="font-display text-sm font-semibold text-bone">
              Pulse AI
            </p>
            <span className="font-mono text-[0.625rem] uppercase text-ash-dim">
              {all?.length ?? 0} artifacts
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={runPromos} disabled={promoPending}>
              <TrendingDown className={promoPending ? "size-3.5 animate-spin" : "size-3.5"} />
              Run rate-cut scan
            </Button>
            <Button size="sm" onClick={runBriefing} disabled={briefingPending}>
              <CalendarIcon className={briefingPending ? "size-3.5 animate-spin" : "size-3.5"} />
              Generate weekly briefing
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            {TAB_KINDS.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TAB_KINDS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-3 space-y-2">
              {all === undefined ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skeleton h-20 rounded-md" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <NoArtifactsYet
                  message={
                    t.id === "weekly"
                      ? 'Click "Generate weekly briefing" to draft this week.'
                      : t.id === "rate_cut"
                        ? 'Click "Run rate-cut scan" to find underused windows.'
                        : "Artifacts of this type will appear as sessions move through the calendar."
                  }
                />
              ) : (
                filtered.map((a) => <AiDraftCard key={a._id} artifact={a} />)
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
