"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CalendarClock, Plane, Plus, X, DoorOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const dt = (ts: number) => new Date(ts).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const TONE = { pending: "caution", approved: "positive", denied: "critical" } as const;

type Slot = { weekday: number; startMinutes: number; endMinutes: number };

/** Staff self-service: my upcoming work, weekly availability, time off. */
export function MySchedulePanel() {
  const mine = useQuery(api.shifts.mine, {});
  const avail = useQuery(api.availability.myAvailability, {});
  const myTimeOff = useQuery(api.availability.myTimeOff, {});
  const saveAvail = useMutation(api.availability.setMyAvailability);
  const requestOff = useMutation(api.availability.requestTimeOff);

  const [slots, setSlots] = React.useState<Slot[] | null>(null);
  const [offStart, setOffStart] = React.useState("");
  const [offEnd, setOffEnd] = React.useState("");
  const [offReason, setOffReason] = React.useState("");

  // Seed local availability once it loads (lazy, keyed below).
  const editable = slots ?? avail?.slots ?? [];

  if (mine && mine.member === null) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-steel/70">
          Your staff profile isn’t linked to your login yet - ask an owner to add your email to the team.
        </CardContent>
      </Card>
    );
  }

  async function save() {
    try {
      await saveAvail({ slots: editable });
      toast.success("Availability saved.");
      setSlots(null);
    } catch {
      toast.error("Could not save availability.");
    }
  }

  async function submitOff(e: React.FormEvent) {
    e.preventDefault();
    if (!offStart || !offEnd) return;
    try {
      await requestOff({
        startTime: new Date(`${offStart}T00:00`).getTime(),
        endTime: new Date(`${offEnd}T23:59`).getTime(),
        reason: offReason.trim() || undefined,
      });
      toast.success("Time-off request sent.");
      setOffStart(""); setOffEnd(""); setOffReason("");
    } catch {
      toast.error("Could not send the request.");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Upcoming */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><CalendarClock className="size-4 text-gold" />My upcoming</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 pt-1">
          {!mine ? (
            <p className="text-sm text-steel/70">Loading…</p>
          ) : mine.shifts.length === 0 && mine.sessions.length === 0 ? (
            <p className="text-sm text-steel/70">Nothing scheduled.</p>
          ) : (
            <>
              {mine.shifts.map((s) => (
                <div key={s._id} className="flex items-center gap-2 text-sm text-bone">
                  <span className="font-meta text-xs text-steel/70">{dt(s.startTime)}</span>
                  {s.roomName && <span className="inline-flex items-center gap-0.5 text-xs text-steel/70"><DoorOpen className="size-3" />{s.roomName}</span>}
                  {s.kind === "session" && <Badge tone="gold">session</Badge>}
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Availability */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Weekly availability</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-1">
          {editable.length === 0 && <p className="text-sm text-steel/70">No availability set.</p>}
          {editable.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={String(s.weekday)} onValueChange={(v) => setSlots(editable.map((x, j) => j === i ? { ...x, weekday: Number(v) } : x))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{WD.map((d, wi) => <SelectItem key={wi} value={String(wi)}>{d}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="time" className="w-28" value={toHM(s.startMinutes)} onChange={(e) => setSlots(editable.map((x, j) => j === i ? { ...x, startMinutes: toMin(e.target.value) } : x))} />
              <Input type="time" className="w-28" value={toHM(s.endMinutes)} onChange={(e) => setSlots(editable.map((x, j) => j === i ? { ...x, endMinutes: toMin(e.target.value) } : x))} />
              <button aria-label="Remove" onClick={() => setSlots(editable.filter((_, j) => j !== i))} className="text-steel/70 hover:text-critical"><X className="size-4" /></button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => setSlots([...editable, { weekday: 1, startMinutes: 540, endMinutes: 1020 }])}><Plus className="size-3.5" />Add day</Button>
            <Button size="sm" onClick={save}>Save availability</Button>
          </div>
        </CardContent>
      </Card>

      {/* Time off */}
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Plane className="size-4 text-gold" />Time off</CardTitle></CardHeader>
        <CardContent className="space-y-3 pt-1">
          <form onSubmit={submitOff} className="flex flex-wrap items-end gap-3">
            <Field label="From" htmlFor="off-start"><Input id="off-start" type="date" value={offStart} onChange={(e) => setOffStart(e.target.value)} /></Field>
            <Field label="To" htmlFor="off-end"><Input id="off-end" type="date" value={offEnd} onChange={(e) => setOffEnd(e.target.value)} /></Field>
            <Field label="Reason (optional)" htmlFor="off-reason"><Input id="off-reason" value={offReason} onChange={(e) => setOffReason(e.target.value)} placeholder="Vacation" /></Field>
            <Button type="submit" size="sm" disabled={!offStart || !offEnd}>Request</Button>
          </form>
          <div className="space-y-1">
            {(myTimeOff ?? []).map((r) => (
              <div key={r._id} className="flex items-center justify-between rounded-md border border-graphite/50 bg-coal-2 px-3 py-1.5 text-sm">
                <span className="text-bone">{new Date(r.startTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(r.endTime).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <Badge tone={TONE[r.status]}>{r.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
