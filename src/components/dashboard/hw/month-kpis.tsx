"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Chassis, ChassisTitle, Delta, StatTile, lastMonthName, usd } from "./parts";

const fmtHours = (h: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(h);

/* This month at a glance (kit 6.2: "October KPIs, 4 StatTiles"). Money roles
 * see revenue, booked hours, deposits held and outstanding; everyone else
 * sees the studio's workload instead of figures they may not see. */
export function MonthKpis() {
  const o = useQuery(api.dashboard.overview, {});
  const month = new Date().toLocaleDateString("en-US", { month: "long" });
  const vs = lastMonthName();

  if (!o) {
    return (
      <Chassis aria-busy>
        <ChassisTitle title={month} />
        <div className="mt-5 grid flex-1 grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <StatTile key={i} label="Loading" value="--" />
          ))}
        </div>
      </Chassis>
    );
  }

  const k = o.kpis;
  const tiles = o.canSeeFinancials
    ? [
        {
          label: "Revenue",
          value: usd(k.revenueThisMonth ?? 0),
          highlight: true,
          foot: <Delta value={k.revenueDelta} against={vs} />,
        },
        { label: "Booked hours", value: fmtHours(k.bookedHoursThisMonth), foot: <Delta value={k.bookedHoursDelta} against={vs} /> },
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
        { label: "Booked hours", value: fmtHours(k.bookedHoursThisMonth), highlight: true, foot: <Delta value={k.bookedHoursDelta} against={vs} /> },
        { label: "Sessions", value: String(k.sessionsThisMonth), foot: "this month" },
        { label: "New leads", value: String(k.newLeadsThisWeek), foot: "this week" },
        { label: "Active songs", value: String(k.activeSongs), foot: "in production" },
      ];

  return (
    <Chassis>
      <ChassisTitle title={month} />
      <div className="mt-5 grid flex-1 grid-cols-2 gap-3">
        {tiles.map((t) => (
          <StatTile key={t.label} label={t.label} value={t.value} highlight={t.highlight} foot={t.foot} />
        ))}
      </div>
    </Chassis>
  );
}
