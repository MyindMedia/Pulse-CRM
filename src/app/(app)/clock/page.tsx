"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { AlarmClock, CalendarClock, LogIn, LogOut, Timer, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";
import { cn } from "@/lib/utils";
import { clockedMs, startOfToday, startOfWeek, fmtDuration, fmtTicker } from "@/lib/timesheet";
import { EngineerRequests } from "@/components/schedule/engineer-requests";

const MIN = 60_000;

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The staff Time Clock - a phone-first punch screen. One big button clocks
 * you in or out (tied to your scheduled shift when one is open, ad hoc
 * otherwise), with a live ticking timer, today/this-week totals, and your
 * recent entries. Non-staff viewers (clients, agency, demo) get a quiet
 * explainer instead - the backend only ever clocks the caller themselves.
 */
export default function ClockPage() {
  const status = useQuery(api.timeclock.myStatus, {});
  const entries = useQuery(api.timeclock.myEntries, { limit: 40 });
  const clockIn = useMutation(api.timeclock.clockIn);
  const clockOut = useMutation(api.timeclock.clockOut);

  const [now, setNow] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState(false);

  const active = status?.active ?? null;
  const onClock = Boolean(active);

  // Tick every second while on the clock (live timer), gently otherwise.
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), onClock ? 1_000 : 30_000);
    return () => clearInterval(id);
  }, [onClock]);

  if (status === undefined) {
    return <div className="py-16 text-center text-steel/70">Loading…</div>;
  }

  if (!status.member) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <Users className="mx-auto size-8 text-steel/60" />
        <h1 className="font-grotesk text-xl font-bold text-bone">The time clock is for studio staff</h1>
        <p className="text-sm text-steel">
          Clocking in and out is tied to your own team-member profile. If you work here, ask the
          studio owner to add you to the team and your punch clock will appear.
        </p>
      </div>
    );
  }

  // The shift whose window is open right now (same rule as the clock widget).
  const openShift = (status.shifts ?? [])
    .filter((s) => now >= s.startTime - 15 * MIN && now <= s.endTime)
    .filter((s) => !status.coveredShiftIds.includes(s._id))
    .sort((a, b) => a.startTime - b.startTime)[0];
  const nextShift = (status.shifts ?? [])
    .filter((s) => s.startTime > now)
    .sort((a, b) => a.startTime - b.startTime)[0];

  async function punch() {
    setBusy(true);
    try {
      if (onClock) {
        await clockOut({});
        toast.success("Clocked out. Hours saved.");
      } else {
        await clockIn(openShift ? { shiftId: openShift._id as Id<"shifts"> } : {});
        toast.success("Clocked in. Have a good session.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the clock.");
    } finally {
      setBusy(false);
    }
  }

  const dayStart = startOfToday(new Date(now));
  const weekStart = startOfWeek(new Date(now));
  const todayMs = clockedMs(entries ?? [], dayStart, now + 1, now);
  const weekMs = clockedMs(entries ?? [], weekStart, now + 1, now);

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Team"
        title="Time clock"
        description="Tap to clock in and out. Your hours flow straight into the studio's payroll."
      />

      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
        {/* Live wall clock - the punch screen anchor. */}
        <div className="text-center">
          <div className="font-meta text-4xl tracking-tight text-bone tabular-nums">
            {new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-steel/70">
            {new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>

        {/* The punch button. */}
        <button
          type="button"
          onClick={punch}
          disabled={busy}
          aria-label={onClock ? "Clock out" : "Clock in"}
          className={cn(
            "relative flex size-56 flex-col items-center justify-center gap-2 rounded-full border shadow-elev-3 transition-transform duration-150 active:scale-95 disabled:opacity-70",
            onClock
              ? "border-gold bg-coal-2/95"
              : "border-gold/50 bg-gradient-to-b from-gold/25 via-gold/10 to-transparent",
          )}
        >
          {onClock && (
            <span aria-hidden className="absolute inset-[-8px] rounded-full border border-gold/25 animate-pulse" />
          )}
          {onClock ? (
            <>
              <Timer className="size-6 text-gold" />
              <span className="font-meta text-3xl text-bone tabular-nums">
                {fmtTicker(now - (active?.clockInAt ?? now))}
              </span>
              <span className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-steel">
                <LogOut className="size-3.5" /> Tap to clock out
              </span>
            </>
          ) : (
            <>
              <LogIn className="size-7 text-gold" />
              <span className="font-grotesk text-2xl font-bold text-bone">Clock in</span>
              <span className="text-xs uppercase tracking-wide text-steel">
                {openShift ? "your shift is ready" : "starts your timer"}
              </span>
            </>
          )}
        </button>

        {/* Shift context under the button. */}
        <p className="flex items-center gap-2 text-center text-sm text-steel">
          <CalendarClock className="size-4 shrink-0 text-steel/70" />
          {onClock
            ? `On the clock since ${fmtClock(active!.clockInAt)}`
            : openShift
              ? `Scheduled ${fmtClock(openShift.startTime)} to ${fmtClock(openShift.endTime)}`
              : nextShift
                ? `Next shift ${fmtDay(nextShift.startTime)}, ${fmtClock(nextShift.startTime)}`
                : "No shift scheduled - this punch saves as an ad hoc entry"}
        </p>
      </div>

      <EngineerRequests />

      <div className="rise-stagger grid grid-cols-2 gap-3">
        <StatTile label="Today" value={fmtDuration(todayMs)} icon={AlarmClock} accent hint="clocked" />
        <StatTile label="This week" value={fmtDuration(weekMs)} icon={Timer} hint="since Monday" />
      </div>

      {/* Recent punches - the personal timesheet. */}
      <div className="overflow-hidden rounded-2xl border border-hairline-2/60">
        <div className="border-b border-hairline-2/60 px-4 py-3 font-meta text-xs uppercase tracking-wide text-steel/80">
          Recent entries
        </div>
        {entries === undefined ? (
          <div className="px-4 py-8 text-center text-sm text-steel/70">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-steel/70">
            No entries yet. Your first punch will show up here.
          </div>
        ) : (
          <ul>
            {entries.slice(0, 8).map((e) => (
              <li
                key={e._id}
                className="flex items-center justify-between gap-3 border-b border-hairline-2/40 px-4 py-3 last:border-b-0"
              >
                <div>
                  <div className="text-sm text-bone">{fmtDay(e.clockInAt)}</div>
                  <div className="text-xs text-steel/80">
                    {fmtClock(e.clockInAt)} to {e.clockOutAt ? fmtClock(e.clockOutAt) : "now"}
                  </div>
                </div>
                <div className="text-right">
                  {e.clockOutAt ? (
                    <span className="font-meta text-sm text-bone">{fmtDuration(e.clockOutAt - e.clockInAt)}</span>
                  ) : (
                    <span className="rounded-full border border-gold/40 px-2 py-0.5 text-[0.625rem] uppercase tracking-wide text-gold">
                      on the clock
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
