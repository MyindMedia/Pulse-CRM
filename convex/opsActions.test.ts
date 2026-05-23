import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const ORG = "pulse-demo"; // demo viewer resolves to this org with owner caps

async function drain(t: ReturnType<typeof convexTest>) {
  // runAfter(0) chains (approve -> execute). Fake timers + finishAll drains them.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

function emailAction(orgId: string) {
  return {
    orgId,
    type: "payment_reminder" as const,
    priority: "high" as const,
    title: "Chase invoice INV-1",
    rationale: "past due",
    entityType: "invoice",
    entityId: "inv1",
    payload: { kind: "email" as const, to: "client@x.com", subject: "Past due", body: "please pay", notifyKind: "invoice.reminder" },
    status: "proposed" as const,
    autonomy: false,
    source: "rule" as const,
    dedupeKey: "payment_reminder:inv1",
    createdAt: Date.now(),
  };
}

describe("opsActions queue + execution", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("approve -> execute sends + logs notification + audit, and is idempotent", async () => {
    const id = await t.run(async (ctx) => ctx.db.insert("opsActions", emailAction(ORG)));

    await t.mutation(api.opsActions.approve, { id });
    await drain(t);

    const after = await t.run(async (ctx) => ({
      action: await ctx.db.get(id),
      notes: (await ctx.db.query("notifications").collect()).filter((n) => n.orgId === ORG),
      audits: (await ctx.db.query("auditEvents").collect()).filter((a) => a.orgId === ORG),
    }));
    expect(after.action?.status).toBe("executed");
    expect(after.notes).toHaveLength(1);
    expect(after.notes[0].kind).toBe("invoice.reminder");
    expect(after.audits.some((a) => a.action === "ops.execute.payment_reminder")).toBe(true);

    // Re-running execute is a no-op (no second notification).
    await t.action(internal.opsActions.execute, { id });
    await drain(t);
    const notes2 = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.orgId === ORG),
    );
    expect(notes2).toHaveLength(1);
  });

  it("dismiss sets dismissed and bumps the dismiss counter", async () => {
    const id = await t.run(async (ctx) => ctx.db.insert("opsActions", emailAction(ORG)));
    await t.mutation(api.opsActions.dismiss, { id });
    const res = await t.run(async (ctx) => ({
      action: await ctx.db.get(id),
      policy: (await ctx.db.query("opsAutonomy").collect()).find((p) => p.orgId === ORG && p.actionType === "payment_reminder"),
    }));
    expect(res.action?.status).toBe("dismissed");
    expect(res.policy?.dismissedCount).toBe(1);
  });

  it("snooze hides from the open queue until snoozeUntil passes", async () => {
    const id = await t.run(async (ctx) => ctx.db.insert("opsActions", emailAction(ORG)));
    await t.mutation(api.opsActions.snooze, { id, until: Date.now() + 3600_000 });
    const open = await t.query(api.opsActions.list, {});
    expect(open.find((r) => r._id === id)).toBeUndefined();
  });

  it("executes a session_status payload by patching the session", async () => {
    const { actionId } = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "A", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Tentative day", artistId, serviceType: "recording",
        startTime: Date.now() + 86_400_000, endTime: Date.now() + 90_000_000,
        status: "tentative", rateCents: 10000, depositCents: 2000, depositPaid: false, intakeCompleted: false,
      });
      const actionId = await ctx.db.insert("opsActions", {
        orgId: ORG, type: "confirm_unconfirmed_session", priority: "high",
        title: "Confirm Tentative day", rationale: "soon",
        entityType: "session", entityId: sessionId,
        payload: { kind: "session_status", sessionId, newStatus: "confirmed" },
        status: "proposed", autonomy: false, source: "rule",
        dedupeKey: `confirm_unconfirmed_session:${sessionId}`, createdAt: Date.now(),
      });
      return { actionId, sessionId };
    });

    await t.mutation(api.opsActions.approve, { id: actionId });
    await drain(t);

    const action = await t.run(async (ctx) => ctx.db.get(actionId));
    expect(action?.status).toBe("executed");
    const sessionStatus = await t.run(async (ctx) => {
      const a = await ctx.db.get(actionId);
      const p = a!.payload;
      return p.kind === "session_status" ? (await ctx.db.get(p.sessionId))?.status : null;
    });
    expect(sessionStatus).toBe("confirmed");
  });
});
