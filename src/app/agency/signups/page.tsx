"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* Unfinished sign-ups: everyone who typed their email into "Start free
   trial" on the pricing page, and whether they went on to pay. The open
   rows are people who reached checkout and stopped, which makes this the
   warmest list Pulse has. */

const STATUS = {
  open: { label: "Didn't finish", tone: "caution" },
  converted: { label: "Started trial", tone: "positive" },
  unsubscribed: { label: "Unsubscribed", tone: "neutral" },
  stale: { label: "Went quiet", tone: "neutral" },
} as const;

const CONSENT = {
  notice: "Notice shown",
  opt_in: "Opted in",
  none: "No emails (EU/UK, box unticked)",
} as const;

const FILTERS = [
  { key: "open", label: "Didn't finish" },
  { key: "converted", label: "Started trial" },
  { key: "all", label: "All" },
] as const;

function when(ms: number) {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function SignupLeadsPage() {
  const data = useQuery(api.signupLeads.list);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["key"]>("open");

  const rows = React.useMemo(() => {
    const items = data?.items ?? [];
    return filter === "all" ? items : items.filter((i) => i.status === filter);
  }, [data?.items, filter]);

  const counts = data?.counts;

  return (
    <div className="space-y-6">
      <Link
        href="/agency"
        className="inline-flex items-center gap-1.5 font-meta text-[0.7rem] uppercase tracking-[0.06em] text-steel transition-colors hover:text-bone"
      >
        <ArrowLeft className="size-3.5" />
        Agency
      </Link>

      <PageHeader
        overline="Growth"
        title="Unfinished sign-ups"
        description="People who started a free trial on the pricing page. The ones who didn't finish checkout get up to three reminder emails, if they agreed to them."
      />

      {counts && (
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-graphite/40 sm:grid-cols-4">
              {[
                { label: "Started", n: counts.total },
                { label: "Didn't finish", n: counts.open },
                { label: "Started trial", n: counts.converted },
                { label: "Unsubscribed", n: counts.unsubscribed },
              ].map((s) => (
                <div key={s.label} className="bg-coal/50 px-3.5 py-3">
                  <span className="font-meta text-[0.6rem] uppercase tracking-[0.08em] text-steel/60">{s.label}</span>
                  <p className="mt-1 font-mono text-2xl tabular-nums text-bone">{s.n}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-steel">
              Reminder emails are{" "}
              <span className={cn("font-semibold", data.live ? "text-positive" : "text-caution")}>
                {data.live ? "on" : "off"}
              </span>
              {data.live
                ? `. ${counts.emailable} open lead${counts.emailable === 1 ? "" : "s"} can still be emailed.`
                : ". Leads are tracked; nothing is sent until the reminders are switched on."}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "min-h-9 rounded-full border px-3.5 font-meta text-[0.65rem] uppercase tracking-[0.06em] transition-colors",
              filter === f.key ? "border-gold text-bone" : "border-graphite/60 text-steel hover:text-bone",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-2">
          {data === undefined ? (
            <p className="py-6 text-sm text-steel">Loading</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm text-steel">
              {filter === "open" ? "Nobody is stuck at checkout right now." : "Nothing here yet."}
            </p>
          ) : (
            <ul className="divide-y divide-graphite/40">
              {rows.map((r) => (
                <li key={r._id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-grotesk text-sm font-semibold text-bone">
                      {r.studioName || "No studio name"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(r.email).then(() => toast.success("Email copied"));
                      }}
                      className="mt-0.5 inline-flex max-w-full items-center gap-1.5 text-left text-xs text-mist hover:text-gold"
                    >
                      <span className="truncate">{r.email}</span>
                      <Copy className="size-3 shrink-0" aria-hidden />
                      <span className="sr-only">Copy email</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-steel">
                    <Badge tone="gold" className="capitalize">{r.tier} · {r.interval === "year" ? "yearly" : "monthly"}</Badge>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <span title={CONSENT[r.consent]}>
                      {r.consent === "none" ? "No emails" : `${r.nudgesSent}/3 reminders`}
                    </span>
                    {r.country && <span className="font-mono">{r.country}</span>}
                    <span className="tabular-nums">{when(r.startedAt)}</span>
                    {r.startCount > 1 && <span>Tried {r.startCount}×</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
