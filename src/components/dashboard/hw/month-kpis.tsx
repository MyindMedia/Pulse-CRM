"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Chassis, ChassisTitle, Delta, StatTile, usd } from "./parts";
import { useDashboardPeriod, usePeriodBounds } from "./period";

const fmtHours = (h: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(h);

/* The period at a glance (kit 6.2: "October KPIs, 4 StatTiles"); the top
 * bar's Day / Week / Month keys choose the period. Money roles see revenue,
 * booked hours, deposits held and outstanding; everyone else sees the
 * studio's workload instead of figures they may not see. Deposits held and
 * outstanding are what stands right now, whatever the period. */
export function MonthKpis() {
  const { period } = useDashboardPeriod();
  const b = usePeriodBounds(period);
  const p = useQuery(api.dashboard.periodKpis, { start: b.start, end: b.end, prevStart: b.prevStart, prevEnd: b.prevEnd });
  const o = useQuery(api.dashboard.overview, {});

  if (!p || !o) {
    return (
      <Chassis aria-busy>
        <ChassisTitle title={b.title} />
        <div className="mt-3 grid flex-1 grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <StatTile key={i} label="Loading" value="--" />
          ))}
        </div>
      </Chassis>
    );
  }

  const k = o.kpis;
  const tiles = p.money
    ? [
        {
          label: "Revenue",
          value: usd(p.revenueCents ?? 0),
          highlight: true,
          foot: <Delta value={p.revenueDelta} against={b.against} />,
        },
        { label: "Booked hours", value: fmtHours(p.bookedHours), foot: <Delta value={p.bookedHoursDelta} against={b.against} /> },
        {
          label: "Deposits held",
          value: usd(k.depositsHeldCents ?? 0),
          foot: `${k.depositsHeldCount ?? 0} ${k.depositsHeldCount === 1 ? "booking" : "bookings"}`,
        },
        {
          label: "Outstanding",
          value: usd(k.outstandingCents ?? 0),
          foot: k.overdueCount ? <span className="text-critical">{k.overdueCount} overdue</span> : "none overdue",
        },
      ]
    : [
        { label: "Booked hours", value: fmtHours(p.bookedHours), highlight: true, foot: <Delta value={p.bookedHoursDelta} against={b.against} /> },
        { label: "Sessions", value: String(p.sessions), foot: period === "day" ? "today" : period === "week" ? "this week" : `in ${b.title}` },
        { label: "New leads", value: String(k.newLeadsThisWeek), foot: "this week" },
        { label: "Active songs", value: String(k.activeSongs), foot: "in production" },
      ];

  return (
    <Chassis>
      <ChassisTitle title={b.title} />
      <div className="mt-3 grid flex-1 grid-cols-2 gap-3">
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} highlight={t.highlight} foot={t.foot} />
        ))}
      </div>
    </Chassis>
  );
}
