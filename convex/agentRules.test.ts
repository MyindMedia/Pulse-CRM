import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { describeRule, fillTemplate } from "./lib/ruleSpec";
import type { Id } from "./_generated/dataModel";

/* The loop this closes: the agent suggests, the owner approves, and next week
   it suggests the same thing again. A rule answers it permanently.

   The safety line these tests hold: a rule may run unattended, but it may not
   invent a send path that skips the approval queue. */

const OWNER = "u_own";
const HOUR = 3_600_000;

async function studio(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "Vault", slug: "vault", plan: "studio", tier: "label", status: "active",
    });
    await ctx.db.insert("members", {
      orgId: "org1", name: "Owner", role: "owner", skills: [], clerkUserId: OWNER,
    });
    const artist = await ctx.db.insert("artists", {
      orgId: "org1", name: "Ari", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const room = await ctx.db.insert("rooms", {
      orgId: "org1", name: "A", hourlyRateCents: 10_000, status: "available",
    });
    return { artist, room };
  });
}

describe("rule vocabulary", () => {
  it("describes a rule in one sentence", () => {
    expect(describeRule({ trigger: "session.no_show", action: "notify_team" }))
      .toBe("When somebody does not show, tell the team.");
    expect(describeRule({ trigger: "invoice.overdue", action: "email_client", thresholdDays: 14 }))
      .toBe("When an invoice goes overdue for 14 days, email the client.");
    expect(describeRule({ trigger: "session.upcoming", action: "sms_client", thresholdHours: 2 }))
      .toBe("When a session is coming up in 2 hours, text the client.");
  });

  it("fills tokens from our own records, and leaves a typo visible", () => {
    expect(fillTemplate("Hi {client}, this is {studio}.", { client: "Ari", studio: "Vault" }))
      .toBe("Hi Ari, this is Vault.");
    // An unknown token stays on screen so it shows up in a preview rather than
    // silently sending an empty sentence.
    expect(fillTemplate("Hi {nope}", {})).toBe("Hi {nope}");
  });
});

