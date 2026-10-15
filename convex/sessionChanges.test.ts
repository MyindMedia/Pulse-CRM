import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { describeProposal, editsDirectly, mayDecide } from "./lib/changeApproval";

/* Change approvals on existing bookings (bookingFeatures.changeApproval). */

const newT = () => convexTest(schema);
type TestConvex = ReturnType<typeof newT>;

const HOUR = 3_600_000;
const ORG = "changes_org";

type Seed = {
  t: TestConvex;
  ids: Record<"owner" | "manager" | "creator" | "other" | "third" | "relations", Id<"members">>;
  as: Record<"owner" | "manager" | "creator" | "other" | "third" | "relations", ReturnType<TestConvex["withIdentity"]>>;
  room: Id<"rooms">;
  artist: Id<"artists">;
};

async function seed(changeApproval: boolean): Promise<Seed> {
  const t = convexTest(schema);
  const people = {
    owner: { name: "Olive Owner", role: "owner", clerk: "u_own" },
    manager: { name: "Max Manager", role: "manager", clerk: "u_mgr" },
    creator: { name: "Avery Booker", role: "engineer", clerk: "u_avery" },
    other: { name: "Blake Engineer", role: "engineer", clerk: "u_blake" },
    third: { name: "Casey Engineer", role: "engineer", clerk: "u_casey" },
    relations: { name: "Riley Relations", role: "artist_relations", clerk: "u_riley" },
  } as const;
  const ids = {} as Seed["ids"];
  let room!: Id<"rooms">;
  let artist!: Id<"artists">;
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG,
      name: "Changes Studio",
      slug: "changes-studio",
      tier: "growth",
      status: "active",
      ownerEmail: "owner@example.com",
      bookingFeatures: changeApproval ? { changeApproval: true } : undefined,
    });
    for (const [key, p] of Object.entries(people)) {
      ids[key as keyof Seed["ids"]] = await ctx.db.insert("members", {
        orgId: ORG,
        name: p.name,
        email: `${p.clerk}@example.com`,
        role: p.role,
        skills: [],
        clerkUserId: p.clerk,
      });
    }
    room = await ctx.db.insert("rooms", {
      orgId: ORG, name: "Room A", status: "available", bookable: true,
      hourlyRateCents: 10_000, minimumHours: 1, depositPct: 30,
    });
    artist = await ctx.db.insert("artists", {
      orgId: ORG, name: "Client Name", type: "artist", email: "client@example.com",
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
  });
  const as = Object.fromEntries(
    Object.entries(people).map(([k, p]) => [k, t.withIdentity({ subject: p.clerk, orgId: ORG })]),
  ) as Seed["as"];
  return { t, ids, as, room, artist };
}

const BASE = Date.UTC(2030, 0, 15, 18, 0, 0);

function makeSession(s: Seed, over: Record<string, unknown> = {}): Promise<Id<"sessions">> {
  return s.t.run((ctx) =>
    ctx.db.insert("sessions", {
      orgId: ORG,
      title: "Client - Room A",
      artistId: s.artist,
      roomId: s.room,
      serviceType: "recording",
      startTime: BASE,
      endTime: BASE + 2 * HOUR,
      status: "confirmed",
      rateCents: 20_000,
      depositCents: 6_000,
      depositPaid: true,
      amountPaidCents: 6_000,
      intakeCompleted: true,
      createdByMemberId: s.ids.creator,
      ...over,
    }),
  );
}

const getSession = (s: Seed, id: Id<"sessions">) => s.t.run((ctx) => ctx.db.get(id));
const requests = (s: Seed) => s.t.run((ctx) => ctx.db.query("sessionChangeRequests").collect());

describe("change approvals: switch off", () => {
  it("a non-creator edit applies directly, exactly as before, and writes no request", async () => {
    const s = await seed(false);
    const id = await makeSession(s);
    const res = await s.as.other.mutation(api.sessions.reschedule, {
      id, startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR,
    });
    expect(res.proposed).toBeUndefined();
    expect(res.rateCents).toBe(20_000);
    expect((await getSession(s, id))?.startTime).toBe(BASE + 24 * HOUR);

    const ext = await s.as.other.mutation(api.sessions.extend, { id, addMinutes: 60 });
    expect(ext.rateCents).toBe(30_000);
    const eng = await s.as.other.mutation(api.sessions.assignEngineer, { sessionId: id, engineerId: s.ids.third });
    expect(eng).toEqual({ staffingWarning: null });
    await s.as.manager.mutation(api.sessions.setStatus, { id, status: "cancelled" });
    expect((await getSession(s, id))?.status).toBe("cancelled");
    expect(await requests(s)).toHaveLength(0);
  });
});

