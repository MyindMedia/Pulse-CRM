import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeRisk, effectiveAutonomy } from "./agent";
import { normalizeEmail, CLIENT_SCAN_LIMIT, stampContact } from "./lib/agentAutoSend";
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
    // On file since long before any conversation (contact stamp at t=1).
    const artist = (orgId: string, name: string, email?: string, phone?: string) =>
      ctx.db.insert("artists", { orgId, name, type: "artist", email, phone, contactOnFile: stampContact(undefined, { email, phone }, 1), genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
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

  it("past the client scan limit a recipient that was not read waits (fails closed), and one scan serves the run", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < CLIENT_SCAN_LIMIT; i++) {
        await ctx.db.insert("artists", { orgId: A, name: `C${i}`, type: "artist", email: `c${i}@example.com`, contactOnFile: { email: `c${i}@example.com`, emailAt: 1 }, genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      }
      await ctx.db.insert("artists", { orgId: A, name: "Late", type: "artist", email: "late@example.com", contactOnFile: { email: "late@example.com", emailAt: 1 }, genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
    });
    const rows = await finalize(t, [reminder(), reminder({ payload: { to: "late@example.com" } }), reminder({ payload: { to: "c5@example.com" } })]);
    expect(rows.map((r) => r.status)).toEqual(["executed", "pending", "executed"]);
  }, 30_000);

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

  it("U-08b: an agency member acting inside the studio cannot turn auto-send on there either", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: "ag", name: "AG", slug: "ag", plan: "max", status: "active", ownerClerkUserId: "u_ag", ownerEmail: "o@x.com" });
      await ctx.db.insert("agencyMembers", { agencyId: "ag", clerkUserId: "u_ag", email: "o@x.com", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: "sub_max", name: "Max", slug: "m", tier: "max", status: "active", agencyId: "ag" });
    });
    const agency = t.withIdentity({ subject: "u_ag", name: "Owner", orgId: "ag", orgType: "agency" });
    await expect(agency.mutation(api.agent.updatePolicy, { autonomy: "auto_trusted" })).rejects.toThrow(/owner/);
    const pol = await t.run(async (ctx) => ctx.db.query("agentPolicies").withIndex("by_org", (q) => q.eq("orgId", "sub_max")).first());
    expect(pol?.autonomy ?? "suggest").toBe("suggest");
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

  it("H210-01: an address a stranger typed into the public check-in (a visitor_qr lead) waits for a person", async () => {
    const { t } = await setup();
    await t.mutation(api.visitors.register, { slug: "a", termsAccepted: true, name: "Mallory", email: "attacker@example.com", phone: "+14045559999" });
    // Even a week later, a lead is not a client.
    vi.advanceTimersByTime(30 * 24 * 3600_000);
    const rows = await finalize(t, [
      reminder({ payload: { to: "attacker@example.com" } }),
      reminder({ actionType: "send_sms", payload: { to: "+14045559999" } }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(emailSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
  });

  it("H210-01: the public check-in cannot replace an existing client's phone, so a text never goes to the stranger's number", async () => {
    const { t } = await setup();
    await t.mutation(api.visitors.register, { slug: "a", termsAccepted: true, name: "Nova", email: "nova@example.com", phone: "+14045559999" });
    const nova = await t.run(async (ctx) => (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", A)).collect()).find((a) => a.name === "Nova")!);
    expect(nova.phone).toBe("(404) 555-0101");
    vi.advanceTimersByTime(30 * 24 * 3600_000);
    const rows = await finalize(t, [
      reminder({ actionType: "send_sms", payload: { to: "+14045559999" } }),
      reminder({ actionType: "send_sms", payload: { to: "+14045550101" } }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["pending", "executed"]);
    expect(smsSpy).toHaveBeenCalledTimes(1);
  });

  it("H210-01: the public booking form cannot replace an existing client's phone either", async () => {
    const { t } = await setup();
    const room = await t.run((ctx) => ctx.db.insert("rooms", { orgId: A, name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30 }));
    await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@example.com", clientPhone: "+14045559999", startTime: Date.now() + 7 * 24 * 3600_000, durationHours: 2,
    });
    const novas = await t.run(async (ctx) => (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", A)).collect()).filter((a) => a.name === "Nova"));
    expect(novas).toHaveLength(1);
    expect(novas[0].phone).toBe("(404) 555-0101");
    expect(novas[0].contactOnFile?.phoneAt).toBe(1);
  });

  it("H210-01: a contact that went on file during the conversation the assistant read waits", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      // Client for years, but this address only went on file yesterday.
      await ctx.db.insert("artists", { orgId: A, name: "New", type: "artist", email: "new@example.com", contactOnFile: { email: "new@example.com", emailAt: Date.now() - 24 * 3600_000 }, genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      // Address changed by a path that did not re-stamp: the stamp names another address.
      await ctx.db.insert("artists", { orgId: A, name: "Moved", type: "artist", email: "moved-now@example.com", contactOnFile: { email: "moved-before@example.com", emailAt: 1 }, genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      // Written before stamps existed: unproven.
      await ctx.db.insert("artists", { orgId: A, name: "Legacy", type: "artist", email: "legacy@example.com", genres: [], tags: [], status: "vip", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      // A lead sharing a client's address makes that address doubtful.
      await ctx.db.insert("artists", { orgId: A, name: "Dupe", type: "artist", phone: "+14045550101", genres: [], tags: [], status: "lead", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
    });
    const rows = await finalize(t, [
      reminder({ payload: { to: "new@example.com" } }),
      reminder({ payload: { to: "moved-now@example.com" } }),
      reminder({ payload: { to: "moved-before@example.com" } }),
      reminder({ payload: { to: "legacy@example.com" } }),
      reminder({ actionType: "send_sms", payload: { to: "+14045550101" } }),
      reminder(),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["pending", "pending", "pending", "pending", "pending", "executed"]);
  });

  it("H210-01: the legacy-contact report changes nothing unless applied, and applied stamps count only after a full window", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", { orgId: A, name: "Legacy", type: "artist", email: "legacy@example.com", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      await ctx.db.insert("artists", { orgId: A, name: "Lead", type: "artist", email: "lead@example.com", genres: [], tags: [], status: "lead", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
    });
    const report = await t.mutation(internal.clientContacts.stampLegacyContacts, { orgId: A });
    expect(report.applied).toBe(false);
    expect(report.unproven.map((u) => u.email)).toEqual(["legacy@example.com"]);
    const before = await t.run(async (ctx) => (await ctx.db.query("artists").collect()).find((a) => a.name === "Legacy")!);
    expect(before.contactOnFile).toBeUndefined();
    await t.mutation(internal.clientContacts.stampLegacyContacts, { orgId: A, apply: true });
    let [row] = await finalize(t, [reminder({ payload: { to: "legacy@example.com" } })]);
    expect(row.status).toBe("pending");
    vi.advanceTimersByTime(8 * 24 * 3600_000);
    await t.run(async (ctx) => { for (const r of await ctx.db.query("agentApprovals").collect()) await ctx.db.delete(r._id); });
    [row] = await finalize(t, [reminder({ payload: { to: "legacy@example.com" } })]);
    expect(row.status).toBe("executed");
    // A second apply changes nothing.
    const again = await t.mutation(internal.clientContacts.stampLegacyContacts, { orgId: A, apply: true });
    expect(again.unproven).toEqual([]);
  });

  /* Round 3 (H210-R2-01, H210-R2-02): a contact counts as on file only if
     staff entered it or the client completed a booking made with it. */
  const DAY = 24 * 3600_000;
  type TS = Awaited<ReturnType<typeof setup>>["t"];
  async function addNoPhoneClient(t: TS) {
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", { orgId: A, name: "Echo", type: "artist", email: "echo@example.com", contactOnFile: stampContact(undefined, { email: "echo@example.com" }, 1), genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
    });
  }
  const echo = (t: TS) => t.run(async (ctx) => (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", A)).collect()).find((a) => a.name === "Echo")!);
  const roomA = (t: TS) => t.run((ctx) => ctx.db.insert("rooms", { orgId: A, name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30 }));

  it("H210-R2-02: a phone typed into the public check-in for a client with no phone is never on file, even 8 days later", async () => {
    const { t } = await setup();
    await addNoPhoneClient(t);
    await t.mutation(api.visitors.register, { slug: "a", termsAccepted: true, name: "Echo", email: "echo@example.com", phone: "+14045558888" });
    const row = await echo(t);
    expect(row.phone).toBe("+14045558888");
    expect(row.contactOnFile).toEqual({ email: "echo@example.com", emailAt: 1 });
    vi.advanceTimersByTime(8 * DAY);
    const rows = await finalize(t, [
      reminder({ actionType: "send_sms", payload: { to: "+14045558888" } }),
      reminder({ payload: { to: "echo@example.com" } }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["pending", "executed"]);
    expect(smsSpy).not.toHaveBeenCalled();
  });

  it("H210-R2-01: a phone typed into the public booking form for a client with no phone is never on file, even 8 days later", async () => {
    const { t } = await setup();
    await addNoPhoneClient(t);
    const room = await roomA(t);
    await t.mutation(api.booking.createBooking, { roomId: room, clientName: "Echo", clientEmail: "echo@example.com", clientPhone: "+14045558888", startTime: Date.now() + 30 * DAY, durationHours: 2 });
    const row = await echo(t);
    expect(row.phone).toBe("+14045558888");
    expect(row.contactOnFile).toEqual({ email: "echo@example.com", emailAt: 1 });
    vi.advanceTimersByTime(8 * DAY);
    const [r] = await finalize(t, [reminder({ actionType: "send_sms", payload: { to: "+14045558888" } })]);
    expect(r.status).toBe("pending");
    // (The booking's own deposit-hold text to the booker is not the assistant.)
    expect(smsSpy.mock.calls.some((c: unknown[]) => (c[0] as { body: string }).body === "See you tomorrow")).toBe(false);
  });

  it("H210-R2-02: a public check-in never stamps an unstamped legacy row, and a filled one leaves the legacy report", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", { orgId: A, name: "Old", type: "artist", email: "old@example.com", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      await ctx.db.insert("artists", { orgId: A, name: "OldPhone", type: "artist", email: "oldphone@example.com", phone: "+14045557777", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
    });
    // Nothing filled: still unstamped and still in the owner's report.
    await t.mutation(api.visitors.register, { slug: "a", termsAccepted: true, name: "OldPhone", email: "oldphone@example.com", phone: "+14045550000" });
    // A phone filled from the form: marked as not from staff, so the report never stamps it.
    await t.mutation(api.visitors.register, { slug: "a", termsAccepted: true, name: "Old", email: "old@example.com", phone: "+14045556666" });
    const rows = await t.run(async (ctx) => (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", A)).collect()));
    expect(rows.find((a) => a.name === "OldPhone")!.contactOnFile).toBeUndefined();
    expect(rows.find((a) => a.name === "Old")!.contactOnFile).toEqual({});
    const report = await t.mutation(internal.clientContacts.stampLegacyContacts, { orgId: A, apply: true });
    expect(report.unproven.map((u) => u.email)).toEqual(["oldphone@example.com"]);
    vi.advanceTimersByTime(8 * DAY);
    const r = await finalize(t, [
      reminder({ actionType: "send_sms", payload: { to: "+14045556666" } }),
      reminder({ payload: { to: "old@example.com" } }),
    ]);
    expect(r.map((x) => x.status)).toEqual(["pending", "pending"]);
  });

  it("H210-R2-01: a new client from the public booking form is on file only once that booking is completed", async () => {
    const { t, owner } = await setup();
    const room = await roomA(t);
    const { sessionId } = (await t.mutation(api.booking.createBooking, { roomId: room, clientName: "Fern", clientEmail: "Fern@Example.com", clientPhone: "(404) 555-4444", startTime: Date.now() + DAY, durationHours: 2 })) as { sessionId: Id<"sessions"> };
    const fern = () => t.run(async (ctx) => (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", A)).collect()).find((a) => a.name === "Fern")!);
    expect((await fern()).contactOnFile).toEqual({});
    // The public checkout page never returns the contact the booking was made with.
    const page = (await t.query(api.booking.booking, { sessionId })) as Record<string, unknown> | null;
    expect(page).not.toBeNull();
    expect(page!.bookedContact).toBeUndefined();
    expect(await t.run(async (ctx) => (await ctx.db.get(sessionId))!.bookedContact)).toEqual({ email: "fern@example.com", phone: "+14045554444" });
    // Made active by staff without a completed booking: still not on file.
    await t.run(async (ctx) => { const f = (await ctx.db.query("artists").collect()).find((a) => a.name === "Fern")!; await ctx.db.patch(f._id, { status: "active" }); });
    vi.advanceTimersByTime(8 * DAY);
    let r = await finalize(t, [reminder({ payload: { to: "fern@example.com" } })]);
    expect(r[0].status).toBe("pending");
    await t.run(async (ctx) => { for (const x of await ctx.db.query("agentApprovals").collect()) await ctx.db.delete(x._id); });
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    const stamped = (await fern()).contactOnFile!;
    expect(stamped.email).toBe("fern@example.com");
    expect(stamped.phone).toBe("+14045554444");
    // Completing again (or a second completion path) keeps the first stamp.
    const at = stamped.emailAt;
    vi.advanceTimersByTime(DAY);
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    expect((await fern()).contactOnFile!.emailAt).toBe(at);
    // On file from the completion, so only after a full message window.
    r = await finalize(t, [reminder({ payload: { to: "fern@example.com" } })]);
    expect(r[0].status).toBe("pending");
    vi.advanceTimersByTime(8 * DAY);
    await t.run(async (ctx) => { for (const x of await ctx.db.query("agentApprovals").collect()) await ctx.db.delete(x._id); });
    r = await finalize(t, [reminder({ payload: { to: "fern@example.com" } }), reminder({ actionType: "send_sms", payload: { to: "+14045554444" } })]);
    expect(r.map((x) => x.status)).toEqual(["executed", "executed"]);
  });

  it("H210-R2-01: completing a booking made with another phone never stamps the client's own number or the typed one", async () => {
    const { t, owner } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", { orgId: A, name: "Gil", type: "artist", email: "gil@example.com", phone: "+14045553333", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
    });
    const room = await roomA(t);
    const { sessionId } = (await t.mutation(api.booking.createBooking, { roomId: room, clientName: "Gil", clientEmail: "gil@example.com", clientPhone: "+14045552222", startTime: Date.now() + DAY, durationHours: 2 })) as { sessionId: Id<"sessions"> };
    await owner.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
    const gil = await t.run(async (ctx) => (await ctx.db.query("artists").collect()).find((a) => a.name === "Gil")!);
    expect(gil.phone).toBe("+14045553333");
    // The email the booking was made with goes on file; the phone does not.
    expect(gil.contactOnFile?.email).toBe("gil@example.com");
    expect(gil.contactOnFile?.phone).toBeUndefined();
  });

  it("H210-R2-01: the automatic completion stamps a booking that ran, never one that was paid but never started", async () => {
    const { t } = await setup();
    const ids = await t.run(async (ctx) => {
      const mk = (name: string, email: string) => ctx.db.insert("artists", { orgId: A, name, type: "artist", email, contactOnFile: {}, genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      const ran = await mk("Ran", "ran@example.com");
      const never = await mk("Never", "never@example.com");
      const base = { orgId: A, serviceType: "recording" as const, rateCents: 10000, depositCents: 10000, depositPaid: true, intakeCompleted: false, source: "public_booking" };
      // Ran: in progress and ended an hour ago (normal completion).
      await ctx.db.insert("sessions", { ...base, title: "Ran", artistId: ran, startTime: Date.now() - 3 * 3600_000, endTime: Date.now() - 3600_000, status: "in_progress", amountPaidCents: 10000, bookedContact: { email: "ran@example.com" } });
      // Never started: confirmed, paid, ended two days ago (stale auto-complete).
      await ctx.db.insert("sessions", { ...base, title: "Never", artistId: never, startTime: Date.now() - 50 * 3600_000, endTime: Date.now() - 48 * 3600_000, status: "confirmed", amountPaidCents: 5000, bookedContact: { email: "never@example.com" } });
      return { ran, never };
    });
    await t.mutation(internal.automation.tick, {});
    const [ran, never] = await t.run(async (ctx) => [await ctx.db.get(ids.ran), await ctx.db.get(ids.never)]);
    expect(ran!.contactOnFile?.email).toBe("ran@example.com");
    expect(never!.contactOnFile).toEqual({});
    const statuses = await t.run(async (ctx) => (await ctx.db.query("sessions").collect()).map((x) => [x.title, x.status]));
    expect(Object.fromEntries(statuses)).toEqual({ Ran: "completed", Never: "completed" });
  });

  it("H210-R2-01: the public membership sign-up never puts an email on file", async () => {
    const { t } = await setup();
    const id = await t.mutation(internal.memberships._findOrCreateArtistForSub, { orgId: A, name: "Hal", email: "hal@example.com" });
    const hal = await t.run((ctx) => ctx.db.get(id));
    expect(hal?.contactOnFile).toEqual({});
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
