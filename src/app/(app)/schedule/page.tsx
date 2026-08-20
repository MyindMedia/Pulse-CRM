"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, X, CalendarClock, DoorOpen, Check, Ban } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar } from "@/components/ui/avatar";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ShiftDialog, type EditableShift } from "@/components/schedule/shift-dialog";
import { TimeOffInbox } from "@/components/schedule/time-off-inbox";
import { MySchedulePanel } from "@/components/schedule/my-schedule-panel";
import { EngineerRequests } from "@/components/schedule/engineer-requests";
import { UnstaffedSessions } from "@/components/schedule/unstaffed-sessions";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FALLBACK_COLOR = "#8a8a92";

function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

type Member = { _id: string; name: string; avatarColor?: string; photoUrl?: string | null };
type Shift = {
  _id: string; memberId: string; memberName: string; memberPhotoUrl?: string | null;
  roomName: string | null;
  roomId?: string; note?: string; kind: "scheduled" | "session";
  status: "scheduled" | "confirmed" | "cancelled"; startTime: number; endTime: number;
};

export default function SchedulePage() {
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(Date.now()));
  const weekEnd = weekStart + 7 * DAY;
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dlgDefaults, setDlgDefaults] = React.useState<{ date?: number; memberId?: string }>({});
  const [editShift, setEditShift] = React.useState<EditableShift | null>(null);

  const shifts = useQuery(api.shifts.listRange, { from: weekStart, to: weekEnd }) as Shift[] | undefined;
  const members = useQuery(api.members.list) as Member[] | undefined;
  const rooms = useQuery(api.rooms.bookable) as { _id: string; name: string }[] | undefined;
  const working = useQuery(api.shifts.whosWorking, {});
  const closures = useQuery(api.shifts.closedDaysInRange, { from: weekStart, to: weekEnd });
  const cancelShift = useMutation(api.shifts.cancel);

  const weekLabel = `${new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${new Date(weekEnd - DAY).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const colorOf = React.useCallback(
    (memberId: string) => members?.find((m) => m._id === memberId)?.avatarColor ?? FALLBACK_COLOR,
    [members],
  );

  // dayIndex -> closure reason (Sunday / holiday name).
  const closedByDay = React.useMemo(() => {
    const m: Record<number, string> = {};
    for (const c of closures ?? []) {
      const di = Math.round((c.date - weekStart) / DAY);
      if (di >= 0 && di <= 6) m[di] = c.reason;
    }
    return m;
  }, [closures, weekStart]);

  function openAdd(date?: number, memberId?: string) {
    setEditShift(null);
    setDlgDefaults({ date, memberId });
    setDialogOpen(true);
  }
  function openEdit(s: Shift) {
    setEditShift({ _id: s._id, memberId: s.memberId, startTime: s.startTime, endTime: s.endTime, roomId: s.roomId, note: s.note, status: s.status });
    setDialogOpen(true);
  }
  function quickCancel(s: Shift) {
    cancelShift({ shiftId: s._id as Id<"shifts"> }).then(() => toast.success("Shift cancelled. Team member notified.")).catch(() => toast.error("Couldn't cancel."));
  }

  const byMemberDay = React.useMemo(() => {
    const m: Record<string, Record<number, Shift[]>> = {};
    for (const s of shifts ?? []) {
      const di = Math.floor((s.startTime - weekStart) / DAY);
      if (di < 0 || di > 6) continue;
      (m[s.memberId] ??= {});
      (m[s.memberId][di] ??= []).push(s);
    }
    return m;
  }, [shifts, weekStart]);

  const [selectedDay, setSelectedDay] = React.useState(() =>
    Math.min(6, Math.max(0, Math.floor((Date.now() - startOfWeek(Date.now())) / DAY))),
  );
  const dayShifts = React.useMemo(
    () => (shifts ?? []).filter((s) => Math.floor((s.startTime - weekStart) / DAY) === selectedDay).sort((a, b) => a.startTime - b.startTime),
    [shifts, weekStart, selectedDay],
  );

  /** Chip color + ring based on staff color, kind, and status. */
  function chipProps(s: Shift): { className: string; style?: React.CSSProperties } {
    if (s.kind === "session") {
      return { className: cn("border-gold-dim/40 bg-gold/[0.08] text-gold", s.status === "confirmed" && "ring-1 ring-positive/40") };
    }
    const c = colorOf(s.memberId);
    return {
      className: cn("text-bone", s.status === "confirmed" && "ring-1 ring-positive/50"),
      style: { borderColor: `${c}66`, backgroundColor: `${c}1f` },
    };
  }

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Team"
        title="Schedule"
        description="Who's working, when, and in which studio. Click any shift to edit it - the team member is notified of changes. Booking an engineer onto a session schedules them automatically."
        actions={<Button size="sm" onClick={() => openAdd()}><Plus className="size-3.5" />Add shift</Button>}
      />

      {/* Who's working now */}
      <div className="rounded-chrome border border-graphite/50 bg-coal/40 px-4 py-3">
        <p className="mb-2 font-meta text-[0.625rem] uppercase tracking-[0.18em] text-steel/70">On shift now</p>
        {working === undefined ? (
          <p className="text-sm text-steel/70">Checking…</p>
        ) : working.now.length === 0 ? (
          <p className="text-sm text-steel/70">No one is clocked into a shift right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {working.now.map((s) => (
              <span key={s._id} className="inline-flex items-center gap-1.5 rounded-md border border-graphite/60 bg-obsidian px-2.5 py-1 text-xs text-bone">
                <Avatar name={s.memberName} src={s.memberPhotoUrl} color={colorOf(s.memberId)} size="xs" className="rounded-full" />
                {s.memberName}
                {s.roomName && <span className="text-steel/70">· {s.roomName}</span>}
                <span className="text-steel/70">
                  {s.endTime ? `until ${fmtTime(s.endTime)}` : `since ${fmtTime(s.clockInAt)}`}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <EngineerRequests />

      <UnstaffedSessions />

      {/* Week nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <IconButton variant="secondary" size="icon-sm" label="Previous week" onClick={() => setWeekStart((w) => w - 7 * DAY)}><ChevronLeft className="size-4" /></IconButton>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(Date.now()))}>This week</Button>
          <IconButton variant="secondary" size="icon-sm" label="Next week" onClick={() => setWeekStart((w) => w + 7 * DAY)}><ChevronRight className="size-4" /></IconButton>
        </div>
        <p className="text-sm font-medium text-steel">{weekLabel}</p>
      </div>

      {!members || shifts === undefined ? (
        <SkeletonRows rows={5} />
      ) : members.length === 0 ? (
        <p className="rounded-chrome border border-graphite/50 bg-coal/40 px-4 py-8 text-center text-sm text-steel/70">
          Add team members in Settings → Team to start scheduling.
        </p>
      ) : (
        <>
        {/* Mobile: one-day view */}
        <div className="space-y-3 md:hidden">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {DAY_LABELS.map((d, i) => {
              const active = i === selectedDay;
              const closed = closedByDay[i];
              return (
                <button key={d} onClick={() => setSelectedDay(i)}
                  className={cn("flex shrink-0 flex-col items-center rounded-lg border px-3 py-1.5 text-xs",
                    active ? "border-gold-dim bg-gold/10 text-gold" : closed ? "border-graphite/60 bg-coal-2 text-steel/70" : "border-graphite/60 bg-coal/40 text-steel")}>
                  <span>{d}</span>
                  <span className={cn("font-meta text-sm", active ? "text-gold" : "text-bone")}>{new Date(weekStart + i * DAY).getDate()}</span>
                </button>
              );
            })}
          </div>
          {closedByDay[selectedDay] ? (
            <p className="flex items-center justify-center gap-1.5 rounded-lg border border-graphite/50 bg-coal-2 px-4 py-6 text-center text-sm text-steel/70">
              <Ban className="size-4" /> Closed - {closedByDay[selectedDay]}
            </p>
          ) : dayShifts.length === 0 ? (
            <p className="rounded-lg border border-graphite/50 bg-coal/40 px-4 py-6 text-center text-sm text-steel/70">No shifts scheduled this day.</p>
          ) : (
            <div className="space-y-2">
              {dayShifts.map((s) => (
                <button key={s._id} onClick={() => openEdit(s)}
                  className="flex w-full items-center gap-3 rounded-lg border bg-coal/40 px-3 py-2.5 text-left"
                  style={{ borderLeftColor: colorOf(s.memberId), borderLeftWidth: 3 }}>
                  <span className="font-meta text-xs text-steel/70">{fmtTime(s.startTime)}-{fmtTime(s.endTime)}</span>
                  <Avatar name={s.memberName} src={s.memberPhotoUrl} color={colorOf(s.memberId)} size="xs" className="rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-bone">{s.memberName}</p>
                    {s.roomName && <p className="flex items-center gap-1 text-xs text-steel/70"><DoorOpen className="size-3" />{s.roomName}</p>}
                  </div>
                  {s.status === "confirmed" && <Check className="size-3.5 text-positive" />}
                  {s.kind === "session" && <span className="rounded bg-gold/10 px-1.5 py-0.5 text-[0.625rem] text-gold">session</span>}
                </button>
              ))}
            </div>
          )}
          {!closedByDay[selectedDay] && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => openAdd(weekStart + selectedDay * DAY + 10 * 3_600_000)}>
              <Plus className="size-3.5" />Add shift this day
            </Button>
          )}
        </div>

        {/* Desktop: week grid */}
        <div className="hidden overflow-x-auto rounded-chrome border border-graphite/50 md:block">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-graphite/50 bg-coal/60">
                <th className="sticky left-0 z-10 w-40 bg-coal/60 px-3 py-2 text-left text-xs font-semibold text-steel">Team</th>
                {DAY_LABELS.map((d, i) => {
                  const closed = closedByDay[i];
                  return (
                    <th key={d} className={cn("px-2 py-2 text-center text-xs font-semibold", closed ? "bg-coal-2 text-steel/70" : "text-steel")}>
                      <div>{d}<span className="ml-1 text-steel/70">{new Date(weekStart + i * DAY).getDate()}</span></div>
                      {closed && <div className="mt-0.5 truncate text-[0.5625rem] font-normal uppercase tracking-wide text-caution">{closed === "Sunday" ? "Closed" : closed}</div>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m._id} className="border-b border-graphite/50 last:border-0">
                  <td className="sticky left-0 z-10 bg-ink px-3 py-2 text-sm font-medium text-bone">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(m._id) }} />
                      <Avatar name={m.name} src={m.photoUrl} color={m.avatarColor} size="xs" className="rounded-full" />
                      {m.name}
                    </span>
                  </td>
                  {Array.from({ length: 7 }).map((_, di) => {
                    const cell = byMemberDay[m._id]?.[di] ?? [];
                    const closed = closedByDay[di];
                    if (closed) {
                      return <td key={di} className="min-w-[88px] bg-coal-2/40 align-top" aria-label={`Closed - ${closed}`} />;
                    }
                    return (
                      <td key={di} className="group/cell min-w-[88px] align-top">
                        <div className="flex min-h-[44px] flex-col gap-1 p-1.5">
                          {cell.map((s) => {
                            const cp = chipProps(s);
                            return (
                              <button key={s._id} onClick={() => openEdit(s)} style={cp.style}
                                className={cn("group/chip relative rounded-md border px-1.5 py-1 text-left text-[0.6875rem] leading-tight transition-shadow hover:shadow-elev-1", cp.className)}>
                                <span className="flex items-center gap-1 font-meta">
                                  {fmtTime(s.startTime)}-{fmtTime(s.endTime)}
                                  {s.status === "confirmed" && <Check className="size-2.5 text-positive" />}
                                </span>
                                {s.roomName && <span className="block truncate opacity-80"><DoorOpen className="mr-0.5 inline size-2.5" />{s.roomName}</span>}
                                {s.kind === "session" && <span className="block text-[0.625rem] text-gold/70">session</span>}
                                <span
                                  role="button"
                                  tabIndex={-1}
                                  aria-label="Cancel shift"
                                  onClick={(e) => { e.stopPropagation(); quickCancel(s); }}
                                  className="absolute -right-1 -top-1 block rounded-full bg-coal p-0.5 text-steel/70 transition-opacity hover:text-critical md:opacity-0 md:group-hover/chip:opacity-100"
                                >
                                  <X className="size-2.5" />
                                </span>
                              </button>
                            );
                          })}
                          <button
                            onClick={() => openAdd(weekStart + di * DAY + 10 * 3_600_000, m._id)}
                            className="flex items-center justify-center rounded-md border border-dashed border-graphite/60 py-1 text-steel/70 transition-opacity hover:border-gold-dim hover:text-gold md:opacity-0 md:group-hover/cell:opacity-100"
                            aria-label="Add shift"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.6875rem] text-steel/70">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-graphite/60" style={{ backgroundColor: `${FALLBACK_COLOR}1f` }} /> each color = a teammate</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-gold-dim/40 bg-gold/[0.08]" /> session (auto-scheduled)</span>
        <span className="inline-flex items-center gap-1.5"><Check className="size-3 text-positive" /> confirmed</span>
        <span className="inline-flex items-center gap-1.5"><Ban className="size-3 text-caution" /> closed / holiday</span>
        <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3" /> click a shift to edit</span>
      </div>

      <TimeOffInbox />
      <MySchedulePanel />

      <ShiftDialog
        open={dialogOpen}
        onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditShift(null); }}
        members={members ?? []}
        rooms={rooms ?? []}
        defaultDate={dlgDefaults.date}
        defaultMemberId={dlgDefaults.memberId}
        shift={editShift}
      />
    </div>
  );
}