describe("change approvals: switch on", () => {
  it("a non-creator engineer's reschedule becomes a proposal to the creator", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const res = await s.as.other.mutation(api.sessions.reschedule, {
      id, startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR,
    });
    expect(res.proposed).toBe(true);
    expect(res.approverName).toBe("Avery Booker");

    const after = await getSession(s, id);
    expect(after?.startTime).toBe(BASE);
    const rows = await requests(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      origin: "pulse",
      status: "pending",
      requestedByMemberId: s.ids.other,
      approverMemberId: s.ids.creator,
      proposed: { startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR },
    });
    const activity = await s.t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity.some((a) => a.kind === "session.change_requested" && a.summary.includes("Blake Engineer"))).toBe(true);
    const mail = await s.t.run((ctx) => ctx.db.query("notifications").collect());
    expect(mail.some((n) => n.kind === "session.change_requested" && n.recipient === "u_avery@example.com")).toBe(true);
  });

  it("a second proposal from the same person updates the open one instead of adding another", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const a = await s.as.other.mutation(api.sessions.reschedule, {
      id, startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR,
    });
    const b = await s.as.other.mutation(api.sessions.assignEngineer, { sessionId: id, engineerId: s.ids.third });
    expect(b.proposed).toBe(true);
    expect(b.requestId).toBe(a.requestId);
    const rows = await requests(s);
    expect(rows).toHaveLength(1);
    expect(rows[0].proposed).toEqual({ startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR, engineerId: s.ids.third });

    // A different person gets their own request.
    await s.as.third.mutation(api.sessions.extend, { id, addMinutes: 30 });
    expect(await requests(s)).toHaveLength(2);
  });

  it("the creator and an owner edit directly", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const byCreator = await s.as.creator.mutation(api.sessions.extend, { id, addMinutes: 60 });
    expect(byCreator.proposed).toBeUndefined();
    expect((await getSession(s, id))?.endTime).toBe(BASE + 3 * HOUR);
    const byOwner = await s.as.owner.mutation(api.sessions.reschedule, {
      id, startTime: BASE + HOUR, endTime: BASE + 4 * HOUR,
    });
    expect(byOwner.proposed).toBeUndefined();
    expect((await getSession(s, id))?.startTime).toBe(BASE + HOUR);
    await s.as.owner.mutation(api.sessions.setStatus, { id, status: "cancelled" });
    expect((await getSession(s, id))?.status).toBe("cancelled");
    expect(await requests(s)).toHaveLength(0);
  });

  it("approval applies the change through the same reschedule path", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const { requestId } = await s.as.other.mutation(api.sessions.extend, { id, addMinutes: 60 });
    await s.as.creator.mutation(api.sessionChanges.approve, { requestId: requestId! });

    const after = await getSession(s, id);
    expect(after?.endTime).toBe(BASE + 3 * HOUR);
    expect(after?.rateCents).toBe(30_000); // by-duration rate recomputed, as a direct extend does
    const row = await s.t.run((ctx) => ctx.db.get(requestId!));
    expect(row).toMatchObject({ status: "approved", decidedByMemberId: s.ids.creator });
    const activity = await s.t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity.some((a) => a.kind === "session.rescheduled")).toBe(true);
    expect(activity.some((a) => a.kind === "session.change_approved" && a.summary.includes("Avery Booker"))).toBe(true);
    const mail = await s.t.run((ctx) => ctx.db.query("notifications").collect());
    expect(mail.some((n) => n.kind === "session.change_decided" && n.recipient === "u_blake@example.com")).toBe(true);
  });

  it("the room conflict check still runs at approval time", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const { requestId } = await s.as.other.mutation(api.sessions.reschedule, {
      id, startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR,
    });
    // Someone books the room into that window after the proposal was made.
    await makeSession(s, { startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR, title: "Other booking" });
    await expect(
      s.as.creator.mutation(api.sessionChanges.approve, { requestId: requestId! }),
    ).rejects.toThrow();
    expect((await getSession(s, id))?.startTime).toBe(BASE);
    expect((await s.t.run((ctx) => ctx.db.get(requestId!)))?.status).toBe("pending");
  });

  it("decline leaves the booking untouched", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const before = await getSession(s, id);
    const { requestId } = await s.as.other.mutation(api.sessions.reschedule, {
      id, startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR,
    });
    await s.as.creator.mutation(api.sessionChanges.decline, { requestId: requestId!, note: "Client asked for this slot" });
    const after = await getSession(s, id);
    expect(after?.startTime).toBe(before?.startTime);
    expect(after?.endTime).toBe(before?.endTime);
    expect(after?.rateCents).toBe(before?.rateCents);
    expect((await s.t.run((ctx) => ctx.db.get(requestId!)))?.status).toBe("declined");
  });

  it("only the approver, the creator or an owner may decide", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const { requestId } = await s.as.other.mutation(api.sessions.extend, { id, addMinutes: 60 });
    const rid = requestId!;
    // The requester cannot sign off on their own change.
    await expect(s.as.other.mutation(api.sessionChanges.approve, { requestId: rid })).rejects.toThrow();
    // Another engineer cannot.
    await expect(s.as.third.mutation(api.sessionChanges.approve, { requestId: rid })).rejects.toThrow();
    // A manager cannot when the booking has a creator.
    await expect(s.as.manager.mutation(api.sessionChanges.decline, { requestId: rid })).rejects.toThrow();
    expect((await s.t.run((ctx) => ctx.db.get(rid)))?.status).toBe("pending");
    // The owner can.
    await s.as.owner.mutation(api.sessionChanges.approve, { requestId: rid });
    expect((await s.t.run((ctx) => ctx.db.get(rid)))?.status).toBe("approved");
    // And a decided change cannot be decided again.
    await expect(s.as.creator.mutation(api.sessionChanges.decline, { requestId: rid })).rejects.toThrow();
  });

  it("a cancel by someone else is a proposal; approving it runs the cancel with its side effects", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const res = await s.as.relations.mutation(api.sessions.setStatus, { id, status: "cancelled" });
    expect(res?.proposed).toBe(true);
    expect((await getSession(s, id))?.status).toBe("confirmed");
    await s.as.creator.mutation(api.sessionChanges.approve, { requestId: res!.requestId });
    expect((await getSession(s, id))?.status).toBe("cancelled");
  });

  it("an engineer change approved by the creator assigns the engineer", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const res = await s.as.other.mutation(api.sessions.assignEngineer, { sessionId: id, engineerId: s.ids.third });
    expect((await getSession(s, id))?.engineerId).toBeUndefined();
    await s.as.creator.mutation(api.sessionChanges.approve, { requestId: res.requestId! });
    expect((await getSession(s, id))?.engineerId).toBe(s.ids.third);
  });

  it("a public booking (no creator) goes to the owner, and managers edit or decide it", async () => {
    const s = await seed(true);
    const id = await makeSession(s, { createdByMemberId: undefined });
    const res = await s.as.other.mutation(api.sessions.extend, { id, addMinutes: 30 });
    expect(res.proposed).toBe(true);
    expect(res.approverName).toBe("Olive Owner");
    const direct = await s.as.manager.mutation(api.sessions.extend, { id, addMinutes: 30 });
    expect(direct.proposed).toBeUndefined();
    // The manager can decide the engineer's proposal too.
    const waiting = await s.as.manager.query(api.sessionChanges.pendingForMe, {});
    expect(waiting.map((w) => w._id)).toEqual([res.requestId]);
    await s.as.manager.mutation(api.sessionChanges.decline, { requestId: res.requestId! });
  });

  it("the requester can withdraw; nobody else can", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const { requestId } = await s.as.other.mutation(api.sessions.extend, { id, addMinutes: 60 });
    await expect(s.as.creator.mutation(api.sessionChanges.withdraw, { requestId: requestId! })).rejects.toThrow();
    await s.as.other.mutation(api.sessionChanges.withdraw, { requestId: requestId! });
    expect((await s.t.run((ctx) => ctx.db.get(requestId!)))?.status).toBe("withdrawn");
  });

  it("reads: forSession, pendingForMe and the calendar marker", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const { requestId } = await s.as.other.mutation(api.sessions.extend, { id, addMinutes: 60 });
    const forCreator = await s.as.creator.query(api.sessionChanges.forSession, { sessionId: id });
    expect(forCreator).toHaveLength(1);
    expect(forCreator[0]).toMatchObject({ canDecide: true, isMine: false, requesterName: "Blake Engineer", approverName: "Avery Booker" });
    expect(forCreator[0].summary).toMatch(/^Extend by 60 min/);
    const forRequester = await s.as.other.query(api.sessionChanges.forSession, { sessionId: id });
    expect(forRequester[0]).toMatchObject({ canDecide: false, isMine: true });
    expect((await s.as.creator.query(api.sessionChanges.pendingForMe, {})).map((r) => r._id)).toEqual([requestId]);
    expect(await s.as.third.query(api.sessionChanges.pendingForMe, {})).toEqual([]);
    expect(await s.as.owner.query(api.sessionChanges.pendingSessionIds, {})).toEqual([id]);
  });
});

