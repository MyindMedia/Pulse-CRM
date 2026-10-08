"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, Link2, Lock, MailCheck, PauseCircle,
  PlayCircle, ShieldAlert, Users, XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import type { Id } from "@convex/_generated/dataModel";
import { ZuopsBookings, ZuopsCalendar } from "./outreach-zuops";
import { CallControls, CallsList } from "./outreach-calls";

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

export function TestOnlyBanner({ paused, mode = "test_only" }: { paused: boolean; mode?: "test_only" | "live" }) {
  if (mode === "live") {
    return (
      <div role="status" className="flex items-start gap-3 rounded-lg border border-positive/30 bg-positive/10 px-4 py-3 text-sm text-bone">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
        <p>
          <strong className="font-semibold">Live sending is on.</strong>{paused ? " Outreach is paused, so nothing will go out." : ""} Each email
          still needs your approval and your Send click. Automatic calls and SMS stay off.
        </p>
      </div>
    );
  }
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
  const checkStatuses = useMutation(api.outreachSend.checkStatuses);
  const [checkMsg, setCheckMsg] = React.useState<string | null>(null);
  if (rows === undefined || templates === undefined) return <LoadingPanel label="Loading messages" />;
  if (rows === null || templates === null) return <Unauthorized />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => { setCheckMsg(null); void checkStatuses({}).then(() => setCheckMsg("Asked the email provider. Refresh in a few seconds.")).catch(() => setCheckMsg("Could not check right now.")); }}>
          Check delivery status
        </Button>
        {checkMsg && <span role="status" className="text-xs text-steel">{checkMsg}</span>}
      </div>
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
                  No messages recorded yet. Approved emails are sent from the Review queue.
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
  const cal = useQuery(api.outreachCalendar.snapshot, {});
  if (data === undefined || cal === undefined) return <LoadingPanel label="Loading meetings" />;
  if (data === null || cal === null) return <Unauthorized />;
  const upcoming = cal.appointments.length > 0 && (
    <Card>
      <CardHeader>
        <CardTitle>Older bookings on the {cal.calendar?.name ?? "GoHighLevel"} calendar</CardTitle>
        <CardDescription>From the old GoHighLevel calendar{cal.fetchedAt ? `, read ${when(cal.fetchedAt)}` : ""}. New bookings are taken on the Zuops calendar at the booking link and are not read into Pulse yet. A booking is not a call: calling stays off.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-hairline text-sm">
          {cal.appointments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-bone">{a.contactName ?? a.title} <span className="text-xs text-steel/70">{a.title}</span></span>
              <span className="text-xs text-steel">{when(a.start)} <Badge tone={a.status === "cancelled" ? "critical" : "info"}>{a.status}</Badge></span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
  if (!data.mapped && upcoming) return <div className="space-y-4"><ZuopsBookings /><CallsList />{upcoming}</div>;
  if (!data.mapped) return <div className="space-y-4"><ZuopsBookings /><CallsList /></div>;
  if (data.rows.length === 0) {
    return upcoming
      ? <div className="space-y-4"><ZuopsBookings /><CallsList />{upcoming}</div>
      : <div className="space-y-4"><CallsList /><EmptyState icon={CalendarClock} title="No older appointments" description="Nothing is booked on the old GoHighLevel calendar. New bookings are taken on the Zuops calendar at studiopulse.tech/demo." /></div>;
  }
  return (
    <div className="space-y-3">
      <ZuopsBookings />
      <CallsList />
      {upcoming}
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

function CalendarLive() {
  const cal = useQuery(api.outreachCalendar.snapshot, {});
  const refresh = useMutation(api.outreachCalendar.refresh);
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  if (cal === undefined) return <LoadingPanel label="Loading calendar" />;
  if (cal === null) return <Unauthorized />;
  if (!cal.mapped) return null;
  const open = cal.slots.reduce((n, d) => n + d.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Older GoHighLevel calendar</CardTitle>
        <CardDescription>No longer used for bookings, kept for history. New bookings are taken on the Zuops calendar at the booking link. Nothing here changes either calendar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {cal.calendar ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Calendar" value={cal.calendar.name} />
            <Field label="Status" value={<Badge tone={cal.calendar.active ? "positive" : "critical"}>{cal.calendar.active ? "active" : "inactive"}</Badge>} />
            <Field label="Meeting length" value={cal.calendar.durationMin ? `${cal.calendar.durationMin} minutes` : "Not set"} />
            <Field label="Open slots, next 7 days" value={`${open} across ${cal.slots.length} day(s)`} />
          </dl>
        ) : (
          <p className="text-sm text-steel">{cal.keyConfigured ? "Not read yet. Use Refresh." : "The GHL key is not configured on the server."}</p>
        )}
        {cal.slots.length > 0 && (
          <p className="text-xs text-steel/70">{cal.slots.map((d) => `${d.date}: ${d.count}`).join(" · ")}</p>
        )}
        {cal.ok === false && <p role="alert" className="text-sm text-critical">Last refresh failed: {cal.error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!cal.canManage || !cal.keyConfigured}
            onClick={() => { setErr(null); setMsg(null); void refresh({}).then(() => setMsg("Refreshing from GoHighLevel. Reload this tab in a few seconds.")).catch((e: unknown) => setErr(e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught (Convex)?Error:?\s*/, "").slice(0, 160) : "Could not refresh.")); }}>
            Refresh from GoHighLevel
          </Button>
          {cal.fetchedAt && <span className="text-xs text-steel/70">Last read {when(cal.fetchedAt)}</span>}
        </div>
        {msg && <p role="status" className="text-sm text-positive">{msg}</p>}
        {err && <p role="alert" className="text-sm text-critical">{err}</p>}
      </CardContent>
    </Card>
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
    <div className="space-y-4">
    <ZuopsCalendar />
    <CalendarLive />
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
            <Field label="Booking link (Zuops calendar)" value={data.bookingUrl ?? "Not set"} />
            <Field label="GoHighLevel calendar (older)" value={data.calendarId ?? "Not set"} />
            <Field label="GoHighLevel location (older)" value={data.locationId ?? "Not set"} />
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
  const setLive = useMutation(api.outreach.setLive);
  const [liveText, setLiveText] = React.useState("");
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
          <CardTitle>Live sending</CardTitle>
          <CardDescription>
            Off by default. Turning it on does not send anything: each email still needs its own approval and its own Send click.
            Only the agency owner can change this.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={data.mode === "live" ? "positive" : "neutral"}>{data.mode === "live" ? "live sending on" : "live sending off"}</Badge>
            {data.mode === "live" && (
              <Button variant="secondary" disabled={busy || !data.isOwner} onClick={() => void (async () => { setBusy(true); setError(null); try { await setLive({ enabled: false }); } catch (e) { setError(e instanceof Error ? e.message : "Could not change live sending."); } finally { setBusy(false); } })()}>
                Turn live sending off
              </Button>
            )}
          </div>
          {data.mode !== "live" && (
            data.liveBlockers.length > 0 ? (
              <div className="text-sm text-steel">
                <p>Not ready to turn on:</p>
                <ul className="list-disc pl-5">{data.liveBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="live-confirm" className="text-sm text-steel">Type SEND to turn live sending on</label>
                <input id="live-confirm" value={liveText} onChange={(e) => setLiveText(e.target.value)} disabled={!data.isOwner}
                  className="w-28 rounded border border-graphite/60 bg-obsidian px-3 py-2 text-sm text-bone" />
                <Button variant="primary" disabled={busy || !data.isOwner || liveText !== "SEND"} onClick={() => void (async () => { setBusy(true); setError(null); try { await setLive({ enabled: true, confirm: liveText }); setLiveText(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not change live sending."); } finally { setBusy(false); } })()}>
                  Turn live sending on
                </Button>
              </div>
            )
          )}
          {!data.isOwner && <p className="text-xs text-steel">Only the agency owner can change this.</p>}
        </CardContent>
      </Card>
      <CallControls />
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

/* -------------------------------- Prospects -------------------------------- */

const PROSPECT_STATUS: Record<string, { tone: Tone; meaning: string }> = {
  needs_website: { tone: "caution", meaning: "Waiting for you to confirm the studio's website. A guessed site is never used." },
  ready_to_scrape: { tone: "info", meaning: "Website confirmed. Ready to read its public pages." },
  scraping: { tone: "info", meaning: "Reading the studio's public pages now." },
  scraped: { tone: "positive", meaning: "Published contact info found. Not verified." },
  no_contact: { tone: "caution", meaning: "No published email on the pages read." },
  blocked: { tone: "critical", meaning: "The site's robots.txt disallows reading it, or the address is not a public website." },
  unreachable: { tone: "caution", meaning: "The site could not be reached. Check the address, then try again." },
  queued: { tone: "positive", meaning: "In the review queue. Nothing has been sent." },
  suppressed: { tone: "caution", meaning: "Every address has opted out. Will not be contacted." },
};

function hostName(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function Prospects() {
  const data = useQuery(api.outreachProspects.list, {});
  const add = useMutation(api.outreachProspects.add);
  const setWebsite = useMutation(api.outreachProspects.setWebsite);
  const requestScrape = useMutation(api.outreachProspects.requestScrape);
  const queue = useMutation(api.outreachProspects.queueForReview);
  const suppress = useMutation(api.outreachProspects.suppressEmail);
  const remove = useMutation(api.outreachProspects.remove);
  const prepare = useMutation(api.outreachDrafts.prepare);
  const [text, setText] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [sites, setSites] = React.useState<Record<string, string>>({});
  const [prep, setPrep] = React.useState<Record<string, { email?: string; sig?: "original" | "static" | "image" | "animated"; routing?: boolean }>>({});

  if (data === undefined) return <LoadingPanel label="Loading prospects" />;
  if (data === null) return <Unauthorized />;
  const manage = data.canManage;

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught (Convex)?Error:?\s*/, "").slice(0, 200) : "Something went wrong.");
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add studios</CardTitle>
          <CardDescription>
            Paste Instagram handles, Instagram links or websites, one per line. Contact info is what the studio
            published itself: on its website, its Google Maps listing, or (on request) its own Instagram profile. It is
            published, not verified. Nothing is emailed from here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="prospect-lines" className="sr-only">Handles, links or websites</label>
          <textarea
            id="prospect-lines"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            disabled={!manage}
            placeholder={"@icecreamsound\nhttps://instagram.com/mixrecordingstudio\nunionrecordingstudio.com"}
            className="w-full rounded border border-graphite/60 bg-obsidian px-3 py-2 text-sm text-bone placeholder:text-steel/50"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={!manage || text.trim() === ""}
              onClick={() => void run(async () => {
                const r = await add({ lines: text.split("\n") });
                setText("");
                setMsg(`${r.added} added, ${r.duplicates} already on the list, ${r.invalid} not recognised.`);
              })}
            >
              Add to list
            </Button>
            {!manage && <span className="text-xs text-steel">Only an owner or admin can add or change prospects.</span>}
          </div>
          {msg && <p role="status" className="text-sm text-positive">{msg}</p>}
          {err && <p role="alert" className="text-sm text-critical">{err}</p>}
        </CardContent>
      </Card>

      {data.rows.length === 0 ? (
        <EmptyState icon={Users} title="No prospects yet" description="Paste a few handles or websites above to start a list." />
      ) : (
        <ul className="space-y-3">
          {data.rows.map((p) => {
            const st = PROSPECT_STATUS[p.status] ?? { tone: "neutral" as Tone, meaning: "" };
            const title = p.name ?? (p.handle ? `@${p.handle}` : p.websiteUrl ? hostName(p.websiteUrl) : "Link");
            return (
              <li key={p.id}>
                <Card>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-grotesk text-sm font-semibold text-bone">{title}</p>
                        <p className="text-xs text-steel/70">
                          {p.handle ? `@${p.handle} · ` : ""}{p.websiteUrl ? hostName(p.websiteUrl) : "no website yet"} · added via {p.source}
                        </p>
                      </div>
                      <div className="space-y-1 text-right">
                        <Badge tone={st.tone}>{p.status.replace("_", " ")}</Badge>
                        {p.bookedAt && <Badge tone="positive">Booked a demo {new Date(p.bookedAt).toLocaleDateString()}</Badge>}
                        <p className="max-w-xs text-xs text-steel/70">{p.note ?? st.meaning}</p>
                      </div>
                    </div>

                    {(p.status === "needs_website" || p.status === "unreachable") && manage && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`site-${p.id}`} className="sr-only">Confirm website for {title}</label>
                        <input
                          id={`site-${p.id}`}
                          value={sites[p.id] ?? ""}
                          onChange={(e) => setSites((s) => ({ ...s, [p.id]: e.target.value }))}
                          placeholder="studio-website.com"
                          className="min-w-0 flex-1 rounded border border-graphite/60 bg-obsidian px-3 py-2 text-sm text-bone"
                        />
                        <Button
                          variant="secondary"
                          disabled={!(sites[p.id] ?? "").trim()}
                          onClick={() => void run(() => setWebsite({ id: p.id as Id<"outreachProspects">, url: sites[p.id] }), "Website confirmed.")}
                        >
                          Confirm website
                        </Button>
                      </div>
                    )}

                    {p.contacts && (
                      <div className="grid gap-3 rounded-md border border-graphite/40 bg-coal/40 p-3 text-xs sm:grid-cols-2">
                        <div className="space-y-1">
                          <p className="font-meta uppercase tracking-wide text-steel/70">Emails (published, not verified)</p>
                          {p.contacts.emails.length === 0 ? <p className="text-steel">None found.</p> : (
                            <ul className="space-y-1">
                              {p.contacts.emails.map((e) => (
                                <li key={e.address} className="flex flex-wrap items-center gap-2 text-bone">
                                  <span className="break-all">{e.address}</span>
                                  {e.generic && <Badge tone="caution">generic inbox</Badge>}
                                  {e.suppressed && <Badge tone="critical">opted out</Badge>}
                                  <span className="text-steel/60">from {hostName(e.sourceUrl)}</span>
                                  {manage && !e.suppressed && (
                                    <button
                                      type="button"
                                      className="text-steel underline hover:text-bone"
                                      onClick={() => void run(() => suppress({ email: e.address, reason: "opt-out" }), `${e.address} will not be contacted.`)}
                                    >
                                      mark opted out
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                          {p.contacts.emails.some((e) => e.generic) && (
                            <p className="text-steel/70">A generic inbox is not a confirmed decision-maker. Confirm routing before pitching.</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="font-meta uppercase tracking-wide text-steel/70">Phones, social, booking</p>
                          <p className="text-bone">{p.contacts.phones.map((x) => x.number).join(", ") || "No phone found."}</p>
                          <p className="break-all text-steel">{p.contacts.socials.map((x) => `${x.platform}: ${x.url.replace("https://", "")}`).join(" · ") || "No social links."}</p>
                          <p className="text-steel">{p.contacts.booking.length ? `Booking: ${p.contacts.booking.join(", ")}` : "No booking platform detected."}</p>
                          <p className="text-steel/60">Read {when(p.contacts.scrapedAt)}</p>
                        </div>
                      </div>
                    )}

                    {p.status === "queued" && manage && p.contacts && (() => {
                      const open = p.contacts.emails.filter((e) => !e.suppressed);
                      const cur = prep[p.id] ?? {};
                      const chosen = open.find((e) => e.address === (cur.email ?? open[0]?.address));
                      return (
                        <div className="space-y-2 rounded-md border border-graphite/40 bg-coal/40 p-3 text-xs">
                          <p className="font-meta uppercase tracking-wide text-steel/70">Prepare the email</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor={`to-${p.id}`} className="text-steel">To</label>
                            <select id={`to-${p.id}`} value={chosen?.address ?? ""} onChange={(e) => setPrep((m) => ({ ...m, [p.id]: { ...cur, email: e.target.value } }))}
                              className="rounded border border-graphite/60 bg-obsidian px-2 py-1 text-bone">
                              {open.map((e) => <option key={e.address} value={e.address}>{e.address}</option>)}
                            </select>
                            <label htmlFor={`from-${p.id}`} className="text-steel">From</label>
                            <select id={`from-${p.id}`} defaultValue="maxb" className="rounded border border-graphite/60 bg-obsidian px-2 py-1 text-bone">
                              <option value="maxb">MaxB | Pulse (Roverto signature)</option>
                              <option value="lawrence" disabled>Lawrence (no approved copy yet)</option>
                            </select>
                            <label htmlFor={`sig-${p.id}`} className="text-steel">Signature</label>
                            <select id={`sig-${p.id}`} value={cur.sig ?? "image"} onChange={(e) => setPrep((m) => ({ ...m, [p.id]: { ...cur, sig: e.target.value as "original" | "static" | "image" | "animated" } }))}
                              className="rounded border border-graphite/60 bg-obsidian px-2 py-1 text-bone">
                              <option value="image">Exact picture of your Final signature (recommended)</option>
                              <option value="animated">Animated GIF (needs the site deployed first)</option>
                              <option value="original">Your HTML file as-is (breaks in Gmail)</option>
                              <option value="static">Email-safe rebuild</option>
                            </select>
                          </div>
                          {chosen?.generic && (
                            <label className="flex items-start gap-2 text-steel">
                              <input type="checkbox" checked={!!cur.routing} onChange={(e) => setPrep((m) => ({ ...m, [p.id]: { ...cur, routing: e.target.checked } }))} className="mt-0.5" />
                              <span>This is a generic inbox. I have confirmed who handles studio operations.</span>
                            </label>
                          )}
                          <Button
                            variant="secondary"
                            disabled={!chosen}
                            onClick={() => void run(() => prepare({
                              prospectId: p.id as Id<"outreachProspects">, email: chosen!.address, persona: "maxb",
                              templateKey: "maxb_system", signatureMode: cur.sig ?? "image", routingConfirmed: !!cur.routing,
                            }), "Draft prepared. Open the Review queue tab to preview it. Nothing was sent.")}
                          >
                            Prepare email
                          </Button>
                        </div>
                      );
                    })()}

                    {manage && (
                      <div className="flex flex-wrap gap-2">
                        {["ready_to_scrape", "no_contact", "blocked", "unreachable", "scraped"].includes(p.status) && p.websiteUrl && (
                          <Button variant="secondary" onClick={() => void run(() => requestScrape({ id: p.id as Id<"outreachProspects"> }), "Reading the site now.")}>
                            {p.status === "ready_to_scrape" ? "Find contact info" : "Read again"}
                          </Button>
                        )}
                        {p.status === "scraped" && (
                          <Button variant="primary" onClick={() => void run(() => queue({ id: p.id as Id<"outreachProspects"> }), "Added to the review queue. Nothing was sent.")}>
                            Queue for review
                          </Button>
                        )}
                        <Button variant="ghost" onClick={() => void run(() => remove({ id: p.id as Id<"outreachProspects"> }), "Removed.")}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {data.suppressedCount > 0 && (
        <p className="text-xs text-steel">{data.suppressedCount} address(es) are on the opt-out list and will never be queued.</p>
      )}
    </div>
  );
}

/* ------------------------------- Review queue ------------------------------- */

const DRAFT_TONE: Record<string, Tone> = {
  draft: "info", hold: "caution", approved: "positive", expired: "caution", cancelled: "neutral", sending: "info", sent: "positive",
};

function DraftPreview({ id }: { id: Id<"outreachDrafts"> }) {
  const p = useQuery(api.outreachDrafts.preview, { id });
  if (p === undefined) return <LoadingPanel label="Loading preview" />;
  if (p === null) return <Unauthorized />;
  return (
    <div className="space-y-3">
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <Field label="From" value={p.from} />
        <Field label="To (only recipient)" value={p.to} />
        <Field label="Subject" value={p.subject} />
        <Field label="Links in this email" value={<ul className="space-y-0.5">{p.links.map((l) => <li key={l}>{l}</li>)}</ul>} />
      </dl>
      {p.signatureMode === "original" && (
        <p role="note" className="rounded border border-caution/30 bg-caution/10 px-3 py-2 text-xs text-bone">
          This preview shows your original signature HTML as a browser draws it. Gmail and Outlook remove its CSS and
          animation, so it can look broken there. Send an owner test and check it in Gmail before approving, or switch
          the draft to the email-safe signature.
        </p>
      )}
      <iframe title="Email preview" sandbox="" srcDoc={p.html} className="h-[32rem] w-full rounded border border-graphite/60 bg-white" />
      <details className="text-xs text-steel">
        <summary className="cursor-pointer">Plain-text version</summary>
        <pre className="mt-2 whitespace-pre-wrap">{p.text}</pre>
      </details>
    </div>
  );
}

export function Drafts() {
  const data = useQuery(api.outreachDrafts.list, {});
  const approve = useMutation(api.outreachDrafts.approve);
  const cancel = useMutation(api.outreachDrafts.cancel);
  const send = useMutation(api.outreachSend.send);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  if (data === undefined) return <LoadingPanel label="Loading review queue" />;
  if (data === null) return <Unauthorized />;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught (Convex)?Error:?\s*/, "").slice(0, 200) : "Something went wrong.");
    }
  }
  const gatesOk = data.gates.postalAddress && data.gates.ownerTestConfirmed;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Before anything can be approved</CardTitle>
          <CardDescription>Approval is tied to the exact email and expires in 24 hours. Approving does not send: each approved email is sent with its own Send click, and only while live sending is on.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Badge tone={data.gates.postalAddress ? "positive" : "caution"}>postal address {data.gates.postalAddress ? "set" : "missing"}</Badge>
          <Badge tone={data.gates.ownerTestConfirmed ? "positive" : "caution"}>owner test {data.gates.ownerTestConfirmed ? "confirmed" : "not confirmed"}</Badge>
          <Badge tone={data.gates.live ? "positive" : "neutral"}>live sending {data.gates.live ? "on" : "off"}</Badge>
        </CardContent>
      </Card>
      {msg && <p role="status" className="text-sm text-positive">{msg}</p>}
      {err && <p role="alert" className="text-sm text-critical">{err}</p>}
      {data.rows.length === 0 ? (
        <EmptyState icon={MailCheck} title="No drafts yet" description="Queue a prospect, then use Prepare email on its card in the Prospects tab." />
      ) : (
        <ul className="space-y-3">
          {data.rows.map((d) => (
            <li key={d.id}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-grotesk text-sm font-semibold text-bone">{d.studio}</p>
                      <p className="text-xs text-steel">To {d.recipient} · from {d.from}</p>
                      <p className="text-xs text-steel/70">{d.subject} · {({ original: "original signature", image: "signature as picture", animated: "animated signature", static: "email-safe signature" } as Record<string, string>)[d.signatureMode]}</p>
                    </div>
                    <div className="space-y-1 text-right">
                      <Badge tone={DRAFT_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                      {d.holdReason && <p className="max-w-xs text-xs text-caution">{d.holdReason}</p>}
                      {d.status === "expired" && <p className="text-xs text-steel/70">Approval expired. Prepare it again.</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setOpen(open === d.id ? null : d.id)}>
                      {open === d.id ? "Hide preview" : "Preview"}
                    </Button>
                    {data.canManage && d.status === "draft" && (
                      <Button variant="primary" disabled={!gatesOk} onClick={() => void run(() => approve({ id: d.id as Id<"outreachDrafts"> }), "Approved for this exact email. Nothing was sent.")}>
                        Approve this email
                      </Button>
                    )}
                    {data.canManage && d.status === "approved" && (
                      data.gates.live ? (
                        confirming === d.id ? (
                          <>
                            <Button variant="primary" onClick={() => { setConfirming(null); void run(() => send({ id: d.id as Id<"outreachDrafts"> }), `Sending to ${d.recipient}. Check the Communications tab for the result.`); }}>
                              Confirm: send to {d.recipient}
                            </Button>
                            <Button variant="ghost" onClick={() => setConfirming(null)}>Not yet</Button>
                          </>
                        ) : (
                          <Button variant="primary" onClick={() => setConfirming(d.id)}>Send now</Button>
                        )
                      ) : (
                        <span className="self-center text-xs text-steel">Sending is off. An owner can turn it on in Settings.</span>
                      )
                    )}
                    {data.canManage && !["cancelled", "approved", "sending", "sent"].includes(d.status) && (
                      <Button variant="ghost" onClick={() => void run(() => cancel({ id: d.id as Id<"outreachDrafts"> }), "Draft cancelled.")}>Cancel</Button>
                    )}
                  </div>
                  {d.status === "draft" && !gatesOk && (
                    <p className="text-xs text-steel">Approve is off until the postal address is set and an owner test is confirmed.</p>
                  )}
                  {open === d.id && <DraftPreview id={d.id as Id<"outreachDrafts">} />}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
