"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, Link2, Lock, MailCheck, PauseCircle,
  PlayCircle, ShieldAlert, XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";

/* Outreach - the agency console's outbound communications tab.
   Test-only: this screen reads state and offers one write, the overall pause.
   Every status carries text and an icon, so nothing depends on colour alone. */

type Tone = "neutral" | "positive" | "caution" | "critical" | "info";

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral", approved: "info", submitting: "info", accepted: "info",
  delivered: "positive", bounced: "critical", rejected: "critical",
  suppressed: "caution", unknown: "caution",
};

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const Icon =
    tone === "positive" ? CheckCircle2 : tone === "critical" ? XCircle : tone === "caution" ? AlertTriangle : CircleDashed;
  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {status}
    </Badge>
  );
}

const when = (ms: number) => new Date(ms).toLocaleString();

function Unauthorized() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Agency membership required"
      description="Outreach is limited to agency members. Sign in with an agency account to see it."
    />
  );
}

export function TestOnlyBanner({ paused }: { paused: boolean }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-caution/30 bg-caution/10 px-4 py-3 text-sm text-bone"
    >
      <Lock className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
      <p>
        <strong className="font-semibold">Test only.</strong> Nothing is sent, called or texted from this tab.
        {paused ? " Outreach is also paused." : ""} Sends, automatic calls and SMS each stay behind their own
        disabled integrations until you approve them.
      </p>
    </div>
  );
}

/* ------------------------------- Overview ------------------------------- */

