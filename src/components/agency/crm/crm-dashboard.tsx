"use client";

import * as React from "react";
import {
  AlertTriangle, CalendarCheck, CheckCircle2, ChevronDown, ChevronRight, Clock, Gauge, Info, ListChecks,
  MessageSquare, Snowflake, Trophy, UserPlus, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Progress } from "@/components/ui/progress";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { cn } from "@/lib/utils";
import { OP } from "./ops";
import { useZuRead } from "./use-zu";
import { NeedsFullAccess, SyncBar, TOUCH, ZuErrorState, dateTime, plural } from "./crm-ui";
import type { HealthScore, LimitsResponse, Overview, SetupStatus, Usage } from "./zu-types";

/* Dashboard: overview tiles against the previous window, how far this window's
   leads got, the health score with its factors and top actions, and the setup
   checklist. Opening it makes three Zuops requests (eval P-02); credits and
   today's contact limit load when that section is opened. */

const WINDOW_DAYS = 30;

/* ---------- pure helpers (exported for tests) ---------- */

/** Change against the previous window as a fraction, for StatTile's delta. */
export function deltaOf(cur: number | null | undefined, prev: number | null | undefined): number | undefined {
  if (cur == null || prev == null || prev === 0) return undefined;
  return (cur - prev) / prev;
}

