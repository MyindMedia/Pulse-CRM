import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internTimeoutClockOut } from "./smsFlows";

/* truth-intern-clock-out: interns were told to stay clocked in while a
   manager reviewed their EXTEND request, then capped at clock-in + 4h when
   nobody answered, so the time they were told to work went unpaid. */

const sent = vi.hoisted(() => [] as { to: string; body: string }[]);
vi.mock("./lib/sms", async (orig) => ({
  ...(await orig<typeof import("./lib/sms")>()),
  sendSms: vi.fn(async (a: { to: string; body: string }) => {
    sent.push(a);
    return { ok: true } as never;
  }),
}));

const HOUR = 3_600_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 12, 15, 0, 0); // 10:00 AM in New York
const INTERN = "+14045550101";
const MGR = "+14045550199";

const newT = () => convexTest(schema);
type T = ReturnType<typeof newT>;

async function setup(t: T, opts: { managerPhone?: boolean; orgId?: string; internPhone?: string } = {}) {
  const orgId = opts.orgId ?? "org_i";
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name: "Iris Studio", slug: orgId, tier: "growth", status: "active", timezone: "America/New_York",
    } as never);
    await ctx.db.insert("members", {
      orgId, name: "Mgr", role: "manager", skills: [], clerkUserId: `u_mgr_${orgId}`,
      ...(opts.managerPhone === false ? {} : { phone: MGR }),
    } as never);
    const internId = await ctx.db.insert("members", {
      orgId, name: "Ivy", role: "intern", skills: [], phone: opts.internPhone ?? INTERN,
      clerkUserId: `u_int_${orgId}`, payType: "hourly", payRateCents: 2_000,
    } as never);
    const entryId = await ctx.db.insert("timeEntries", {
      orgId, memberId: internId, clockInAt: T0, status: "active", rateCentsSnapshot: 2_000, source: "self",
    });
    return { orgId, internId, entryId };
  });
}

/** Everything queued with ctx.scheduler (texts sent from mutations). */
async function queued(t: T) {
  const rows = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return rows
    .map((r) => r.args[0] as { to?: string; body?: string })
    .filter((a) => a?.to && a?.body) as { to: string; body: string }[];
}

async function entry(t: T, id: Id<"timeEntries">) {
  return (await t.run((ctx) => ctx.db.get(id)))!;
}

/** Run the cron sweep at a given time. */
async function sweepAt(t: T, at: number) {
  vi.setSystemTime(at);
  await t.action(internal.smsFlows.sweepTimeclock, {});
}

