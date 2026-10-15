"use client";

import * as React from "react";
import { KeyBank, lastMonthName } from "./parts";

/* The overview's period: the Day / Week / Month key bank in the top bar
 * (kit pulse-overview.png) drives the stat tiles. Bounds are computed in the
 * viewer's own time zone, so "today" is their today; weeks start on Monday,
 * like the schedule and timesheets. */

export type Period = "day" | "week" | "month";
export const PERIODS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

const KEY = "pulse:dash-period";
const PeriodContext = React.createContext<{ period: Period; setPeriod: (p: Period) => void }>({
  period: "month",
  setPeriod: () => {},
});

export function DashboardPeriodProvider({ children }: { children: React.ReactNode }) {
  // Remember the choice per browser (a convenience; Month is the default).
  // Read at first render, not in an effect: the effect version subscribed the
  // month's KPI query, then dropped it for the saved period one round trip
  // later. The dashboard never renders during hydration (it waits behind the
  // shell's gates), so reading storage here cannot mismatch the server HTML.
  const [period, setPeriodState] = React.useState<Period>(savedPeriod);
  const setPeriod = React.useCallback((p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const value = React.useMemo(() => ({ period, setPeriod }), [period, setPeriod]);
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

/** The period this browser last chose, or Month. */
export function savedPeriod(): Period {
  try {
    if (typeof window === "undefined") return "month";
    const saved = localStorage.getItem(KEY);
    if (saved === "day" || saved === "week" || saved === "month") return saved;
  } catch {
    /* storage unavailable */
  }
  return "month";
}

export function useDashboardPeriod() {
  return React.useContext(PeriodContext);
}

/** The key bank for the top bar. */
export function PeriodKeys() {
  const { period, setPeriod } = useDashboardPeriod();
  return <KeyBank label="Period" options={PERIODS} value={period} onChange={setPeriod} />;
}

export type PeriodBounds = {
  start: number;
  end: number;
  prevStart: number;
  prevEnd: number;
  /** Chassis title: "Today", "This week", "October". */
  title: string;
  /** For "vs …" under a change. */
  against: string;
};

/** The period containing `now` and the one before it, in local time. */
export function periodBounds(period: Period, now: Date = new Date()): PeriodBounds {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (period === "day") {
    const start = new Date(y, m, d).getTime();
    return {
      start,
      end: new Date(y, m, d + 1).getTime(),
      prevStart: new Date(y, m, d - 1).getTime(),
      prevEnd: start,
      title: "Today",
      against: "yesterday",
    };
  }
  if (period === "week") {
    const dow = (now.getDay() + 6) % 7; // 0 = Monday
    const start = new Date(y, m, d - dow).getTime();
    return {
      start,
      end: new Date(y, m, d - dow + 7).getTime(),
      prevStart: new Date(y, m, d - dow - 7).getTime(),
      prevEnd: start,
      title: "This week",
      against: "last week",
    };
  }
  const start = new Date(y, m, 1).getTime();
  return {
    start,
    end: new Date(y, m + 1, 1).getTime(),
    prevStart: new Date(y, m - 1, 1).getTime(),
    prevEnd: start,
    title: now.toLocaleDateString("en-US", { month: "long" }),
    against: lastMonthName(now.getTime()),
  };
}

/** Bounds that stay identical (same object) for the whole day, so the Convex
 *  query they feed is not re-subscribed on every render. */
export function usePeriodBounds(period: Period): PeriodBounds {
  const day = new Date().toDateString();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => periodBounds(period), [period, day]);
}
