import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const ORG = "pulse-demo"; // demo viewer resolves to an owner on this org

async function drain(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("Pulse Agent", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "demo", tier: "growth", status: "active" });
    });
  });
  afterEach(() => vi.useRealTimers());

  it("policy: defaults, then upsert + read back", async () => {
    const d = await t.query(api.agent.getPolicy, {});
    expect(d.enabled).toBe(true);
    expect(d.autonomy).toBe("suggest");
    // "Auto low-risk" is no longer offered (truth-assistant-auto-send): a
    // request for it is stored and read back as suggest.
    await t.mutation(api.agent.updatePolicy, { autonomy: "auto_low", defaultTone: "friendly", digestEnabled: false });
    const p = await t.query(api.agent.getPolicy, {});
    expect(p.autonomy).toBe("suggest");
    expect(p.defaultTone).toBe("friendly");
    expect(p.digestEnabled).toBe(false);
  });

  it("_context summarizes only this org's data", async () => {
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", { orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" });
      await ctx.db.insert("sessions", { orgId: ORG, title: "Mix", artistId, serviceType: "mixing", startTime: Date.now() + 86400000, endTime: Date.now() + 90000000, status: "confirmed", rateCents: 20000, depositCents: 0, depositPaid: true, intakeCompleted: true });
      await ctx.db.insert("invoices", { orgId: ORG, artistId, number: "PLS-1", status: "sent", amountCents: 50000, dueDate: Date.now() - 86400000, lineItems: [] });
    });
    const cx = await t.query(internal.agent._context, { orgId: ORG });
    expect(cx.summary.upcomingSessions).toBe(1);
    expect(cx.summary.unpaidInvoices).toBe(1);
    expect(cx.summary.overdueInvoices).toBe(1);
  });

  it("_context carries inventory value, state, and depreciation", async () => {
    await t.run(async (ctx) => {
      // Two items: one depreciated (5000 -> 3000), one holding value (2000 -> 2000).
      await ctx.db.insert("equipment", {
        orgId: ORG, name: "SSL Console", category: "console", status: "in_use",
        purchaseCents: 5000_00, currentValueCents: 3000_00, condition: "good",
      });
      await ctx.db.insert("equipment", {
        orgId: ORG, name: "U87 Mic", category: "mic", status: "available",
        purchaseCents: 2000_00, currentValueCents: 2000_00,
      });
      // Another org's gear must NOT leak in.
      await ctx.db.insert("equipment", {
        orgId: "other-studio", name: "Decoy", category: "other", status: "available",
        purchaseCents: 9999_00, currentValueCents: 1_00,
      });
    });
    const cx = await t.query(internal.agent._context, { orgId: ORG });
    expect(cx.inventory.count).toBe(2);
    expect(cx.inventory.currentValueCents).toBe(5000_00);
    expect(cx.inventory.purchaseTotalCents).toBe(7000_00);
    expect(cx.inventory.depreciationCents).toBe(2000_00);
    expect(cx.inventory.inUse).toBe(1);
    expect(cx.inventory.available).toBe(1);
    expect(cx.inventory.depreciatedItems).toHaveLength(1);
    expect(cx.inventory.depreciatedItems[0].name).toBe("SSL Console");
  });

  it("_context breaks inventory value down by room (qty-aware)", async () => {
    const roomId = await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", { orgId: ORG, name: "Studio A", status: "available", bookable: true });
      // Installed in Studio A: $1,000 console + 4x $250 mics = $2,000.
      await ctx.db.insert("equipment", { orgId: ORG, name: "Console", category: "console", status: "in_use", installedInRoomId: roomId, purchaseCents: 1000_00, currentValueCents: 1000_00 });
      await ctx.db.insert("equipment", { orgId: ORG, name: "Mics", category: "mic", status: "in_use", installedInRoomId: roomId, quantity: 4, purchaseCents: 250_00, currentValueCents: 250_00 });
      // In storage: should not count toward Studio A.
      await ctx.db.insert("equipment", { orgId: ORG, name: "Spare", category: "other", status: "available", purchaseCents: 500_00, currentValueCents: 500_00 });
      return roomId;
    });
    const cx = await t.query(internal.agent._context, { orgId: ORG });
    const studioA = cx.inventory.byRoom.find((r) => r.room === "Studio A");
    expect(studioA).toBeTruthy();
    expect(studioA!.currentValueCents).toBe(2000_00); // 1000 + 4*250
    expect(studioA!.count).toBe(2);
    expect(studioA!.units).toBe(5);
    const storage = cx.inventory.byRoom.find((r) => r.room === "Storage");
    expect(storage!.currentValueCents).toBe(500_00);
    expect(roomId).toBeTruthy();
  });

  it("createRun completes via deterministic fallback (no LLM key) + stores an assistant message", async () => {
    const runId = await t.mutation(api.agent.createRun, { prompt: "How is my studio doing?" });
    await drain(t);
    const got = await t.query(api.agent.getRun, { id: runId });
    expect(got?.run.status).toBe("completed");
    expect(got?.run.source).toBe("fallback");
    expect(got?.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("agent off switch: createRun refuses, queued runs do not reach the model, saved questions are not due", async () => {
    // A run queued while the agent was on...
    const queued = await t.mutation(api.agent.createRun, { prompt: "How is my studio doing?" });
    const autoId = await t.mutation(api.agentAutomations.create, { name: "Daily sweep", prompt: "Find overdue invoices.", cadence: "daily" });
    // ...then the owner turns it off.
    await t.mutation(api.agent.updatePolicy, { enabled: false });

    await expect(t.mutation(api.agent.createRun, { prompt: "Who owes me money?" })).rejects.toThrow(/turned off/);
    await drain(t);
    const got = await t.query(api.agent.getRun, { id: queued });
    expect(got?.run.status).toBe("failed");
    expect(got?.run.error).toMatch(/turned off/);
    expect(got?.messages.some((m) => m.role === "assistant")).toBe(false);

    const due = await t.query(internal.agentAutomations._due, { orgId: ORG });
    expect(due.some((a) => a._id === autoId)).toBe(false);

    // Back on: it works again.
    await t.mutation(api.agent.updatePolicy, { enabled: true });
    const due2 = await t.query(internal.agentAutomations._due, { orgId: ORG });
    expect(due2.some((a) => a._id === autoId)).toBe(true);
  });

  it("approving an action Pulse cannot carry out does not mark it executed", async () => {
    const id = await t.run(async (ctx) => ctx.db.insert("agentApprovals", {
      orgId: ORG, actionType: "create_invoice", title: "Bill Nova for the mix", explanation: "Session done.",
      proposedPayload: { amountCents: 50000 }, riskLevel: "medium", status: "pending", createdAt: Date.now(),
    }));
    await t.mutation(api.agent.approveRequest, { id });
    await drain(t);
    const ap = await t.run(async (ctx) => ctx.db.get(id));
    expect(ap?.status).toBe("approved");
    expect(ap?.status).not.toBe("executed");
    expect(ap?.result).toMatch(/not done by Pulse/);
    expect(ap?.result).toMatch(/Payments/);
    const invoices = await t.run(async (ctx) => ctx.db.query("invoices").collect());
    expect(invoices).toHaveLength(0);
  });

  it("an approved email or text with no recipient is recorded as failed, never 'null'", async () => {
    const email = await import("./lib/email");
    const sms = await import("./lib/sms");
    const sendEmailSpy = vi.spyOn(email, "sendEmail");
    const sendSmsSpy = vi.spyOn(sms, "sendSms");
    for (const actionType of ["send_email", "send_sms"] as const) {
      const id = await t.run(async (ctx) => ctx.db.insert("agentApprovals", {
        orgId: ORG, actionType, title: "Follow up", explanation: "Standing rule.",
        proposedPayload: { body: "Thanks for coming in" }, riskLevel: "low", status: "pending", createdAt: Date.now(),
      }));
      await t.mutation(api.agent.approveRequest, { id });
      await drain(t);
      const ap = await t.run(async (ctx) => ctx.db.get(id));
      expect(ap?.status, actionType).toBe("failed");
      expect(ap?.result, actionType).toBe("not sent: no recipient");
      expect(ap?.result ?? "").not.toMatch(/null/);
    }
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(sendSmsSpy).not.toHaveBeenCalled();
    sendEmailSpy.mockRestore();
    sendSmsSpy.mockRestore();
  });

  it("the approve button needs a recipient and a message for a send", async () => {
    const { canApproveSend } = await import("./lib/agentActions");
    expect(canApproveSend("send_email", "", "Hi")).toBe(false);
    expect(canApproveSend("send_sms", "   ", "Hi")).toBe(false);
    expect(canApproveSend("send_email", "a@b.co", "  ")).toBe(false);
    expect(canApproveSend("send_email", "a@b.co", "Hi")).toBe(true);
    expect(canApproveSend("create_invoice", "", "")).toBe(true);
  });

  it("an approved assistant text to a number that replied STOP is not sent", async () => {
    const sms = await import("./lib/sms");
    const spy = vi.spyOn(sms, "sendSms");
    await t.run(async (ctx) => { await ctx.db.insert("smsOptOuts", { phone: "+15551234567", optedOut: true, updatedAt: Date.now() }); });
    const id = await t.run(async (ctx) => ctx.db.insert("agentApprovals", {
      orgId: ORG, actionType: "send_sms", title: "Remind Nova", explanation: "Session tomorrow.",
      proposedPayload: { to: "(555) 123-4567", body: "See you tomorrow" }, riskLevel: "low", status: "pending", createdAt: Date.now(),
    }));
    await t.mutation(api.agent.approveRequest, { id });
    await drain(t);
    const ap = await t.run(async (ctx) => ctx.db.get(id));
    expect(ap?.status).toBe("failed");
    expect(ap?.result).toMatch(/STOP/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a saved question's answer is shown with it", async () => {
    const id = await t.mutation(api.agentAutomations.create, { name: "Collections", prompt: "Who owes us money?", cadence: "weekly" });
    const runId = await t.mutation(internal.agentAutomations._startRun, { id });
    expect(runId).toBeTruthy();
    await t.action(internal.agent.runAgentLLM, { runId: runId!, orgId: ORG, prompt: "Who owes us money?", runType: "automation_recommendation" });
    const list = await t.query(api.agentAutomations.list, {});
    const row = list.find((a) => a._id === id)!;
    expect(row.lastAnswer?.status).toBe("completed");
    expect(row.lastAnswer?.body).toMatch(/snapshot/);
  });

  it("studioHealth returns six weighted components + an overall band", async () => {
    const h = await t.query(api.agentHealth.studioHealth, {});
    expect(h.overall).toBeGreaterThanOrEqual(0);
    expect(h.overall).toBeLessThanOrEqual(100);
    expect(h.components).toHaveLength(6);
    expect(["strong", "steady", "watch", "at risk"]).toContain(h.band);
  });

  it("memory: add, list, delete (per-org)", async () => {
    const id = await t.mutation(api.agent.addMemory, { memoryType: "business_rules", summary: "Require 50% deposit before confirming." });
    let list = await t.query(api.agent.listMemories, {});
    expect(list.find((m) => m._id === id)?.summary).toMatch(/50%/);
    await t.mutation(api.agent.deleteMemory, { id });
    list = await t.query(api.agent.listMemories, {});
    expect(list.find((m) => m._id === id)).toBeUndefined();
  });

  it("automations: create, toggle, due-detection, start-run advances schedule", async () => {
    const id = await t.mutation(api.agentAutomations.create, { name: "Weekly sweep", prompt: "Find overdue invoices.", cadence: "weekly" });
    let list = await t.query(api.agentAutomations.list, {});
    expect(list.find((a) => a._id === id)?.enabled).toBe(true);

    // Never run -> due.
    let due = await t.query(internal.agentAutomations._due, { orgId: ORG });
    expect(due.some((a) => a._id === id)).toBe(true);

    // Start a run -> lastRunAt set, runCount bumped, no longer due.
    const runId = await t.mutation(internal.agentAutomations._startRun, { id });
    expect(runId).toBeTruthy();
    list = await t.query(api.agentAutomations.list, {});
    expect(list.find((a) => a._id === id)?.runCount).toBe(1);
    due = await t.query(internal.agentAutomations._due, { orgId: ORG });
    expect(due.some((a) => a._id === id)).toBe(false);

    // Disable -> excluded from due.
    await t.mutation(api.agentAutomations.toggle, { id, enabled: false });
    due = await t.query(internal.agentAutomations._due, { orgId: ORG });
    expect(due.some((a) => a._id === id)).toBe(false);
  });

  it("autonomy: auto_trusted auto-approves a low-risk send; medium-risk still waits", async () => {
    // Auto-send now needs a named reminder to one of the studio's own clients
    // (truth-assistant-auto-send), so the low-risk send goes to a client.
    await t.run(async (ctx) => { await ctx.db.insert("artists", { orgId: ORG, name: "AB", type: "artist", email: "a@b.com", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" }); });
    const runId = await t.run((ctx) => ctx.db.insert("agentRuns", { orgId: ORG, initiatedBy: "system", runType: "analytics_review", status: "running" }));
    await t.mutation(internal.agent._finalize, {
      runId, orgId: ORG, status: "needs_approval", summary: "x", autonomy: "auto_trusted",
      approvals: [
        { actionType: "send_email", title: "Low reminder", explanation: "x", riskLevel: "low", proposedPayload: { to: "a@b.com", body: "hi", reminderKind: "session_reminder" } },
        { actionType: "send_sms", title: "Medium nudge", explanation: "x", riskLevel: "medium", proposedPayload: { to: "+1", body: "hi" } },
      ],
    });
    await drain(t);
    const list = await t.query(api.agent.listApprovals, {});
    const low = list.find((a) => a.title === "Low reminder");
    const med = list.find((a) => a.title === "Medium nudge");
    expect(["approved", "executed"]).toContain(low?.status); // auto-ran
    expect(med?.status).toBe("pending"); // still gated
  });

  it("approval: approve schedules execution; reject closes it", async () => {
    const { approveId, rejectId } = await t.run(async (ctx) => {
      const approveId = await ctx.db.insert("agentApprovals", { orgId: ORG, actionType: "send_email", title: "Follow up", explanation: "x", proposedPayload: { to: "x@y.com", subject: "Hi", body: "Hello" }, riskLevel: "low", status: "pending", createdAt: Date.now() });
      const rejectId = await ctx.db.insert("agentApprovals", { orgId: ORG, actionType: "send_sms", title: "Nudge", explanation: "x", proposedPayload: { to: "+14045550000", body: "yo" }, riskLevel: "low", status: "pending", createdAt: Date.now() });
      return { approveId, rejectId };
    });
    await t.mutation(api.agent.approveRequest, { id: approveId });
    await t.mutation(api.agent.rejectRequest, { id: rejectId });
    await drain(t);
    const list = await t.query(api.agent.listApprovals, {});
    const approved = list.find((a) => a._id === approveId);
    const rejected = list.find((a) => a._id === rejectId);
    // send_email with no Resend key simulates -> executed; reject -> rejected.
    expect(["executed", "approved"]).toContain(approved?.status);
    expect(rejected?.status).toBe("rejected");
  });
});