describe("change approvals: edits made in Google", () => {
  async function googleRequest(s: Seed, id: Id<"sessions">) {
    return s.t.run(async (ctx) => {
      await ctx.db.patch(id, { googleChangedAt: Date.now() });
      return ctx.db.insert("sessionChangeRequests", {
        orgId: ORG,
        sessionId: id,
        origin: "google",
        proposed: { startTime: BASE + 48 * HOUR, endTime: BASE + 50 * HOUR },
        approverMemberId: s.ids.creator,
        status: "pending",
      });
    });
  }

  it("decline restores Google from Pulse: schedules a push and clears the flag", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const requestId = await googleRequest(s, id);
    await s.as.creator.mutation(api.sessionChanges.decline, { requestId });
    const after = await getSession(s, id);
    expect(after?.googleChangedAt).toBeUndefined();
    expect(after?.startTime).toBe(BASE);
    const scheduled = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((f) => f.name.includes("googleCalendar") && f.name.includes("pushSession"))).toBe(true);
  });

  it("approve applies the Google change in Pulse and clears the flag", async () => {
    const s = await seed(true);
    const id = await makeSession(s);
    const requestId = await googleRequest(s, id);
    await s.as.owner.mutation(api.sessionChanges.approve, { requestId });
    const after = await getSession(s, id);
    expect(after?.startTime).toBe(BASE + 48 * HOUR);
    expect(after?.googleChangedAt).toBeUndefined();
  });
});

