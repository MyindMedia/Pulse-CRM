import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { dayWord } from "./lib/tz";

/* client-messages-reminder-tomorrow: the 24h reminder fires for anything 2h
   to 24h out, so a session later the same day was told "tomorrow", and
   pending requests were reminded as if booked. */
const HOUR = 3_600_000;
const ORG = "org_day";
const TZ = "America/New_York";
// 9:00 in New York on Nov 12, 2026 (EST, UTC-5).
const NOW = Date.UTC(2026, 10, 12, 14, 0);

async function seed(t: ReturnType<typeof convexTest>, startTime: number, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Day Studio", slug: "day", tier: "growth", status: "active", timezone: TZ } as never);
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", email: "nova@d.test", phone: "404-555-0111",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    await ctx.db.insert("sessions", {
      orgId: ORG, title: "Mix", artistId, serviceType: "mixing", startTime, endTime: startTime + 2 * HOUR,
      status: "confirmed", rateCents: 20000, depositCents: 0, depositPaid: true, intakeCompleted: true, ...extra,
    } as never);
  });
}

const mails = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("notifications").collect());

describe("reminder day word", () => {
  it("dayWord follows the studio's calendar", () => {
    expect(dayWord(NOW + 8 * HOUR, NOW, TZ)).toBe("today"); // 17:00 same day
    expect(dayWord(NOW + 20 * HOUR, NOW, TZ)).toBe("tomorrow"); // 05:00 next day
  });

  it("a session later today is reminded as today", async () => {
    const t = convexTest(schema);
    await seed(t, NOW + 8 * HOUR);
    await t.mutation(internal.reminders.sweep, { nowMs: NOW });
    const mail = (await mails(t)).find((n) => n.recipient === "nova@d.test");
    expect(mail?.subject).toContain("is today");
    expect(mail?.body).toContain("starts today");
    expect(mail?.body).not.toContain("tomorrow");
  });

  it("a session tomorrow still says tomorrow", async () => {
    const t = convexTest(schema);
    await seed(t, NOW + 20 * HOUR);
    await t.mutation(internal.reminders.sweep, { nowMs: NOW });
    const mail = (await mails(t)).find((n) => n.recipient === "nova@d.test");
    expect(mail?.subject).toContain("is tomorrow");
  });

  it("a pending request gets no 'your session starts' reminder", async () => {
    const t = convexTest(schema);
    await seed(t, NOW + 8 * HOUR, { status: "tentative", requestStatus: "pending" });
    await t.mutation(internal.reminders.sweep, { nowMs: NOW });
    expect(await mails(t)).toHaveLength(0);
  });
});
