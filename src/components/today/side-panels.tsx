"use client";

import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import Link from "next/link";
import { UserCheck, Wallet, Users, ArrowRight, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { money, timeOfDay, relativeTime } from "@/lib/format";
import { titleCase } from "@/lib/labels";
import { cn } from "@/lib/utils";

type TodayData = FunctionReturnType<typeof api.today.today>;

/** Section shell used by every side panel - overline header + optional trailing. */
function Panel({
  icon: Icon,
  title,
  trailing,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-chrome material-thin p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 overline">
          <Icon className="size-3.5 text-steel/70" />
          {title}
        </h2>
        {trailing}
      </div>
      {children}
    </section>
  );
}

/** Next arrivals - who's due in and when. */
export function ArrivalsPanel({
  arrivals,
  onOpen,
}: {
  arrivals: TodayData["arrivals"];
  onOpen?: (id: string) => void;
}) {
  return (
    <Panel icon={UserCheck} title="Next arrivals">
      {arrivals.length === 0 ? (
        <p className="text-sm text-steel/70">No one else due in today.</p>
      ) : (
        <ul className="space-y-2">
          {arrivals.map((a) => (
            <li key={a._id}>
              <button
                type="button"
                onClick={() => onOpen?.(a._id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-bone">{a.clientName}</p>
                  <p className="truncate text-xs text-steel/70">
                    {a.title}
                    {a.roomName ? ` · ${a.roomName}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-grotesk text-sm font-semibold text-bone">
                    {timeOfDay(a.startTime)}
                  </p>
                  <p className="text-[0.625rem] text-steel/70">{relativeTime(a.startTime)}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Balances due today - leadership only (null when the viewer can't see money). */
export function BalancesPanel({
  balances,
  onOpen,
}: {
  balances: TodayData["balances"];
  onOpen?: (id: string) => void;
}) {
  if (balances.dueCents === null) return null;
  return (
    <Panel
      icon={Wallet}
      title="Balances due today"
      trailing={
        <span
          className={cn(
            "font-grotesk text-base font-bold tracking-tight",
            balances.dueCents > 0 ? "text-gold-bright" : "text-steel/70",
          )}
        >
          {money(balances.dueCents)}
        </span>
      }
    >
      {balances.count === 0 ? (
        <p className="text-sm text-steel/70">Every session today is squared up. Nice.</p>
      ) : (
        <ul className="space-y-1.5">
          {balances.list.map((s) => (
            <li key={s._id}>
              <button
                type="button"
                onClick={() => onOpen?.(s._id)}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-bone">
                  {s.clientName}
                  <span className="text-steel/60"> · {s.title}</span>
                </span>
                <Badge tone="caution">{money(s.outstandingCents!)}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Staff on shift today. */
export function StaffPanel({ staff }: { staff: TodayData["staffOnShift"] }) {
  return (
    <Panel icon={Users} title="On shift today">
      {staff.length === 0 ? (
        <p className="text-sm text-steel/70">No shifts scheduled for today.</p>
      ) : (
        <ul className="space-y-2">
          {staff.map((sh) => (
            <li key={sh._id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-bone">
                  {sh.memberName}
                  {sh.onNow && <Badge tone="positive" dot>Now</Badge>}
                </p>
                <p className="truncate text-xs text-steel/70">
                  {sh.memberRole ? titleCase(sh.memberRole) : "Staff"}
                  {sh.roomName ? ` · ${sh.roomName}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-steel/70">
                {timeOfDay(sh.startTime)}
                {" - "}
                {timeOfDay(sh.endTime)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Tomorrow teaser - a nudge toward the next day. */
export function TomorrowPanel({ tomorrow }: { tomorrow: TodayData["tomorrow"] }) {
  return (
    <Link
      href="/calendar"
      className="group flex items-center gap-3 rounded-chrome material-thin p-4 outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-coal-2 text-steel/70">
        <Clock3 className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="overline">Tomorrow</p>
        <p className="text-sm text-bone">
          {tomorrow.count === 0 ? (
            "Nothing booked yet"
          ) : (
            <>
              <span className="font-semibold">{tomorrow.count}</span>{" "}
              session{tomorrow.count === 1 ? "" : "s"}
              {tomorrow.firstStart ? (
                <span className="text-steel">
                  {" "}· first at {timeOfDay(tomorrow.firstStart)}
                </span>
              ) : null}
            </>
          )}
        </p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-steel/50 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
