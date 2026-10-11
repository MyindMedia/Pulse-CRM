import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* The AI context queries are internal (pentest 2026-10-11, CWE-863: they
   were public, so any studio member could read rates and revenue), and money
   follows the caller's sight: a draft for someone who may not see money
   cannot contain it. */

const ORG = "org_ctx";

describe("aiContext money", () => {
  let t: ReturnType<typeof convexTest>;
  let sessionId: Id<"sessions">;

  beforeEach(async () => {
    t = convexTest(schema);
    sessionId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Ctx Studio", slug: "ctx", tier: "growth", status: "active" });
      await ctx.db.insert("members", { orgId: ORG, name: "Eng", role: "engineer", clerkUserId: "u_eng", skills: [] });
      await ctx.db.insert("members", { orgId: ORG, name: "Mgr", role: "manager", clerkUserId: "u_mgr", skills: [] });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("sessions", {
        orgId: ORG, title: "Tracking", artistId, serviceType: "recording",
        startTime: Date.now() - 3 * 3_600_000, endTime: Date.now() - 3_600_000, status: "completed",
        rateCents: 60000, depositCents: 20000, depositPaid: true, intakeCompleted: false,
      });
    });
  });

  const eng = () => t.withIdentity({ subject: "u_eng", orgId: ORG });
  const mgr = () => t.withIdentity({ subject: "u_mgr", orgId: ORG });

  it("drops session money for an engineer and keeps it for a manager", async () => {
    for (const q of [internal.aiContext.sessionRecapContext, internal.aiContext.prepPacketContext, internal.aiContext.reminderContext]) {
      const e = await eng().query(q, { sessionId });
      expect(e?.session).toBeTruthy();
      expect(e?.session).not.toHaveProperty("rateCents");
      expect(e?.session).not.toHaveProperty("depositCents");
      const m = await mgr().query(q, { sessionId });
      expect(m?.session).toMatchObject({ rateCents: 60000, depositCents: 20000 });
    }
  });

  it("gives the revenue briefing and rate-cut context only to someone who may see money", async () => {
    expect(await eng().query(internal.aiContext.weeklyBriefingContext, {})).toBeNull();
    expect(await eng().query(internal.aiContext.rateCutContext, {})).toBeNull();
    const briefing = await mgr().query(internal.aiContext.weeklyBriefingContext, {});
    expect(briefing).toHaveProperty("completedRevenueCents");
    expect(await mgr().query(internal.aiContext.rateCutContext, {})).not.toBeNull();
  });
});
