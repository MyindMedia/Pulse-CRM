import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const HOUR = 3_600_000;

describe("engineer request lifecycle (public bookings)", () => {
  let t: ReturnType<typeof convexTest>;
  let engId: string;
  let sessionId: string;
  const org = "studio_engreq";

  beforeEach(async () => {
    t = convexTest(schema);
    const now = Date.now();
    ({ engId, sessionId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: org, name: "EngReq Studio", slug: "engreq", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: org, name: "Mgr", role: "manager", clerkUserId: "u_mgr", skills: [] });
      const engId = await ctx.db.insert("members", { orgId: org, name: "Eng Echo", role: "engineer", clerkUserId: "u_eng", skills: [] });
      const artistId = await ctx.db.insert("artists", {
        orgId: org, name: "Client", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: org, title: "Client - Studio A", artistId, serviceType: "recording",
        startTime: now + 24 * HOUR, endTime: now + 27 * HOUR, status: "tentative",
        rateCents: 30000, depositCents: 9000, depositPaid: false, intakeCompleted: false,
        engineerId: engId, engineerRequestStatus: "pending", source: "public_booking",
      });
      return { engId: engId as string, sessionId: sessionId as string };
    }));
  });

  it("the requested engineer sees the pending request and accepting finalizes", async () => {
    const asEng = t.withIdentity({ subject: "u_eng", orgId: org });
    const reqs = await asEng.query(api.sessions.myEngineerRequests, {});
    expect(reqs.length).toBe(1);
    expect(reqs[0].artistName).toBe("Client");

    await asEng.mutation(api.sessions.respondToEngineerRequest, { sessionId: sessionId as never, accept: true });
    const session = await t.run((ctx) => ctx.db.get(sessionId as never));
    expect(session!.status).toBe("confirmed");
    expect(session!.engineerRequestStatus).toBe("confirmed");
    // auto-shift created for the engineer
    const shift = await t.run(async (ctx) =>
      (await ctx.db.query("shifts").collect()).find((sh) => sh.memberId === engId));
    expect(shift?.kind).toBe("session");
    // no longer pending
    expect((await asEng.query(api.sessions.myEngineerRequests, {})).length).toBe(0);
  });

  it("declining clears the assignment and leaves the session tentative", async () => {
    const asEng = t.withIdentity({ subject: "u_eng", orgId: org });
    await asEng.mutation(api.sessions.respondToEngineerRequest, { sessionId: sessionId as never, accept: false });
    const session = await t.run((ctx) => ctx.db.get(sessionId as never));
    expect(session!.status).toBe("tentative");
    expect(session!.engineerRequestStatus).toBe("declined");
    expect(session!.engineerId).toBeUndefined();
  });

  it("a different staff member cannot answer someone else's request", async () => {
    const asMgr = t.withIdentity({ subject: "u_mgr", orgId: org });
    await expect(
      asMgr.mutation(api.sessions.respondToEngineerRequest, { sessionId: sessionId as never, accept: true }),
    ).rejects.toThrow(/different engineer/);
  });

  it("manager override finalizes without the engineer", async () => {
    const asMgr = t.withIdentity({ subject: "u_mgr", orgId: org });
    await asMgr.mutation(api.sessions.overrideEngineerConfirmation, { sessionId: sessionId as never });
    const session = await t.run((ctx) => ctx.db.get(sessionId as never));
    expect(session!.status).toBe("confirmed");
    expect(session!.engineerRequestStatus).toBe("overridden");
    // and the engineer's pending list is empty now
    const asEng = t.withIdentity({ subject: "u_eng", orgId: org });
    expect((await asEng.query(api.sessions.myEngineerRequests, {})).length).toBe(0);
  });

  it("plain engineers cannot override; double-handling is rejected", async () => {
    const asEng = t.withIdentity({ subject: "u_eng", orgId: org });
    await expect(
      asEng.mutation(api.sessions.overrideEngineerConfirmation, { sessionId: sessionId as never }),
    ).rejects.toThrow();
    await asEng.mutation(api.sessions.respondToEngineerRequest, { sessionId: sessionId as never, accept: true });
    await expect(
      asEng.mutation(api.sessions.respondToEngineerRequest, { sessionId: sessionId as never, accept: true }),
    ).rejects.toThrow(/already been handled/);
  });
});