describe("change approvals: pure rules", () => {
  const creator = "m_creator" as Id<"members">;
  const other = "m_other" as Id<"members">;
  it("editsDirectly", () => {
    expect(editsDirectly({ ownerLevel: true }, { createdByMemberId: creator })).toBe(true);
    expect(editsDirectly({ ownerLevel: false, memberId: creator, role: "engineer" }, { createdByMemberId: creator })).toBe(true);
    expect(editsDirectly({ ownerLevel: false, memberId: other, role: "manager" }, { createdByMemberId: creator })).toBe(false);
    expect(editsDirectly({ ownerLevel: false, memberId: other, role: "manager" }, {})).toBe(true);
    expect(editsDirectly({ ownerLevel: false, memberId: other, role: "engineer" }, {})).toBe(false);
  });
  it("mayDecide", () => {
    const req = { requestedByMemberId: other, approverMemberId: creator };
    expect(mayDecide({ ownerLevel: false, memberId: creator, role: "engineer" }, { createdByMemberId: creator }, req)).toBe(true);
    expect(mayDecide({ ownerLevel: false, memberId: other, role: "engineer" }, { createdByMemberId: creator }, req)).toBe(false);
    expect(mayDecide({ ownerLevel: true }, { createdByMemberId: creator }, req)).toBe(true);
  });
  it("describeProposal", () => {
    const sess = { startTime: BASE, endTime: BASE + 2 * HOUR };
    expect(describeProposal(sess, { status: "cancelled" }, {})).toBe("Cancel the booking");
    expect(describeProposal(sess, { endTime: BASE + 3 * HOUR }, {}, "UTC")).toBe("Extend by 60 min, to end at 9:00 PM");
    expect(describeProposal(sess, { startTime: BASE + 24 * HOUR, endTime: BASE + 26 * HOUR }, {}, "UTC")).toBe(
      "Move to Wednesday, January 16, 6:00 PM to 8:00 PM",
    );
    expect(describeProposal(sess, { engineerId: other }, { engineerName: "Dana" })).toBe("Engineer: Dana");
  });
});
