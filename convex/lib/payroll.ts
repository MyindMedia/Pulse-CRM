/* Pure payroll math. Dependency-free + unit-tested. Money is in integer cents,
   time in epoch ms. Hourly pay = clocked hours x hourly rate. Salary pay is the
   annual salary prorated over the reporting window (hours are still tracked for
   visibility but don't change a salaried teammate's pay). */

const HOUR_MS = 3_600_000;
const YEAR_MS = 365 * 86_400_000;

/** Hours between two timestamps, floored at 0. */
export function hoursBetween(inAt: number, outAt: number): number {
  return Math.max(0, (outAt - inAt) / HOUR_MS);
}

/** Pay for clocked hours at an hourly rate (cents/hour). */
export function hourlyPayCents(hours: number, rateCents: number): number {
  return Math.round(hours * rateCents);
}

/** Annual salary (cents) prorated across a window of `periodMs`. */
export function salaryPeriodCents(annualCents: number, periodMs: number): number {
  if (periodMs <= 0) return 0;
  return Math.round(annualCents * (periodMs / YEAR_MS));
}

export type TimeEntryLite = {
  clockInAt: number;
  clockOutAt?: number;
  rateCentsSnapshot?: number;
};

export type MemberPayLite = {
  payType?: "hourly" | "salary";
  payRateCents?: number;
};

/** Hours + pay for one member over a window, given their entries + pay config.
 *  `nowMs` closes any still-open entry; `periodMs` is the window for salary
 *  proration. Hourly pay uses each entry's frozen snapshot rate when present,
 *  falling back to the member's current rate. */
export function memberPay(
  entries: TimeEntryLite[],
  pay: MemberPayLite,
  nowMs: number,
  periodMs: number,
): { hours: number; payCents: number } {
  let hours = 0;
  let hourlyCents = 0;
  for (const e of entries) {
    const end = e.clockOutAt ?? nowMs;
    const h = hoursBetween(e.clockInAt, end);
    hours += h;
    const rate = e.rateCentsSnapshot ?? pay.payRateCents ?? 0;
    hourlyCents += hourlyPayCents(h, rate);
  }
  let payCents = 0;
  if (pay.payType === "hourly") payCents = hourlyCents;
  else if (pay.payType === "salary") payCents = salaryPeriodCents(pay.payRateCents ?? 0, periodMs);
  return { hours, payCents };
}
