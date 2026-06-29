"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, Timer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MIN = 60_000;

function fmtElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / MIN));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Global, mobile-first clock in / out widget. Pops a prompt when a staff
 * member's shift starts (clock in) and again when it ends (clock out / still
 * working). Re-evaluates on a 30s ticking clock so the prompt appears at the
 * right moment without a server round-trip. Renders nothing for non-staff
 * (clients, agency, demo owner) since myStatus returns member: null.
 */
export function ClockWidget() {
  const status = useQuery(api.timeclock.myStatus, {});
  const clockIn = useMutation(api.timeclock.clockIn);
  const clockOut = useMutation(api.timeclock.clockOut);
  const snooze = useMutation(api.timeclock.snooze);

  const [now, setNow] = React.useState(() => Date.now());
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!status?.member) return null;
  const { active, shifts, coveredShiftIds } = status;

  // Decide the prompt client-side against the ticking clock.
  let prompt:
    | { type: "clock_in"; shiftId: Id<"shifts">; shiftStart: number; shiftEnd: number }
    | { type: "clock_out" }
    | null = null;

  if (active) {
    const snoozed = active.snoozedUntil != null && now < active.snoozedUntil;
    if (now >= active.scheduledEnd && !snoozed) prompt = { type: "clock_out" };
  } else {
    const open = shifts
      .filter((s) => now >= s.startTime - 15 * MIN && now <= s.endTime)
      .sort((a, b) => a.startTime - b.startTime)[0];
    if (open && !coveredShiftIds.includes(open._id)) {
      prompt = { type: "clock_in", shiftId: open._id as Id<"shifts">, shiftStart: open.startTime, shiftEnd: open.endTime };
    }
  }

  const promptKey = prompt ? `${prompt.type}:${prompt.type === "clock_in" ? prompt.shiftId : active?._id}` : null;
  const showPrompt = Boolean(prompt) && dismissed !== promptKey;

  async function doClockIn(shiftId?: Id<"shifts">) {
    setBusy(true);
    try {
      await clockIn(shiftId ? { shiftId } : {});
      toast.success("Clocked in. Have a good session.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clock in.");
    } finally {
      setBusy(false);
    }
  }
  async function doClockOut() {
    setBusy(true);
    try {
      await clockOut({});
      toast.success("Clocked out. Hours saved.");
      setDismissed(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not clock out.");
    } finally {
      setBusy(false);
    }
  }
  async function doSnooze() {
    setBusy(true);
    try {
      await snooze({ minutes: 60 });
      setDismissed(promptKey);
    } finally {
      setBusy(false);
    }
  }

  const elapsed = active ? fmtElapsed(now - active.clockInAt) : "";

  return (
    <>
      {/* On-the-clock pill - always reachable so anyone can clock out early. */}
      {active && !showPrompt && (
        <button
          type="button"
          onClick={doClockOut}
          disabled={busy}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full border border-gold/40 bg-coal-2/95 px-4 py-2 shadow-elev-3 backdrop-blur lg:bottom-6"
          aria-label={`On the clock ${elapsed}. Tap to clock out.`}
        >
          <Timer className="size-4 text-gold" />
          <span className="font-meta text-sm text-bone">{elapsed}</span>
          <span className="text-xs text-steel/80">Clock out</span>
        </button>
      )}

      <Dialog open={showPrompt} onOpenChange={(o) => { if (!o) setDismissed(promptKey); }}>
        <DialogContent size="sm">
          {prompt?.type === "clock_in" ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Clock className="size-5 text-gold" /> You’re scheduled now</DialogTitle>
                <DialogDescription>
                  Your shift runs {fmtClock(prompt.shiftStart)} - {fmtClock(prompt.shiftEnd)}. Clock in to start tracking your hours.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDismissed(promptKey)} disabled={busy}>Not yet</Button>
                <Button onClick={() => doClockIn(prompt.shiftId)} disabled={busy}>
                  <LogIn className="size-4" /> Clock in
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Clock className="size-5 text-gold" /> Your shift has ended</DialogTitle>
                <DialogDescription>
                  You’ve been on the clock {elapsed}. Clock out now, or keep going if you’re still working.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={doSnooze} disabled={busy}>Still working (+1h)</Button>
                <Button onClick={doClockOut} disabled={busy}>
                  <LogOut className="size-4" /> Clock out
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
