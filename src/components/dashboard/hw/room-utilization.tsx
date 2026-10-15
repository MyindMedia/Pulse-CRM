"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { errorMessage } from "@/lib/errors";
import { EntityLink } from "@/components/shell/entity-link";
import { Chassis, ChassisTitle, EmptyWell, Groove, usd } from "./parts";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/* Room utilization (kit 6.2): booked hours against a 12-hour bookable day
 * over the last 30 days (reports.roomUtilization). The busiest room is the
 * yellow focus, the rest are metal. The last groove is the kit's monthly
 * goal, collected revenue against the studio's goal, with the chrome knob;
 * until a goal is set it shows the studio-wide average, and whoever may set
 * the goal gets a key for it. */
export function RoomUtilization() {
  const u = useQuery(api.reports.roomUtilization, {});
  const o = useQuery(api.dashboard.overview, {});
  const goal = o?.kpis.monthlyGoalCents ?? null;
  const revenue = o?.kpis.revenueThisMonth ?? null;
  const canSetGoal = o?.kpis.canSetGoal === true;

  return (
    <Chassis>
      <ChassisTitle title="Room utilization" bar={false} />
      {u === undefined ? (
        <div className="mt-3 flex-1" aria-busy />
      ) : u.rows.length === 0 ? (
        <div className="mt-3 flex flex-1">
          <EmptyWell>Add a room to see how busy it is.</EmptyWell>
        </div>
      ) : (
        <div className="mt-3 flex flex-1 flex-col justify-between gap-4">
          {u.rows.slice(0, 4).map((r, i) => (
            <div key={r.roomId}>
              <Row
                label={
                  <EntityLink type="room" id={r.roomId} className="truncate hover:text-bone hover:underline">
                    {r.roomName}
                  </EntityLink>
                }
                value={pct(r.utilization)}
              />
              <Groove value={r.utilization} tone={i === 0 && r.utilization > 0 ? "yellow" : "metal"} />
            </div>
          ))}
          {goal !== null && revenue !== null ? (
            <div>
              <Row
                label="Monthly goal"
                value={`${usd(revenue)} / ${usd(goal)}`}
                action={canSetGoal ? <GoalEditor current={goal} compact /> : null}
              />
              <Groove value={revenue / goal} tone="yellow" knob />
            </div>
          ) : (
            <div>
              <Row label={`All rooms, ${u.windowDays} days`} value={pct(u.avgUtilization)} />
              <Groove value={u.avgUtilization} tone="yellow" knob />
              {canSetGoal && (
                <div className="mt-3">
                  <GoalEditor current={null} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Chassis>
  );
}

function Row({ label, value, action }: { label: React.ReactNode; value: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 font-sans text-[13px] leading-[18px]">
      <span className="flex min-w-0 items-center gap-1.5 truncate text-mist">
        {label}
        {action}
      </span>
      <span className="shrink-0 font-mono text-xs text-bone tabular-nums">{value}</span>
    </div>
  );
}

/** Set or change the monthly revenue goal (owners and managers who can see
 *  money; the server checks both). */
function GoalEditor({ current, compact }: { current: number | null; compact?: boolean }) {
  const setGoal = useMutation(api.orgs.setMonthlyRevenueGoal);
  const [open, setOpen] = React.useState(false);
  const [dollars, setDollars] = React.useState(current ? String(Math.round(current / 100)) : "");
  const [saving, setSaving] = React.useState(false);

  async function save(cents: number | null) {
    setSaving(true);
    try {
      await setGoal({ cents });
      toast.success(cents === null ? "Goal cleared." : "Monthly goal saved.");
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the goal."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <button type="button" aria-label="Change the monthly goal" className="grid size-5 place-items-center rounded-[4px] text-steel hover:text-bone">
            <Pencil className="size-3" />
          </button>
        ) : (
          <Button size="sm" variant="secondary">
            Set monthly goal
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(dollars.replace(/[$,\s]/g, ""));
            if (!Number.isFinite(n) || n <= 0) {
              toast.error("Enter a goal above $0.");
              return;
            }
            void save(Math.round(n * 100));
          }}
          className="space-y-3"
        >
          <label className="block font-sans text-xs text-steel" htmlFor="monthly-goal">
            Monthly revenue goal (USD)
          </label>
          <Input
            id="monthly-goal"
            inputMode="decimal"
            autoFocus
            placeholder="60000"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              Save
            </Button>
            {current !== null && (
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
                Clear
              </Button>
            )}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
