import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/* client-messages-review-after-autocomplete: "Thanks for recording" went to
   clients whose session the stale sweep auto-completed, or who texted NO,
   so people who never recorded were thanked and asked for a review. */
const ORG = "org_rev";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function seed(t: ReturnType<typeof convexTest>, endAgo: number, extra: Record<string, unknown>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Rev Studio", slug: "rev", tier: "growth", status: "active" } as never);
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", email: "nova@r.test", phone: "+14045550123",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const end = Date.now() - endAgo;
    await ctx.db.insert("sessions", {
      orgId: ORG, title: "Mix", artistId, serviceType: "mixing", startTime: end - 2 * HOUR, endTime: end,
      status: "completed", rateCents: 20000, depositCents: 6000, depositPaid: true, amountPaidCents: 6000, intakeCompleted: true,
      ...extra,
    } as never);
  });
}

const reviewMails = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "review.request"));

describe("review request only after a real session", () => {
  it("no email for a session the stale sweep auto-completed", async () => {
    const t = convexTest(schema);
    await seed(t, 2 * DAY, { autoResolved: "auto_completed" });
    await t.mutation(internal.automation.tick, {});
    expect(await reviewMails(t)).toHaveLength(0);
  });

  it("no email for a session the client declined by text", async () => {
    const t = convexTest(schema);
    await seed(t, 2 * DAY, { clientDeclinedAt: Date.now() - 3 * DAY });
    await t.mutation(internal.automation.tick, {});
    expect(await reviewMails(t)).toHaveLength(0);
  });

  it("still emails a normal completed session", async () => {
    const t = convexTest(schema);
    await seed(t, 2 * DAY, {});
    await t.mutation(internal.automation.tick, {});
    expect(await reviewMails(t)).toHaveLength(1);
  });

  it("no review text for an auto-completed or declined session", async () => {
    const t = convexTest(schema);
    await seed(t, 3 * HOUR, { clientDeclinedAt: Date.now() - DAY });
    const due = await t.query(internal.smsFlows._lifecycleDue, { orgId: ORG } as never);
    expect(due.reviewRequests).toHaveLength(0);
  });
});