describe("promoting an insight", () => {
  it("turns a suggestion into a standing rule and stops asking", async () => {
    const t = convexTest(schema);
    await studio(t);
    const insightId = await t.run((ctx) =>
      ctx.db.insert("agentInsights", {
        orgId: "org1",
        title: "Chase no-shows the same day",
        severity: "opportunity",
        explanation: "You have approved this three weeks running.",
        status: "active",
        createdAt: Date.now(),
      }),
    );
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.agentRules.promoteInsight, {
      insightId,
      trigger: "session.no_show",
      action: "notify_team",
      template: "{client} did not show. Call them today.",
    });

    const rules = await asOwner.query(api.agentRules.list, {});
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ name: "Chase no-shows the same day", enabled: true });
    expect(rules[0].description).toBe("When somebody does not show, tell the team.");
    // Provenance survives, so the rule can be explained months later.
    expect(rules[0].sourceNote).toContain("three weeks running");

    // Answered permanently, so it stops asking.
    const insight = await t.run((ctx) => ctx.db.get(insightId));
    expect(insight!.status).toBe("dismissed");
  });

  it("refuses an insight from another studio", async () => {
    const t = convexTest(schema);
    await studio(t);
    const foreign = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org2", name: "Other", slug: "other", plan: "solo" });
      return await ctx.db.insert("agentInsights", {
        orgId: "org2", title: "Theirs", severity: "info",
        explanation: "x", status: "active", createdAt: Date.now(),
      });
    });
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await expect(
      asOwner.mutation(api.agentRules.promoteInsight, {
        insightId: foreign, trigger: "session.no_show", action: "notify_team", template: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("firing", () => {
  async function ruleFor(
    t: ReturnType<typeof convexTest>,
    action: "notify_team" | "email_client",
  ) {
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.agentRules.create, {
      name: "Thank them",
      trigger: "session.completed",
      action,
      template: "Thanks for coming in, {client}.",
    });
    return asOwner;
  }

  async function completeASession(
    t: ReturnType<typeof convexTest>,
    ids: { artist: Id<"artists">; room: Id<"rooms"> },
  ) {
    const now = Date.now();
    const sessionId = await t.run((ctx) =>
      ctx.db.insert("sessions", {
        orgId: "org1", title: "Ari - A", artistId: ids.artist, roomId: ids.room,
        serviceType: "recording", startTime: now - 2 * HOUR, endTime: now,
        status: "confirmed", rateCents: 20_000, depositCents: 0,
        depositPaid: true, amountPaidCents: 20_000, intakeCompleted: true,
      }),
    );
    await t.withIdentity({ subject: OWNER, orgId: "org1" })
      .mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    return sessionId;
  }

  it("raises an insight for a team-facing rule", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    const asOwner = await ruleFor(t, "notify_team");
    await completeASession(t, ids);

    const insights = await t.run((ctx) => ctx.db.query("insights").collect());
    const fired = insights.find((i) => i.title === "Thank them");
    expect(fired).toBeTruthy();
    expect(fired!.body).toBe("Thanks for coming in, Ari.");

    const rules = await asOwner.query(api.agentRules.list, {});
    expect(rules[0].runCount).toBe(1);
    expect(rules[0].lastRunAt).toBeTruthy();
  });

  it("routes a client-facing rule through the approval queue, never straight out", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    await ruleFor(t, "email_client");
    await completeASession(t, ids);

    const approvals = await t.run((ctx) => ctx.db.query("agentApprovals").collect());
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      actionType: "send_email", status: "pending", riskLevel: "low",
    });
    expect(approvals[0].explanation).toContain("standing rule");
  });

  it("does not fire a paused rule", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    const asOwner = await ruleFor(t, "notify_team");
    const [rule] = await asOwner.query(api.agentRules.list, {});
    await asOwner.mutation(api.agentRules.setEnabled, {
      id: rule._id as Id<"agentRules">, enabled: false,
    });

    await completeASession(t, ids);
    const insights = await t.run((ctx) => ctx.db.query("insights").collect());
    expect(insights.find((i) => i.title === "Thank them")).toBeUndefined();
  });

  it("only fires rules for the trigger that happened", async () => {
    const t = convexTest(schema);
    const ids = await studio(t);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.agentRules.create, {
      name: "No-show only", trigger: "session.no_show", action: "notify_team", template: "x",
    });
    await completeASession(t, ids);
    const insights = await t.run((ctx) => ctx.db.query("insights").collect());
    expect(insights.find((i) => i.title === "No-show only")).toBeUndefined();
  });

  it("keeps only the threshold its trigger reads", async () => {
    const t = convexTest(schema);
    await studio(t);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.agentRules.create, {
      name: "Overdue chase",
      trigger: "invoice.overdue",
      action: "notify_team",
      template: "x",
      thresholdDays: 14,
      thresholdHours: 99,   // stale value from a changed dropdown
    });
    const [rule] = await asOwner.query(api.agentRules.list, {});
    expect(rule.thresholdDays).toBe(14);
    expect(rule.thresholdHours).toBeUndefined();
  });

  it("clamps an absurd threshold", async () => {
    const t = convexTest(schema);
    await studio(t);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await asOwner.mutation(api.agentRules.create, {
      name: "Silly", trigger: "client.dormant", action: "notify_team",
      template: "x", thresholdDays: 99_999,
    });
    const [rule] = await asOwner.query(api.agentRules.list, {});
    expect(rule.thresholdDays).toBe(730);
  });

  it("refuses a rule with nothing to say", async () => {
    const t = convexTest(schema);
    await studio(t);
    const asOwner = t.withIdentity({ subject: OWNER, orgId: "org1" });
    await expect(
      asOwner.mutation(api.agentRules.create, {
        name: "Empty", trigger: "session.completed", action: "notify_team", template: "   ",
      }),
    ).rejects.toMatchObject({ data: { code: "RULE_EMPTY" } });
  });
});
