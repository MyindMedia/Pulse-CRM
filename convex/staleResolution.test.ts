import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const ORG = "pulse-demo";
const DAY = 86_400_000;

describe("automation stale resolution", () => {
  it("archives unpaid past holds, no-shows unpaid confirmed, completes paid work", async () => {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const mk = (over: Record<string, unknown>) =>
        ctx.db.insert("sessions", {
          orgId: ORG, title: "T", artistId, serviceType: "recording",
          startTime: Date.now() - 5 * DAY, endTime: Date.now() - 5 * DAY + 7_200_000,
          rateCents: 20_000, depositCents: 5_000, depositPaid: false,
          intakeCompleted: true, ...over,
        } as never);
      return {
        expiredHold: await mk({ status: "tentative" }),
        noShow: await mk({ status: "confirmed" }),
        paidDone: await mk({ status: "confirmed", depositPaid: true }),
        running: await mk({ status: "in_progress" }),
        // Future + recent rows must be untouched.
        future: await mk({ status: "tentative", startTime: Date.now() + DAY, endTime: Date.now() + DAY + 3_600_000 }),
        recent: await mk({ status: "confirmed", startTime: Date.now() - 3_600_000, endTime: Date.now() - 1_800_000 }),
      };
    });

    await t.mutation(api.automation.runNow, {});

    const get = (id: (typeof ids)[keyof typeof ids]) => t.run((ctx) => ctx.db.get(id));
    expect((await get(ids.expiredHold))?.status).toBe("cancelled");
    expect((await get(ids.expiredHold))?.autoResolved).toBe("expired_hold");
    expect((await get(ids.noShow))?.status).toBe("no_show");
    expect((await get(ids.noShow))?.autoResolved).toBe("auto_no_show");
    expect((await get(ids.paidDone))?.status).toBe("completed");
    expect((await get(ids.running))?.status).toBe("completed");
    expect((await get(ids.future))?.status).toBe("tentative");
    expect((await get(ids.recent))?.status).toBe("confirmed");
  });
});
