import { describe, it, expect } from "vitest";
import {
  offPeakRoomCents,
  offPeakPctAt,
  offPeakWindowError,
  bestOfOffPeakAndPromo,
  describeWindow,
  localWeekdayHour,
} from "./offPeak";
import { localMidnight } from "./roomBlockRange";

const TZ = "America/New_York";
const HOUR = 3_600_000;
// Monday 2026-10-19, studio time.
const MON = localMidnight(2026, 10, 19, TZ);
const WEEKDAYS_MORNING = { days: [1, 2, 3, 4], startHour: 9, endHour: 14, pct: 25 };

describe("off-peak pricing", () => {
  it("reads the weekday and hour in the studio's zone, not UTC", () => {
    expect(localWeekdayHour(MON + 23 * HOUR, TZ)).toEqual({ weekday: 1, hour: 23 });
    // 23:00 Monday in New York is already Tuesday in UTC.
    expect(new Date(MON + 23 * HOUR).getUTCDay()).toBe(2);
  });

  it("discounts only the hours inside the window", () => {
    // Mon 12:00-16:00: 12 and 13 are off-peak, 14 and 15 are not.
    const r = offPeakRoomCents({ hourlyRateCents: 10000, windows: [WEEKDAYS_MORNING], startTime: MON + 12 * HOUR, durationHours: 4, tz: TZ });
    expect(r).toEqual({ fullCents: 40000, cents: 2 * 7500 + 2 * 10000, offPeakHours: 2 });
  });

  it("prices a partial last hour by the window covering its start", () => {
    const r = offPeakRoomCents({ hourlyRateCents: 10000, windows: [WEEKDAYS_MORNING], startTime: MON + 13 * HOUR, durationHours: 1.5, tz: TZ });
    expect(r.cents).toBe(7500 + 5000);
    expect(r.offPeakHours).toBe(1);
  });

  it("charges full price on a day outside the window", () => {
    const fri = MON + 4 * 24 * HOUR;
    const r = offPeakRoomCents({ hourlyRateCents: 10000, windows: [WEEKDAYS_MORNING], startTime: fri + 10 * HOUR, durationHours: 2, tz: TZ });
    expect(r.cents).toBe(20000);
    expect(r.offPeakHours).toBe(0);
  });

  it("takes the best of overlapping windows and ignores broken ones", () => {
    const windows = [WEEKDAYS_MORNING, { days: [1], startHour: 10, endHour: 11, pct: 40 }, { days: [1], startHour: 9, endHour: 12, pct: 95 }];
    expect(offPeakPctAt(windows, MON + 10 * HOUR, TZ)).toBe(40);
    expect(offPeakPctAt(windows, MON + 9 * HOUR, TZ)).toBe(25);
  });

  it("explains a bad window to the owner", () => {
    expect(offPeakWindowError({ days: [], startHour: 9, endHour: 12, pct: 10 })).toMatch(/day/);
    expect(offPeakWindowError({ days: [1], startHour: 12, endHour: 12, pct: 10 })).toMatch(/end after/);
    expect(offPeakWindowError({ days: [7], startHour: 9, endHour: 12, pct: 10 })).toMatch(/Sunday to Saturday/);
    expect(offPeakWindowError({ days: [1], startHour: 9, endHour: 12, pct: 0 })).toMatch(/between 1% and 90%/);
    expect(offPeakWindowError(WEEKDAYS_MORNING)).toBeNull();
  });

  it("never stacks with a promo: the lower total wins, a tie goes to off-peak", () => {
    // Room $200 full, $150 off-peak, $50 add-ons.
    const base = { roomFullCents: 20000, roomOffPeakCents: 15000, addOnCents: 5000 };
    expect(bestOfOffPeakAndPromo({ ...base, promoPct: null })).toEqual({ rateCents: 20000, applied: "off_peak", offPeakSavingsCents: 5000 });
    expect(bestOfOffPeakAndPromo({ ...base, promoPct: 10 })).toMatchObject({ rateCents: 20000, applied: "off_peak" });
    expect(bestOfOffPeakAndPromo({ ...base, promoPct: 40 })).toEqual({ rateCents: 15000, applied: "promo", offPeakSavingsCents: 0 });
    expect(bestOfOffPeakAndPromo({ ...base, promoPct: 20 })).toMatchObject({ rateCents: 20000, applied: "off_peak" });
    expect(bestOfOffPeakAndPromo({ ...base, roomOffPeakCents: 20000, promoPct: null })).toEqual({ rateCents: 25000, applied: "none", offPeakSavingsCents: 0 });
  });

  it("describes a window in plain words", () => {
    expect(describeWindow(WEEKDAYS_MORNING)).toBe("Mon-Thu 9am-2pm, 25% off");
    expect(describeWindow({ days: [0, 6], startHour: 0, endHour: 12, pct: 10 })).toBe("Sun, Sat 12am-12pm, 10% off");
  });
});
