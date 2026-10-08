"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AlertTriangle, PhoneCall01, PhoneHangUp } from "@untitledui/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";

/* Confirmation calls: the automated Bland call that confirms a booked demo.
   Controls live in Settings, the list in Meetings. Every status carries text, not
   colour alone. The phone number only ever arrives masked. */

type Tone = "neutral" | "positive" | "caution" | "critical" | "info";
const STATUS_TONE: Record<string, Tone> = {
  queued: "info", dry_run: "neutral", dialing: "info", completed: "positive", failed: "critical", skipped: "caution", cancelled: "critical",
};
const STATUS_MEANING: Record<string, string> = {
  queued: "Waiting for its turn", dry_run: "Dry run: nothing was dialed", dialing: "Dialed, waiting for the result",
  completed: "Call finished", failed: "The call did not go through", skipped: "Will not be called", cancelled: "Booking was cancelled",
};
const REASON: Record<string, string> = {
  no_consent: "no consent to an automated call", not_confirmed: "booking is not confirmed", predates_enable: "booked before calls were turned on",
  opted_out: "asked not to be called", suppressed: "on the suppression list", test_booking: "looks like a test booking",
  too_close: "the demo is too close to call", invalid_phone: "not a valid US number", no_phone: "no phone number yet",
  not_due: "not due yet", outside_window: "outside the calling window, will retry", daily_cap: "daily cap reached, will retry",
  awaiting_lead: "waiting for the booking details", booking_cancelled: "booking was cancelled", script_unapproved: "script not approved in code yet",
  bland_key_missing: "BLAND_API_KEY is not set", webhook_not_configured: "BLAND_WEBHOOK_SECRET is not set", run_limit: "too many calls this minute, will retry",
  consent_revoked: "consent was withdrawn before dialing", consent_recheck_unavailable: "could not re-check consent, will retry",
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const when = (ms: number, tz?: string | null) =>
  new Date(ms).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz, timeZoneName: "short" } : {}) });

const inputCls = "rounded border border-graphite/60 bg-obsidian px-3 py-2 text-sm text-bone";