export function speed(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.round(minutes / 6) / 10} h`;
}

const REACH_ORDER = ["new", "contacted", "qualified", "booked", "won", "lost"];

export function reachRows(reach: { total?: number; reached?: Record<string, number> } | null | undefined) {
  const total = reach?.total ?? 0;
  const reached = reach?.reached ?? {};
  const keys = [...REACH_ORDER.filter((k) => k in reached), ...Object.keys(reached).filter((k) => !REACH_ORDER.includes(k))];
  return keys.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1).replace(/_/g, " "), value: reached[k] ?? 0, total }));
}

export type Finding = {
  severity: string;
  rank: number;
  issue: string;
  fix: string | null;
  inAppOnly: boolean;
  needsAdmin: boolean;
};

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, warning: 2, low: 3, info: 4 };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/* setup-status findings were not captured in api-shapes.md. llms.txt: "a severity-
   ranked list of findings. Each finding names the API call and MCP tool that fixes
   it, or says when it can only be done in the app". Read the likely field names and
   fall back to whatever text is there. */
export function setupFindings(data: SetupStatus | null | undefined): Finding[] {
  if (!data) return [];
  const list = (Array.isArray(data.findings) ? data.findings : Array.isArray(data.issues) ? data.issues : []) as Array<Record<string, unknown>>;
  return list
    .filter((f) => f && typeof f === "object")
    .map((f) => {
      const severity = (str(f.severity) ?? str(f.level) ?? str(f.priority) ?? "info").toLowerCase();
      const issue = str(f.title) ?? str(f.issue) ?? str(f.message) ?? str(f.summary) ?? str(f.problem) ?? str(f.detail) ?? str(f.key) ?? "A setup item needs attention.";
      const fixObj = f.fix && typeof f.fix === "object" ? (f.fix as Record<string, unknown>) : null;
      const call = str(fixObj?.call) ?? str(fixObj?.api) ?? str(fixObj?.endpoint) ?? str(f.api) ?? str(f.endpoint) ?? str(f.call);
      const how = str(f.fix) ?? str(fixObj?.how) ?? str(fixObj?.note) ?? str(fixObj?.description) ?? str(f.how) ?? str(f.action) ?? str(f.recommendation) ?? str(f.hint);
      const appWords = [f.app_only, f.in_app, fixObj?.app_only, fixObj?.in_app].some((v) => v === true);
      const text = JSON.stringify(f).toLowerCase();
      const inAppOnly = appWords || (!call && /only (be )?done in the app|in the app only|app only/.test(text));
      const needsAdmin = /:admin\b/.test(text) || /\b(post|delete|patch)\s+\/v1\/(members|outbound-webhooks|alert-recipients)/.test(text);
      const fix = how ?? (call ? `Fixed by ${call}` : null);
      return { severity, rank: SEVERITY_RANK[severity] ?? 5, issue, fix, inAppOnly, needsAdmin };
    })
    .sort((a, b) => a.rank - b.rank);
}

/* ---------- pieces ---------- */

const SEV_TONE: Record<string, "critical" | "caution" | "info" | "neutral"> = {
  critical: "critical", high: "critical", medium: "caution", warning: "caution", low: "neutral", info: "info",
};

function SeverityBadge({ severity }: { severity: string }) {
  const tone = SEV_TONE[severity] ?? "neutral";
  const Icon = tone === "critical" || tone === "caution" ? AlertTriangle : Info;
  return <Badge tone={tone}><Icon className="size-3" aria-hidden />{severity}</Badge>;
}

function BarRow({ label, value, max, right, tone = "gold" }: { label: string; value: number; max: number; right: string; tone?: "gold" | "positive" | "caution" | "info" }) {
  return (
    <li className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
      <span className="truncate text-ash">{label}</span>
      <Progress value={value} max={max > 0 ? max : 1} tone={tone} />
      <span className="text-right font-meta tabular-nums text-bone">{right}</span>
    </li>
  );
}

function CardSkeleton() {
  return <div className="space-y-2 p-5 pt-0"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /></div>;
}

function OverviewTiles({ data }: { data: Overview }) {
  const s = data.stats ?? {};
  const days = data.window?.days ?? WINDOW_DAYS;
  const prior = (n: number | undefined) => (n == null ? undefined : `Prior ${plural(days, "day")}: ${n}`);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <StatTile label={`New leads · ${days} d`} value={s.leads ?? 0} icon={UserPlus} delta={deltaOf(s.leads, s.prev_leads)} hint={prior(s.prev_leads)} accent />
      <StatTile label="Not yet worked" value={s.new_unworked ?? 0} icon={Users} hint="Status New" />
      <StatTile label="Appointments" value={s.appointments ?? 0} icon={CalendarCheck} delta={deltaOf(s.appointments, s.prev_appointments)} hint={prior(s.prev_appointments)} />
      <StatTile label="Booked leads" value={s.booked_leads ?? 0} icon={CheckCircle2} delta={deltaOf(s.booked_leads, s.prev_booked_leads)} hint={prior(s.prev_booked_leads)} />
      <StatTile label="Speed to lead" value={speed(s.median_response_minutes)} icon={Clock} hint="Median first reply" />
      <StatTile label="Won" value={s.won ?? 0} icon={Trophy} hint={s.upcoming_appointments != null ? `${s.upcoming_appointments} upcoming appointments` : undefined} />
    </div>
  );
}

function ReachCard({ data }: { data: Overview }) {
  const rows = reachRows(data.stats?.stage_reach);
  return (
    <Card>
      <CardHeader>
        <CardTitle>How far this window&apos;s leads got</CardTitle>
        <CardDescription>Of {plural(data.stats?.stage_reach?.total ?? 0, "lead")} in the last {plural(data.window?.days ?? WINDOW_DAYS, "day")}, how many reached each stage.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0
          ? <p className="text-sm text-steel">No leads in this window yet.</p>
          : <ul className="space-y-2.5">{rows.map((r) => <BarRow key={r.key} label={r.label} value={r.value} max={r.total} right={String(r.value)} />)}</ul>}
      </CardContent>
    </Card>
  );
}

function gradeTone(grade: string | null | undefined): "positive" | "caution" | "critical" | "neutral" {
  const g = (grade ?? "").toLowerCase();
  if (/healthy|great|good|strong/.test(g)) return "positive";
  if (/attention|fair/.test(g)) return "caution";
  if (/risk|dormant|poor/.test(g)) return "critical";
  return "neutral";
}

function HealthCard({ data }: { data: HealthScore }) {
  const tone = gradeTone(data.grade);
  const factors = data.factors ?? [];
  const actions = (data.actions ?? []).slice(0, 3);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Health score</CardTitle>
          {data.grade && (
            <Badge tone={tone}>
              {tone === "positive" ? <CheckCircle2 className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
              {data.grade}
            </Badge>
          )}
        </div>
        <p className="font-grotesk text-3xl font-bold tabular-nums text-bone">
          {data.score ?? "–"}<span className="text-sm font-medium text-steel"> / 100</span>
        </p>
        {data.verdict && <CardDescription>{data.verdict}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-5">
        {factors.length > 0 && (
          <ul className="space-y-3">
            {factors.map((f) => (
              <li key={f.key} className="space-y-1">
                {f.applies === false ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ash">{f.label ?? f.key}</span>
                    <span className="text-xs text-steel/70">Not measured yet</span>
                  </div>
                ) : (
                  <ul><BarRow label={f.label ?? f.key} value={f.earned ?? 0} max={f.weight ?? 0} right={`${f.earned ?? 0}/${f.weight ?? 0}`} tone="positive" /></ul>
                )}
                {(f.value || f.hint) && <p className="text-xs text-steel">{[f.value, f.hint].filter(Boolean).join(". ")}</p>}
              </li>
            ))}
          </ul>
        )}
        {actions.length > 0 && (
          <div className="space-y-2">
            <h4 className="overline">Top actions</h4>
            <ul className="divide-y divide-hairline">
              {actions.map((a) => (
                <li key={a.key} className="flex items-start gap-3 py-2 text-sm">
                  {a.urgent ? <Badge tone="critical"><AlertTriangle className="size-3" aria-hidden />Urgent</Badge> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block text-bone">{a.title}</span>
                    {a.why && <span className="block text-xs text-steel">{a.why}</span>}
                  </span>
                  {a.gain ? <span className="shrink-0 font-meta text-xs text-positive">+{plural(a.gain, "point")}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SetupCard({ data }: { data: SetupStatus }) {
  const findings = setupFindings(data);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListChecks className="size-4 text-steel" aria-hidden />Setup checklist</CardTitle>
        <CardDescription>From Zuops setup status, most serious first.</CardDescription>
      </CardHeader>
      <CardContent>
        {findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-positive"><CheckCircle2 className="size-4" aria-hidden />Nothing missing. Zuops reports no setup findings.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {findings.map((f, i) => (
              <li key={`${f.issue}-${i}`} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-start sm:gap-3">
                <SeverityBadge severity={f.severity} />
                <span className="min-w-0 flex-1">
                  <span className="block text-bone">{f.issue}</span>
                  {f.fix && <span className="block text-xs text-steel">{f.fix}</span>}
                </span>
                {f.needsAdmin ? <NeedsFullAccess /> : f.inAppOnly ? <span className="text-[0.6875rem] text-caution">Done in the Zuops app</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function UsageAndLimits() {
  const usage = useZuRead<Usage>(OP.usage, { query: { days: WINDOW_DAYS } }, { pollMs: 300_000 });
  const limits = useZuRead<LimitsResponse>(OP.messageLimits, undefined, { kinds: ["message"] });
  const l = limits.data?.limits;
  const tools = (usage.data?.by_tool ?? []).filter((t) => (t.credits ?? 0) > 0 || (t.events ?? 0) > 0);
  const maxCredits = Math.max(1, ...tools.map((t) => t.credits ?? 0));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquare className="size-4 text-steel" aria-hidden />Today&apos;s contact limit</CardTitle>
          <CardDescription>Zuops texts or emails at most this many different people a day. Replies to someone already messaged today are free.</CardDescription>
        </CardHeader>
        <CardContent>
          {limits.error ? <ZuErrorState error={limits.error} onRetry={limits.refresh} />
            : !l ? <CardSkeleton />
            : (
              <div className="space-y-3 text-sm">
                <p className="font-grotesk text-2xl font-bold tabular-nums text-bone">
                  {l.unique_contacts_remaining ?? 0}<span className="text-sm font-medium text-steel"> of {plural(l.daily_unique_contact_cap ?? 0, "contact")} left</span>
                </p>
                <Progress value={l.unique_contacts_used ?? 0} max={l.daily_unique_contact_cap ?? 1} tone="info" />
                <p className="text-xs text-steel">{plural(l.messages_sent_today ?? 0, "message")} sent today{l.resets_at ? `. Resets ${dateTime(l.resets_at)}` : ""}.</p>
                {l.frozen && (
                  <Badge tone="critical"><Snowflake className="size-3" aria-hidden />Sending frozen{l.frozen_reason ? `: ${l.frozen_reason}` : ""}</Badge>
                )}
              </div>
            )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge className="size-4 text-steel" aria-hidden />Credits used by tool</CardTitle>
          <CardDescription>Last {plural(usage.data?.window?.days ?? WINDOW_DAYS, "day")}{usage.data?.total_credits != null ? `: ${plural(usage.data.total_credits, "credit")} across ${plural(usage.data.total_events ?? 0, "event")}` : ""}.</CardDescription>
        </CardHeader>
        <CardContent>
          {usage.error ? <ZuErrorState error={usage.error} onRetry={usage.refresh} />
            : !usage.data ? <CardSkeleton />
            : tools.length === 0 ? <p className="text-sm text-steel">No credits used in this window.</p>
            : <ul className="space-y-2.5">{tools.map((t) => <BarRow key={t.tool} label={t.label ?? t.tool} value={t.credits ?? 0} max={maxCredits} right={String(t.credits ?? 0)} tone="info" />)}</ul>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- panel ---------- */

export function CrmDashboard() {
  const overview = useZuRead<Overview>(OP.overview, { query: { days: WINDOW_DAYS } }, { kinds: ["lead", "booking", "message", "call"] });
  const health = useZuRead<HealthScore>(OP.healthScore, undefined, { kinds: ["lead", "booking"], pollMs: 300_000 });
  const setup = useZuRead<SetupStatus>(OP.setupStatus, undefined, { pollMs: 300_000 });
  const [showUsage, setShowUsage] = React.useState(false);

  const refreshAll = () => { overview.refresh(); health.refresh(); setup.refresh(); };
  const fetchedAt = [overview.fetchedAt, health.fetchedAt, setup.fetchedAt].reduce<number | null>(
    (min, t) => (t === null ? min : min === null ? t : Math.min(min, t)), null,
  );

  return (
    <div className="space-y-5">
      <SyncBar fetchedAt={fetchedAt} onRefresh={refreshAll} refreshing={overview.refreshing || health.refreshing || setup.refreshing} />

      {overview.error ? (
        <ZuErrorState error={overview.error} onRetry={overview.refresh} />
      ) : overview.loading || !overview.data ? (
        <div aria-busy="true" aria-label="Loading overview"><SkeletonCards cards={6} /></div>
      ) : (
        <OverviewTiles data={overview.data} />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {overview.data ? <ReachCard data={overview.data} /> : !overview.error ? <Card><CardHeader><CardTitle>How far this window&apos;s leads got</CardTitle></CardHeader><CardSkeleton /></Card> : <div />}
        {health.error ? <ZuErrorState error={health.error} onRetry={health.refresh} />
          : health.data ? <HealthCard data={health.data} />
          : <Card><CardHeader><CardTitle>Health score</CardTitle></CardHeader><CardSkeleton /></Card>}
      </div>

      {setup.error ? <ZuErrorState error={setup.error} onRetry={setup.refresh} />
        : setup.data ? <SetupCard data={setup.data} />
        : <Card><CardHeader><CardTitle>Setup checklist</CardTitle></CardHeader><CardSkeleton /></Card>}

      <section aria-label="Credits and today's contact limit" className="space-y-3">
        <Button
          type="button" variant="ghost" size="sm" className={cn(TOUCH, "px-2")}
          aria-expanded={showUsage} onClick={() => setShowUsage((v) => !v)}
        >
          {showUsage ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
          Credits and today&apos;s contact limit
        </Button>
        {showUsage && <UsageAndLimits />}
      </section>

      {overview.data && (overview.data.stats?.leads ?? 0) === 0 && !overview.error && (
        <EmptyState icon={UserPlus} title="No leads in the last 30 days" description="New leads from forms, Instagram and the API show up here as they arrive." />
      )}
    </div>
  );
}
