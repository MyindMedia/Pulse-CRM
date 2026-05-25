"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, X, CalendarClock, DoorOpen } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ShiftDialog } from "@/components/schedule/shift-dialog";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday 00:00 local for the week containing ts. */
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

export default function SchedulePage() {
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(Date.now()));
  const weekEnd = weekStart + 7 * DAY;
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dlgDefaults, setDlgDefaults] = React.useState<{ date?: number; memberId?: string }>({});

  const shifts = useQuery(api.shifts.listRange, { from: weekStart, to: weekEnd });
  const members = useQuery(api.members.list) as { _id: string; name: string }[] | undefined;
  const rooms = useQuery(api.rooms.bookable) as { _id: string; name: string }[] | undefined;
  const working = useQuery(api.shifts.whosWorking, {});
  const cancelShift = useMutation(api.shifts.cancel);

  const weekLabel = `${new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(weekEnd - DAY).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  function openAdd(date?: number, memberId?: string) {
    setDlgDefaults({ date, memberId });
    setDialogOpen(true);
  }

  // shifts[memberId][dayIndex] = shift[]
  const byMemberDay = React.useMemo(() => {
    const m: Record<string, Record<number, typeof shifts>> = {};
    for (const s of shifts ?? []) {
      const di = Math.floor((s.startTime - weekStart) / DAY);
      if (di < 0 || di > 6) continue;
      (m[s.memberId] ??= {});
      (m[s.memberId][di] ??= [] as never);
      (m[s.memberId][di] as NonNullable<typeof shifts>).push(s);
    }
    return m;
  }, [shifts, weekStart]);

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Team"
        title="Schedule"
        description="Who's working, when, and in which studio. Booking an engineer onto a session schedules them automatically."
        actions={<Button size="sm" onClick={() => openAdd()}><Plus className="size-3.5" />Add shift</Button>}
      />

      {/* Who's working now */}
      <div className="rounded-xl border border-hairline bg-coal/40 px-4 py-3">
        <p className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ash-dim">On shift now</p>
        {working === undefined ? (
          <p className="text-sm text-ash-dim">Checking…</p>
        ) : working.now.length === 0 ? (
          <p className="text-sm text-ash-dim">No one is clocked into a shift right now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {working.now.map((s) => (
              <span key={s._id} className="inline-flex items-center gap-1.5 rounded-md border border-hairline-2 bg-ink-2 px-2.5 py-1 text-xs text-bone">
                <span className="size-1.5 rounded-full bg-positive" />
                {s.memberName}
                {s.roomName && <span className="text-ash-dim">· {s.roomName}</span>}
                <span className="text-ash-dim">until {fmtTime(s.endTime)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Week nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="icon-sm" aria-label="Previous week" onClick={() => setWeekStart((w) => w - 7 * DAY)}><ChevronLeft className="size-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(Date.now()))}>This week</Button>
          <Button variant="secondary" size="icon-sm" aria-label="Next week" onClick={() => setWeekStart((w) => w + 7 * DAY)}><ChevronRight className="size-4" /></Button>
        </div>
        <p className="text-sm font-medium text-ash">{weekLabel}</p>
      </div>

      {/* Grid */}
      {!members || shifts === undefined ? (
        <SkeletonRows rows={5} />
      ) : members.length === 0 ? (
        <p className="rounded-xl border border-hairline bg-coal/40 px-4 py-8 text-center text-sm text-ash-dim">
          Add team members in Settings → Team to start scheduling.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-hairline bg-coal/60">
                <th className="sticky left-0 z-10 w-40 bg-coal/60 px-3 py-2 text-left text-xs font-semibold text-ash">Team</th>
                {DAY_LABELS.map((d, i) => (
                  <th key={d} className="px-2 py-2 text-center text-xs font-semibold text-ash">
                    {d}<span className="ml-1 text-ash-dim">{new Date(weekStart + i * DAY).getDate()}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m._id} className="border-b border-hairline last:border-0">
                  <td className="sticky left-0 z-10 bg-ink px-3 py-2 text-sm font-medium text-bone">{m.name}</td>
                  {Array.from({ length: 7 }).map((_, di) => {
                    const cell = byMemberDay[m._id]?.[di] ?? [];
                    return (
                      <td key={di} className="group/cell min-w-[88px] align-top">
                        <div className="flex min-h-[44px] flex-col gap-1 p-1.5">
                          {cell.map((s) => (
                            <span
                              key={s._id}
                              className={cn(
                                "group/chip relative rounded-md border px-1.5 py-1 text-[0.6875rem] leading-tight",
                                s.kind === "session"
                                  ? "border-gold-dim/40 bg-gold/[0.08] text-gold"
                                  : "border-hairline-2 bg-ink-2 text-ash",
                              )}
                            >
                              <span className="font-mono">{fmtTime(s.startTime)}–{fmtTime(s.endTime)}</span>
                              {s.roomName && <span className="block truncate text-ash-dim"><DoorOpen className="mr-0.5 inline size-2.5" />{s.roomName}</span>}
                              {s.kind === "session" && <span className="block text-[0.625rem] text-gold/70">session</span>}
                              <button
                                aria-label="Cancel shift"
                                onClick={() => cancelShift({ shiftId: s._id as Id<"shifts"> }).then(() => toast.success("Shift cancelled.")).catch(() => toast.error("Couldn't cancel."))}
                                className="absolute -right-1 -top-1 hidden rounded-full bg-coal p-0.5 text-ash-dim hover:text-critical group-hover/chip:block"
                              >
                                <X className="size-2.5" />
                              </button>
                            </span>
                          ))}
                          <button
                            onClick={() => openAdd(weekStart + di * DAY + 10 * 3_600_000, m._id)}
                            className="hidden items-center justify-center rounded-md border border-dashed border-hairline-2 py-1 text-ash-dim hover:border-gold-dim hover:text-gold group-hover/cell:flex"
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
      )}

      <p className="flex items-center gap-1.5 text-xs text-ash-dim">
        <CalendarClock className="size-3.5" />
        Gold chips are auto-scheduled from session bookings; grey are manual shifts.
      </p>

      <ShiftDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        members={members ?? []}
        rooms={rooms ?? []}
        defaultDate={dlgDefaults.date}
        defaultMemberId={dlgDefaults.memberId}
      />
    </div>
  );
}
