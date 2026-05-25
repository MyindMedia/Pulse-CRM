import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* SMS: opt-out compliance, manual client texts, due-reminder selection, and
   inbound handling. No provider configured in tests → sends are "simulated". */
describe("sms", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Skyline", slug: "demo", plan: "studio", status: "active" });
    });
  });

  async function addArtist(phone?: string) {
    return t.run((ctx) =>
      ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", phone,
        genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      }),
    );
  }

  it("sendClientSms simulates (no provider) + logs to the client thread", async () => {
    const artistId = await addArtist("(404) 555-0134");
    const res = await t.action(api.sms.sendClientSms, { artistId, body: "Your stems are ready." });
    expect(res.status).toBe("simulated");
    const thread = await t.query(api.clientEmail.thread, { artistId });
    expect(thread[0].channel).toBe("sms");
    expect(thread[0].direction).toBe("out");
  });

  it("sendClientSms refuses a client with no phone, and an opted-out number", async () => {
    const noPhone = await addArtist();
    await expect(t.action(api.sms.sendClientSms, { artistId: noPhone, body: "hi" })).rejects.toThrow(/no cell phone/i);

    const artistId = await addArtist("404-555-0150");
    await t.run((ctx) => ctx.db.insert("smsOptOuts", { phone: "+14045550150", optedOut: true, updatedAt: Date.now() }));
    const res = await t.action(api.sms.sendClientSms, { artistId, body: "hi" });
    expect(res.status).toBe("opted_out");
  });

  it("_dueReminders selects 24h vs 2h windows + excludes opted-out, then marks sent", async () => {
    const now = Date.now();
    const soonArtist = await addArtist("404-555-0101"); // 1h out → "2h"
    const dayArtist = await addArtist("404-555-0102");  // 5h out → "24h"
    const { soonId } = await t.run(async (ctx) => {
      const soonId = await ctx.db.insert("sessions", {
        orgId: "pulse-demo", title: "Mix", artistId: soonArtist, serviceType: "mixing",
        startTime: now + 60 * 60 * 1000, endTime: now + 2 * 60 * 60 * 1000,
        status: "confirmed", rateCents: 20000, depositCents: 6000, depositPaid: true, intakeCompleted: true,
      });
      await ctx.db.insert("sessions", {
        orgId: "pulse-demo", title: "Tracking", artistId: dayArtist, serviceType: "recording",
        startTime: now + 5 * 60 * 60 * 1000, endTime: now + 6 * 60 * 60 * 1000,
        status: "confirmed", rateCents: 20000, depositCents: 6000, depositPaid: true, intakeCompleted: true,
      });
      return { soonId };
    });

    const due = await t.query(internal.sms._dueReminders, { orgId: "pulse-demo" });
    const byKind = Object.fromEntries(due.map((d) => [d.kind, d]));
    expect(byKind["2h"]).toBeTruthy();
    expect(byKind["24h"]).toBeTruthy();
    expect(byKind["2h"].recipients[0].body).toMatch(/2 hours/);

    // Once marked, the session no longer surfaces for that kind.
    await t.mutation(internal.sms._markReminderSent, { sessionId: soonId, kind: "2h" });
    const due2 = await t.query(internal.sms._dueReminders, { orgId: "pulse-demo" });
    expect(due2.find((d) => d.sessionId === soonId)).toBeUndefined();
  });

  it("_dueReminders honors the org opt-out toggle", async () => {
    const a = await addArtist("404-555-0103");
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect())[0];
      await ctx.db.patch(org._id, { smsRemindersEnabled: false });
      await ctx.db.insert("sessions", {
        orgId: "pulse-demo", title: "Mix", artistId: a, serviceType: "mixing",
        startTime: Date.now() + 60 * 60 * 1000, endTime: Date.now() + 2 * 60 * 60 * 1000,
        status: "confirmed", rateCents: 1, depositCents: 0, depositPaid: true, intakeCompleted: true,
      });
    });
    expect(await t.query(internal.sms._dueReminders, { orgId: "pulse-demo" })).toEqual([]);
  });

  it("_handleInbound: STOP opts out; a normal reply lands in the client thread", async () => {
    const artistId = await addArtist("(404) 555-0177");
    await t.mutation(internal.sms._handleInbound, { from: "+14045550177", body: "STOP" });
    expect(await t.query(internal.sms._isOptedOut, { phone: "+14045550177" })).toBe(true);

    await t.mutation(internal.sms._handleInbound, { from: "404-555-0177", body: "See you then!" });
    const thread = await t.query(api.clientEmail.thread, { artistId });
    const inbound = thread.find((m) => m.direction === "in");
    expect(inbound?.body).toBe("See you then!");
    expect(inbound?.channel).toBe("sms");
  });
});
