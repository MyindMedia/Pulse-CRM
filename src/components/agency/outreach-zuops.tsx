"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";

/* The Zuops booking calendar behind studiopulse.tech/demo, read only. Bookings are
   mirrored from Zuops by a signed webhook and a 15 minute sync; nothing here changes
   the calendar. Every status carries text, not colour alone. */

type Tone = "neutral" | "positive" | "caution" | "critical" | "info";
const STATUS_TONE: Record<string, Tone> = { confirmed: "info", completed: "positive", cancelled: "critical", no_show: "caution", other: "neutral" };
const DAY_ORDER: Array<[string, string]> = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];

const when = (ms: number, tz?: string | null) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz, timeZoneName: "short" } : {}) });

function Consent({ label, value }: { label: string; value: boolean | null }) {
  return <Badge tone={value === true ? "positive" : value === false ? "caution" : "neutral"}>{label}: {value === true ? "yes" : value === false ? "no" : "not asked"}</Badge>;
}

type Row = {
  id: string; title: string; startsAt: number; endsAt: number; timezone: string | null; status: string;
  contactName: string | null; contactEmail: string | null; location: string | null;
  consent: { sms: boolean | null; call: boolean | null; email: boolean | null }; prospect: string | null;
};

function BookingRow({ b }: { b: Row }) {
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-bone">{b.contactName ?? b.title} {b.contactEmail && <span className="text-xs text-steel/70">{b.contactEmail}</span>}</span>
        <span className="text-xs text-steel">{when(b.startsAt, b.timezone)} <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>{b.status.replace("_", " ")}</Badge></span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {b.prospect && <Badge tone="positive"><CheckCircle2 className="size-3" aria-hidden /> Matched prospect: {b.prospect}</Badge>}
        <Consent label="Email marketing" value={b.consent.email} />
        <Consent label="SMS marketing" value={b.consent.sms} />
        <Consent label="Automated call" value={b.consent.call} />
        {b.location && <span className="text-xs text-steel/70">{b.location}</span>}
      </div>
    </li>
  );
}

export function ZuopsBookings() {
  const data = useQuery(api.outreachZuops.bookings, {});
  if (data === undefined) return <LoadingPanel label="Loading Zuops bookings" />;
  if (data === null) return null;
  if (!data.mapped) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Zuops calendar not connected"
        description="Prospects book at studiopulse.tech/demo on the Zuops calendar. An operator needs to map that Zuops workspace and calendar to this agency before bookings appear here."
      />
    );
  }
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Upcoming demos</CardTitle>
          <CardDescription>Booked on the Zuops calendar at studiopulse.tech/demo. The consent answers are what each person ticked on the form. A booking is not a call: calling stays off.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.upcoming.length === 0
            ? <p className="text-sm text-steel">No upcoming demos. New bookings appear within a few seconds of being made.</p>
            : <ul className="divide-y divide-hairline">{data.upcoming.map((b) => <BookingRow key={b.id} b={b as Row} />)}</ul>}
        </CardContent>
      </Card>
      {data.past.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent and cancelled</CardTitle></CardHeader>
          <CardContent><ul className="divide-y divide-hairline">{data.past.map((b) => <BookingRow key={b.id} b={b as Row} />)}</ul></CardContent>
        </Card>
      )}
    </div>
  );
}

export function ZuopsCalendar() {
  const s = useQuery(api.outreachZuops.snapshot, {});
  const refresh = useMutation(api.outreachZuops.refresh);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  if (s === undefined) return <LoadingPanel label="Loading Zuops calendar" />;
  if (s === null) return null;
  const c = s.calendar;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Zuops booking calendar</CardTitle>
        <CardDescription>The calendar prospects book on from studiopulse.tech/demo. Read only: change hours and hosts in Zuops.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {!s.mapped ? <Badge tone="caution">not mapped</Badge>
            : s.ok === false ? <Badge tone="critical"><XCircle className="size-3" aria-hidden /> sync failing</Badge>
            : s.ok ? <Badge tone="positive"><CheckCircle2 className="size-3" aria-hidden /> syncing</Badge>
            : <Badge tone="neutral">not synced yet</Badge>}
          <Badge tone={s.webhookConfigured ? "positive" : "caution"}>live updates: {s.webhookConfigured ? "on" : "off (checks every 5 minutes)"}</Badge>
          {s.fetchedAt && <span className="text-xs text-steel/70">Last read {new Date(s.fetchedAt).toLocaleString()} · {s.bookingCount} booking(s)</span>}
        </div>
        {s.error && <p role="alert" className="text-sm text-critical">{s.error}</p>}
        {!s.keyConfigured && <p className="text-xs text-caution">The Zuops key is not set on this deployment.</p>}
        {c ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-steel/70">Calendar</dt><dd className="text-bone">{c.name}{!c.active && <> <Badge tone="critical">inactive</Badge></>}</dd></div>
            <div><dt className="text-xs text-steel/70">Booking link</dt><dd className="text-bone">{s.bookingUrl ?? "Not set"}</dd></div>
            <div><dt className="text-xs text-steel/70">Meeting</dt><dd className="text-bone">{c.durationMin} minutes, {c.bufferMin} minute buffer{c.locationLabel ? `, ${c.locationLabel}` : ""}</dd></div>
            <div><dt className="text-xs text-steel/70">Booking window</dt><dd className="text-bone">At least {Math.round(c.minNoticeMin / 60)} hours ahead, up to {c.maxDaysAhead} days out</dd></div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-steel/70">Weekly hours{c.timezone ? ` (${c.timezone})` : ""}</dt>
              <dd className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-bone">
                {DAY_ORDER.map(([k, label]) => <span key={k}>{label} {c.hours[k]?.length ? c.hours[k].join(", ") : <span className="text-steel/60">off</span>}</span>)}
              </dd>
            </div>
          </dl>
        ) : <p className="text-sm text-steel">{s.mapped ? "Not read yet. Use Refresh." : "An operator maps the Zuops workspace and calendar to this agency."}</p>}
        {s.canManage && s.mapped && (
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => { setErr(null); setMsg(null); void refresh({}).then(() => setMsg("Refreshing from Zuops. Reload in a few seconds.")).catch((e: unknown) => setErr(e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught (Convex)?Error:?\s*/, "").slice(0, 160) : "Could not refresh.")); }}>
              Refresh from Zuops
            </Button>
            {msg && <span role="status" className="text-sm text-positive">{msg}</span>}
            {err && <span role="alert" className="text-sm text-critical">{err}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