beforeEach(() => {
  sent.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("intern clock-out: what Pulse texts", () => {
  it("U-01 EXTEND gets the 'clock out now' text, never 'stay clocked in'", async () => {
    const t = newT();
    const { entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN); // 4h prompt goes out
    expect(sent.find((s) => s.to === INTERN)?.body).toContain("Reply EXTEND");
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    const toIntern = (await queued(t)).filter((x) => x.to === INTERN);
    expect(toIntern).toHaveLength(1);
    expect(toIntern[0].body).toBe(
      "Pulse: Request sent. Please clock out now. If a manager approves, we will text you and you can clock back in.",
    );
    expect(toIntern[0].body).not.toMatch(/stay clocked in/i);
    expect((await queued(t)).some((x) => x.to === MGR && /requests permission/.test(x.body))).toBe(true);
    expect((await entry(t, entryId)).internExtension).toBe("requested");
  });

  it("U-02 no manager with a phone: the intern is told to ask in person", async () => {
    const t = newT();
    await setup(t, { managerPhone: false });
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    const toIntern = (await queued(t)).filter((x) => x.to === INTERN);
    expect(toIntern.map((x) => x.body)).toEqual([
      "Pulse: No manager can be reached by text. Please clock out now and ask a manager in person.",
    ]);
    expect(toIntern[0].body).not.toMatch(/manager reviews|reviewing/i);
  });

  it("U-03 manager approves in time: entry stays open and the intern is told", async () => {
    const t = newT();
    const { entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    vi.setSystemTime(T0 + 4 * HOUR + 20 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: MGR, body: "APPROVE" });
    const e = await entry(t, entryId);
    expect(e.status).toBe("active");
    expect(e.clockOutAt).toBeUndefined();
    expect(e.internExtension).toBe("approved");
    const toIntern = (await queued(t)).filter((x) => x.to === INTERN).map((x) => x.body);
    expect(toIntern.at(-1)).toContain("Approved - you are cleared to keep working at Iris Studio");
    // A later sweep leaves an approved entry alone.
    await sweepAt(t, T0 + 7 * HOUR);
    expect((await entry(t, entryId)).status).toBe("active");
  });

  it("U-03b approval after the intern clocked out (as told) says they can clock back in", async () => {
    const t = newT();
    const { orgId, entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    vi.setSystemTime(T0 + 4 * HOUR + 6 * MIN);
    await t.withIdentity({ subject: `u_int_${orgId}`, orgId }).mutation(api.timeclock.clockOut, {});
    vi.setSystemTime(T0 + 4 * HOUR + 30 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: MGR, body: "APPROVE" });
    const toIntern = (await queued(t)).filter((x) => x.to === INTERN).map((x) => x.body);
    expect(toIntern.at(-1)).toContain("you can clock back in at Iris Studio");
    const e = await entry(t, entryId);
    expect(e.clockOutAt).toBe(T0 + 4 * HOUR + 6 * MIN); // the intern's own punch stands
  });

  it("U-04 manager denies: intern texted to clock out, entry unchanged until they do", async () => {
    const t = newT();
    const { orgId, entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    vi.setSystemTime(T0 + 4 * HOUR + 20 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: MGR, body: "DENY" });
    let e = await entry(t, entryId);
    expect(e.status).toBe("active");
    expect(e.clockOutAt).toBeUndefined();
    expect(e.internExtension).toBe("denied");
    const toIntern = (await queued(t)).filter((x) => x.to === INTERN).map((x) => x.body);
    expect(toIntern.at(-1)).toBe("Pulse: Not approved - please wrap up and clock out now at Iris Studio.");
    // A sweep does not close a denied entry behind the intern's back.
    await sweepAt(t, T0 + 6 * HOUR);
    expect((await entry(t, entryId)).status).toBe("active");
    // They clock out: that time is the clock-out.
    vi.setSystemTime(T0 + 4 * HOUR + 32 * MIN);
    await t.withIdentity({ subject: `u_int_${orgId}`, orgId }).mutation(api.timeclock.clockOut, {});
    e = await entry(t, entryId);
    expect(e.status).toBe("completed");
    expect(e.clockOutAt).toBe(T0 + 4 * HOUR + 32 * MIN);
  });
});

describe("intern clock-out: the timeout", () => {
  it("U-05 closes the entry at the approval window end, not clock-in + 4h", async () => {
    const t = newT();
    const { entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    const approval = await t.run(async (ctx) =>
      (await ctx.db.query("smsPrompts").withIndex("by_entry", (q) => q.eq("entryId", entryId)).collect())
        .find((p) => p.kind === "intern_approval")!,
    );
    expect(approval.expiresAt).toBe(T0 + 5 * HOUR + 5 * MIN);
    await sweepAt(t, T0 + 6 * HOUR + 5 * MIN); // 2h later, nobody answered
    const e = await entry(t, entryId);
    expect(e.status).toBe("completed");
    expect(e.autoClosedReason).toBe("intern_timeout");
    expect(e.internExtension).toBe("timeout");
    expect(e.clockOutAt).toBe(approval.expiresAt);
    expect(e.clockOutAt).not.toBe(T0 + 4 * HOUR);
    const toIntern = sent.filter((s) => s.to === INTERN).map((s) => s.body);
    expect(toIntern.at(-1)).toBe("Pulse: No approval came through, so you are clocked out at Iris Studio as of 3:05 PM.");
    expect(sent.some((s) => s.to === MGR && /clocked out as of 3:05 PM/.test(s.body))).toBe(true);
    expect(sent.some((s) => /capped at 4 hours/.test(s.body))).toBe(false);
  });

  it("U-06 never sets a clock-out in the future, never before the 4-hour mark", () => {
    const now = T0 + 4 * HOUR + 30 * MIN;
    expect(internTimeoutClockOut(T0, [now + 3 * HOUR], now)).toBe(now);
    expect(internTimeoutClockOut(T0, [T0 + HOUR], now)).toBe(T0 + 4 * HOUR);
    expect(internTimeoutClockOut(T0, [], now)).toBe(T0 + 4 * HOUR);
    expect(internTimeoutClockOut(T0, [T0 + 4 * HOUR + 45 * MIN, T0 + 5 * HOUR], T0 + 9 * HOUR)).toBe(T0 + 5 * HOUR);
  });

  it("U-06b a prompt with a late expiry keeps the entry open until it lapses, and is never stamped ahead of now", async () => {
    const t = newT();
    const { orgId, entryId } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(entryId, { internPromptSentAt: T0 + 4 * HOUR, internExtension: "requested" });
      await ctx.db.insert("smsPrompts", {
        orgId, phone: MGR, kind: "intern_approval", entryId, status: "expired",
        sentAt: T0 + 4 * HOUR, expiresAt: T0 + 9 * HOUR,
      } as never);
    });
    vi.setSystemTime(T0 + 5 * HOUR);
    const closedAt = await t.mutation(internal.smsFlows._capInternEntry, { entryId });
    expect(closedAt).toBe(T0 + 5 * HOUR);
    expect((await entry(t, entryId)).clockOutAt).toBeLessThanOrEqual(Date.now());
  });

  it("U-07 a second sweep (or a duplicate run) changes nothing and texts nobody again", async () => {
    const t = newT();
    const { entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    await sweepAt(t, T0 + 6 * HOUR);
    const first = await entry(t, entryId);
    const textsAfterFirst = sent.length;
    await sweepAt(t, T0 + 6 * HOUR + 15 * MIN);
    expect(await entry(t, entryId)).toEqual(first);
    expect(sent.length).toBe(textsAfterFirst);
    // Calling the cap directly again is a no-op as well.
    expect(await t.mutation(internal.smsFlows._capInternEntry, { entryId })).toBeNull();
    expect(await entry(t, entryId)).toEqual(first);
  });

  it("U-07b an approval landing between the sweep's read and its write wins", async () => {
    const t = newT();
    const { entryId } = await setup(t);
    await t.run((ctx) => ctx.db.patch(entryId, { internPromptSentAt: T0 + 4 * HOUR, internExtension: "approved" }));
    vi.setSystemTime(T0 + 6 * HOUR);
    expect(await t.mutation(internal.smsFlows._capInternEntry, { entryId })).toBeNull();
    expect((await entry(t, entryId)).status).toBe("active");
  });

  it("U-08 an intern who clocked out themselves before the timeout is untouched", async () => {
    const t = newT();
    const { orgId, entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    vi.setSystemTime(T0 + 4 * HOUR + 7 * MIN);
    await t.withIdentity({ subject: `u_int_${orgId}`, orgId }).mutation(api.timeclock.clockOut, {});
    const before = await entry(t, entryId);
    const textsBefore = sent.filter((s) => s.to === INTERN).length;
    await sweepAt(t, T0 + 6 * HOUR);
    const after = await entry(t, entryId);
    expect(after).toEqual(before);
    expect(after.clockOutAt).toBe(T0 + 4 * HOUR + 7 * MIN);
    expect(after.autoClosedReason).toBeUndefined();
    expect(sent.filter((s) => s.to === INTERN).length).toBe(textsBefore);
  });

  it("U-09 EXTEND from a stranger, or from another studio's intern, changes nothing", async () => {
    const t = newT();
    const a = await setup(t);
    const b = await setup(t, { orgId: "org_other", internPhone: "+14045550303" });
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: "+14045559999", body: "EXTEND" });
    expect((await entry(t, a.entryId)).internExtension).toBeUndefined();
    expect((await entry(t, b.entryId)).internExtension).toBeUndefined();
    // Studio B's intern extends only their own entry.
    await t.mutation(internal.sms._handleInbound, { from: "+14045550303", body: "EXTEND" });
    expect((await entry(t, b.entryId)).internExtension).toBe("requested");
    expect((await entry(t, a.entryId)).internExtension).toBeUndefined();
    // And a stranger cannot APPROVE it.
    await t.mutation(internal.sms._handleInbound, { from: "+14045559999", body: "APPROVE" });
    expect((await entry(t, b.entryId)).internExtension).toBe("requested");
  });

  it("U-10 the payroll summary pays the time up to the new clock-out", async () => {
    const t = newT();
    const { orgId, entryId } = await setup(t);
    await sweepAt(t, T0 + 4 * HOUR + MIN);
    vi.setSystemTime(T0 + 4 * HOUR + 5 * MIN);
    await t.mutation(internal.sms._handleInbound, { from: INTERN, body: "EXTEND" });
    await sweepAt(t, T0 + 6 * HOUR + 5 * MIN);
    const e = await entry(t, entryId);
    expect(e.clockOutAt).toBe(T0 + 5 * HOUR + 5 * MIN);
    await t.run((ctx) => ctx.db.insert("members", { orgId, name: "Own", role: "owner", skills: [], clerkUserId: "u_own_i" } as never));
    const sum = await t
      .withIdentity({ subject: "u_own_i", orgId })
      .query(api.payroll.summary, { start: T0 - HOUR, end: T0 + 24 * HOUR });
    const ivy = sum.rows.find((r) => r.name === "Ivy")!;
    expect(ivy.hours).toBeCloseTo(5 + 5 / 60, 5);
    expect(ivy.payCents).toBe(Math.round((5 + 5 / 60) * 2_000));
  });
});

describe("intern clock-out: report on past entries (no writes)", () => {
  it("lists entries the old rule cut at 4h, with the time left unpaid, and changes nothing", async () => {
    const t = newT();
    const { orgId, entryId, internId } = await setup(t);
    // An entry closed the old way: EXTEND at 4h05, manager window to 5h05, cut at 4h.
    await t.run(async (ctx) => {
      await ctx.db.patch(entryId, {
        status: "completed", clockOutAt: T0 + 4 * HOUR, internExtension: "timeout", autoClosedReason: "intern_timeout",
        internPromptSentAt: T0 + 4 * HOUR,
      });
      await ctx.db.insert("smsPrompts", {
        orgId, phone: INTERN, kind: "intern_checkin", entryId, memberId: internId, status: "answered",
        sentAt: T0 + 4 * HOUR, expiresAt: T0 + 4 * HOUR + 45 * MIN,
      } as never);
      await ctx.db.insert("smsPrompts", {
        orgId, phone: MGR, kind: "intern_approval", entryId, memberId: internId, status: "expired",
        sentAt: T0 + 4 * HOUR + 5 * MIN, expiresAt: T0 + 5 * HOUR + 5 * MIN,
      } as never);
      // A normal clock-out is not listed.
      await ctx.db.insert("timeEntries", {
        orgId, memberId: internId, clockInAt: T0 - 24 * HOUR, clockOutAt: T0 - 21 * HOUR, status: "completed", source: "self",
      });
    });
    const before = await entry(t, entryId);
    const res = await t.query(internal.payrollCorrections.reportPastInternTimeouts, {
      orgId, paginationOpts: { numItems: 50, cursor: null },
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      entryId, memberName: "Ivy", recordedClockOutAt: T0 + 4 * HOUR, proposedClockOutAt: T0 + 5 * HOUR + 5 * MIN,
      unpaidMinutes: 65, unpaidCents: Math.round((65 / 60) * 2_000),
    });
    expect(await entry(t, entryId)).toEqual(before);
    // Another studio's id sees nothing.
    const other = await t.query(internal.payrollCorrections.reportPastInternTimeouts, {
      orgId: "org_nobody", paginationOpts: { numItems: 50, cursor: null },
    });
    expect(other.rows).toHaveLength(0);
  });
});