export function CallControls() {
  const data = useQuery(api.outreachCalls.callSettings, {});
  const save = useMutation(api.outreachCalls.setCallSettings);
  const kill = useMutation(api.outreachCalls.setKillSwitch);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null);
  const [confirm, setConfirm] = React.useState("");
  if (data === undefined) return <LoadingPanel label="Loading confirmation calls" />;
  if (data === null) return null;
  const s = data.settings;
  const can = data.isOwner;
  const val = (k: string, d: string | number) => draft?.[k] ?? String(d);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...(draft ?? {}), [k]: e.target.value });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? (/Uncaught (?:Access)?Error: ([^\n]*)/.exec(e.message)?.[1] ?? e.message.split("\n")[0]) : "Could not save."); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirmation calls</CardTitle>
        <CardDescription>
          An AI assistant phones a person who booked a demo and consented to an automated call, to confirm the time. Off by default and in dry run:
          a dry run records what would be sent and dials no one. Only the agency owner can change this; an owner or admin can stop it at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={s.killSwitch ? "critical" : s.enabled ? "positive" : "neutral"}>{s.killSwitch ? "kill switch on" : s.enabled ? "on" : "off"}</Badge>
          <Badge tone={s.mode === "live" ? "caution" : "info"}>{s.mode === "live" ? "live: dials real people" : "dry run: dials no one"}</Badge>
          <Button variant="secondary" disabled={busy || !can} onClick={() => void run(() => save({ enabled: !s.enabled }))}>
            <PhoneCall01 aria-hidden /> {s.enabled ? "Turn off" : "Turn on"}
          </Button>
          <Button variant={s.killSwitch ? "secondary" : "primary"} disabled={busy || !data.canManage || (s.killSwitch && !can)} onClick={() => void run(() => kill({ on: !s.killSwitch }))}>
            <PhoneHangUp aria-hidden /> {s.killSwitch ? "Lift kill switch" : "Kill switch: stop all calls"}
          </Button>
          {!can && <span className="text-xs text-steel">Only the agency owner can change settings.</span>}
        </div>

        <ul className="space-y-1 text-xs text-steel">
          <li>Bland key: {data.blandKeyConfigured ? "set" : "not set"}. Result webhook secret: {data.webhookConfigured ? "set" : "not set"}. Script approved in code: {data.scriptApproved ? "yes" : "no"}.</li>
          {s.mode === "live" && data.blockers.length > 0 && (
            <li className="flex items-center gap-1 text-caution"><AlertTriangle className="size-3.5" aria-hidden /> Live calls are held until: {data.blockers.map((b) => REASON[b] ?? b).join("; ")}.</li>
          )}
        </ul>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs text-steel">Call this many minutes after booking (1 to 120)
            <input className={`${inputCls} w-full`} type="number" min={1} max={120} value={val("delayMinutes", s.delayMinutes)} onChange={set("delayMinutes")} disabled={!can} /></label>
          <label className="space-y-1 text-xs text-steel">Daily cap (every dialed call)
            <input className={`${inputCls} w-full`} type="number" min={1} max={100} value={val("dailyCap", s.dailyCap)} onChange={set("dailyCap")} disabled={!can} /></label>
          <label className="space-y-1 text-xs text-steel">Longest call (minutes)
            <input className={`${inputCls} w-full`} type="number" min={1} max={15} value={val("maxDurationMinutes", s.maxDurationMinutes)} onChange={set("maxDurationMinutes")} disabled={!can} /></label>
          <label className="space-y-1 text-xs text-steel">Window opens (their local time)
            <input className={`${inputCls} w-full`} type="time" value={val("windowStart", s.windowStart)} onChange={set("windowStart")} disabled={!can} /></label>
          <label className="space-y-1 text-xs text-steel">Window closes
            <input className={`${inputCls} w-full`} type="time" value={val("windowEnd", s.windowEnd)} onChange={set("windowEnd")} disabled={!can} /></label>
          <label className="space-y-1 text-xs text-steel">Default time zone
            <input className={`${inputCls} w-full`} value={val("timezone", s.timezone)} onChange={set("timezone")} disabled={!can} /></label>
          <label className="space-y-1 text-xs text-steel">Call from number
            <input className={`${inputCls} w-full`} value={val("fromNumber", s.fromNumber)} onChange={set("fromNumber")} disabled={!can} /></label>
        </div>
        <p className="text-xs text-steel">Calling days: {s.windowDays.length === 7 ? "every day" : s.windowDays.map((d) => DAYS[d]).join(", ")}. The window uses the booking&apos;s own time zone when it has one.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={busy || !can || !draft} onClick={() => void run(async () => {
            const d = draft ?? {};
            await save({
              ...(d.delayMinutes !== undefined && { delayMinutes: Number(d.delayMinutes) }),
              ...(d.dailyCap !== undefined && { dailyCap: Number(d.dailyCap) }),
              ...(d.maxDurationMinutes !== undefined && { maxDurationMinutes: Number(d.maxDurationMinutes) }),
              ...(d.windowStart !== undefined && { windowStart: d.windowStart }),
              ...(d.windowEnd !== undefined && { windowEnd: d.windowEnd }),
              ...(d.timezone !== undefined && { timezone: d.timezone.trim() }),
              ...(d.fromNumber !== undefined && { fromNumber: d.fromNumber.trim() }),
            });
            setDraft(null);
          })}>Save changes</Button>
        </div>

        <div className="space-y-2 border-t border-hairline pt-3">
          <p className="text-sm text-bone">Mode</p>
          {s.mode === "live" ? (
            <Button variant="secondary" disabled={busy || !can} onClick={() => void run(() => save({ mode: "dry_run" }))}>Back to dry run</Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="call-live-confirm" className="text-sm text-steel">Type CALL to start dialing real people</label>
              <input id="call-live-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={!can || !s.enabled} className={`${inputCls} w-28`} />
              <Button variant="primary" disabled={busy || !can || !s.enabled || confirm !== "CALL"} onClick={() => void run(async () => { await save({ mode: "live", confirm }); setConfirm(""); })}>Go live</Button>
              {!s.enabled && <span className="text-xs text-steel">Turn confirmation calls on first.</span>}
            </div>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function CallsList() {
  const rows = useQuery(api.outreachCalls.calls, {});
  if (rows === undefined) return <LoadingPanel label="Loading confirmation calls" />;
  if (rows === null) return null;
  if (rows.length === 0) {
    return <EmptyState icon={PhoneCall01} title="No confirmation calls yet" description="Calls appear here once confirmation calls are turned on in Settings and a booking comes in." />;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirmation calls</CardTitle>
        <CardDescription>One row per booking. In a dry run you see exactly what would be sent; phone numbers are masked.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-hairline text-sm">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-bone">{r.contactName ?? "Unknown"} <span className="text-xs text-steel/70">{r.phoneMasked}</span></span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-steel">
                  Demo {r.startsAt ? when(r.startsAt, r.timezone) : "unknown"}
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</Badge>
                </span>
              </div>
              <p className="text-xs text-steel">
                {STATUS_MEANING[r.status]}
                {r.skipReason ? `: ${REASON[r.skipReason] ?? r.skipReason}` : ""}. Due {when(r.scheduledFor)}.
                {r.answeredBy ? ` Answered by ${r.answeredBy}.` : ""}{r.disposition ? ` Outcome ${r.disposition.toLowerCase().replace(/_/g, " ")}.` : ""}
                {r.optOut ? " Asked not to be called again: added to the do-not-call list." : ""}
              </p>
              {r.summary && <p className="text-xs text-steel/80">{r.summary}</p>}
              {r.error && <p className="text-xs text-critical">{r.error}</p>}
              {r.dryRun && (
                <details className="text-xs text-steel">
                  <summary className="cursor-pointer text-bone">What would be sent</summary>
                  <p className="mt-1">Checks passed: {r.dryRun.reasons.join("; ")}.</p>
                  <pre className="mt-1 max-h-72 overflow-auto rounded border border-graphite/60 bg-obsidian p-2 text-[11px] text-bone">{JSON.stringify(r.dryRun.body, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