export function Overview() {
  const data = useQuery(api.outreach.overview, {});
  if (data === undefined) return <LoadingPanel label="Loading Outreach" />;
  if (data === null) return <Unauthorized />;
  const counts = Object.entries(data.counts);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.readiness.map((r) => (
          <Card key={r.key}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-grotesk text-sm font-semibold text-bone">{r.label}</p>
                <Badge tone={r.state === "ready" ? "positive" : r.state === "disabled" ? "neutral" : "caution"}>
                  {r.state === "ready" ? <CheckCircle2 className="size-3" aria-hidden /> : <CircleDashed className="size-3" aria-hidden />}
                  {r.state}
                </Badge>
              </div>
              <p className="text-xs text-steel">{r.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Delivery states</CardTitle>
          <CardDescription>Counts from the last 200 recorded messages. Accepted is not delivered.</CardDescription>
        </CardHeader>
        <CardContent>
          {counts.length === 0 ? (
            <p className="text-sm text-steel">No messages recorded yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {counts.map(([status, n]) => (
                <span key={status} className="flex items-center gap-2 text-sm text-bone">
                  <StatusBadge status={status} /> {n}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
          <CardDescription>Bounced, rejected, or unknown outcomes. Unknown means check the provider before any retry.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.failures.length === 0 ? (
            <p className="text-sm text-steel">Nothing needs attention.</p>
          ) : (
            <ul className="divide-y divide-hairline text-sm">
              {data.failures.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-2">
                  <StatusBadge status={f.status} />
                  <span className="text-bone">{f.subject}</span>
                  <span className="text-xs text-steel/70">{f.recipient} · {when(f.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ----------------------------- Communications ----------------------------- */

export function Communications() {
  const rows = useQuery(api.outreach.communications, {});
  const templates = useQuery(api.outreach.templates, {});
  if (rows === undefined || templates === undefined) return <LoadingPanel label="Loading messages" />;
  if (rows === null || templates === null) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-lg border border-graphite/50 bg-coal/40">
        <table className="w-full text-sm">
          <caption className="sr-only">Recorded outbound email</caption>
          <thead>
            <tr className="border-b border-graphite/50 text-left font-meta text-[0.6875rem] uppercase tracking-wide text-steel/70">
              <th scope="col" className="p-3">When</th>
              <th scope="col" className="p-3">Recipient</th>
              <th scope="col" className="p-3">Subject</th>
              <th scope="col" className="p-3">Status</th>
              <th scope="col" className="p-3">Provider ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="p-3 text-xs text-steel/70">{when(c.at)}</td>
                <td className="p-3 text-xs text-steel">
                  {c.recipient}
                  <span className="block text-steel/60">from {c.sender}</span>
                </td>
                <td className="p-3 text-bone">
                  {c.isTest && <Badge tone="info" className="mr-2">test</Badge>}
                  {c.subject}
                </td>
                <td className="space-y-1 p-3 text-xs">
                  <StatusBadge status={c.status} />
                  <p className="max-w-xs text-steel/70">{c.meaning}</p>
                  {c.lastError && <p className="text-critical">{c.lastError}</p>}
                </td>
                <td className="p-3 font-meta text-xs text-steel/70">{c.providerId ?? "-"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-steel/70">
                  No messages recorded yet. There is no send button here: sending is not enabled.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            Approval belongs to one exact version. Changed content supersedes the old approval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-sm text-steel">No templates registered.</p>
          ) : (
            <ul className="divide-y divide-hairline text-sm">
              {templates.map((tpl) => (
                <li key={`${tpl.key}-${tpl.approval}-${tpl.subject}`} className="flex flex-wrap items-center gap-3 py-2">
                  <Badge tone={tpl.approval === "approved" ? "positive" : tpl.approval === "superseded" ? "neutral" : "caution"}>
                    {tpl.approval.replace("_", " ")}
                  </Badge>
                  <span className="text-bone">{tpl.name}</span>
                  <span className="text-xs text-steel/70">{tpl.subject}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------- Meetings ------------------------------- */

export function Meetings() {
  const data = useQuery(api.outreach.meetings, {});
  if (data === undefined) return <LoadingPanel label="Loading meetings" />;
  if (data === null) return <Unauthorized />;
  if (!data.mapped) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No calendar connected"
        description="Meetings appear once an operator maps a verified calendar and location to this agency. A booking link click is not a booking."
      />
    );
  }
  if (data.rows.length === 0) {
    return <EmptyState icon={CalendarClock} title="No appointments recorded" description="Nothing has been received from the calendar yet." />;
  }
  return (
    <div className="space-y-3">
      {data.rows.map((m) => (
        <Card key={m.id}>
          <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="space-y-1">
              <p className="font-grotesk text-sm font-semibold text-bone">{m.name}</p>
              <p className="text-xs text-steel">{when(m.start)} · {m.timezone} · {m.phone}</p>
              <p className="text-xs text-steel/70">Appointment {m.id}, revision {m.version}</p>
            </div>
            <div className="space-y-1 text-right">
              <Badge tone={m.status === "cancelled" ? "critical" : "info"}>{m.status}</Badge>
              <p className="text-xs text-steel">
                Call: <strong className="text-bone">{m.call.state}</strong>
              </p>
              <p className="max-w-xs text-xs text-steel/70">{m.call.reason}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* --------------------------- Links and calendars --------------------------- */

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="font-meta text-[0.6875rem] uppercase tracking-wide text-steel/70">{label}</dt>
      <dd className="mt-0.5 break-all text-sm text-bone">{value}</dd>
    </div>
  );
}

export function Links() {
  const data = useQuery(api.outreach.links, {});
  if (data === undefined) return <LoadingPanel label="Loading links" />;
  if (data === null) return <Unauthorized />;
  if (!data.configured) {
    return (
      <EmptyState
        icon={Link2}
        title="Nothing verified yet"
        description="Booking links, calendar and sending identities are set by an operator after they are verified with each provider. This screen never guesses them."
      />
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Booking and calendar</CardTitle>
          <CardDescription>
            {data.verifiedAt ? `Operator-verified ${when(data.verifiedAt)}` : "Not verified"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <Field label="Booking link" value={data.bookingUrl ?? "Not set"} />
            <Field label="Calendar" value={data.calendarId ?? "Not set"} />
            <Field label="Location" value={data.locationId ?? "Not set"} />
            <Field label="Duration" value={data.durationMin ? `${data.durationMin} minutes` : "Not set"} />
            <Field label="Timezone" value={data.timezone ?? "Not set"} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sending identities</CardTitle>
          <CardDescription>Only a verified identity can ever send.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.senders.length === 0 ? (
            <p className="text-sm text-steel">No sending identity registered.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.senders.map((s) => (
                <li key={s.address} className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.verified ? "positive" : "caution"}>{s.verified ? "verified" : "unverified"}</Badge>
                  <span className="text-bone">{s.label}</span>
                  <span className="text-xs text-steel/70">{s.address}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------- Activity -------------------------------- */

export function Activity() {
  const rows = useQuery(api.outreach.activity, {});
  if (rows === undefined) return <LoadingPanel label="Loading activity" />;
  if (rows === null) return <Unauthorized />;
  if (rows.length === 0) return <EmptyState icon={MailCheck} title="No activity yet" description="Sends, pauses and configuration changes will be listed here." />;
  return (
    <div className="overflow-x-auto rounded-lg border border-graphite/50 bg-coal/40">
      <table className="w-full text-sm">
        <caption className="sr-only">Outreach audit trail</caption>
        <thead>
          <tr className="border-b border-graphite/50 text-left font-meta text-[0.6875rem] uppercase tracking-wide text-steel/70">
            <th scope="col" className="p-3">When</th>
            <th scope="col" className="p-3">Actor</th>
            <th scope="col" className="p-3">Action</th>
            <th scope="col" className="p-3">Result</th>
            <th scope="col" className="p-3">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="p-3 text-xs text-steel/70">{when(e.at)}</td>
              <td className="p-3 text-xs text-steel">{e.actor}</td>
              <td className="p-3 font-meta text-xs text-bone">{e.action}</td>
              <td className="p-3 text-xs"><Badge tone={e.result === "ok" ? "positive" : e.result === "denied" ? "critical" : "caution"}>{e.result}</Badge></td>
              <td className="p-3 text-xs text-steel/70">{[e.resource, e.detail].filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- Settings -------------------------------- */

export function Settings() {
  const data = useQuery(api.outreach.overview, {});
  const setPaused = useMutation(api.outreach.setPaused);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (data === undefined) return <LoadingPanel label="Loading settings" />;
  if (data === null) return <Unauthorized />;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setPaused({ paused: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the pause setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Pause Outreach</CardTitle>
          <CardDescription>
            Stops any new outbound action and cancels queued work at run time. The audit trail is kept. It does not
            change the live Bland agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={data.paused ? "caution" : "positive"}>{data.paused ? "paused" : "running"}</Badge>
            <Button
              variant="secondary"
              disabled={busy || !data.canManage}
              onClick={() => void toggle(!data.paused)}
            >
              {data.paused ? <PlayCircle /> : <PauseCircle />}
              {data.paused ? "Resume Outreach" : "Pause Outreach"}
            </Button>
            {!data.canManage && <span className="text-xs text-steel">Only an owner or admin can change this.</span>}
          </div>
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Integration status</CardTitle>
          <CardDescription>Server-reported. Secret values are never shown here.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-hairline text-sm">
            {data.readiness.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-bone">{r.label}</span>
                <span className="text-xs text-steel">{r.state}: {r.detail}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
