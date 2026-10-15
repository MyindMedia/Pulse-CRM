import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
vi.mock("./lib/email", () => ({
  sendEmail: vi.fn(async (a: { to: string; subject: string; html: string }) => {
    sent.push({ to: a.to, subject: a.subject, html: a.html });
    return "sent";
  }),
}));

type Id = { subject: string; name: string; orgId: string; orgType?: string };

describe("feature requests", () => {
  let t: ReturnType<typeof convexTest>;
  let owner: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
  let studioA: typeof owner;
  let studioB: typeof owner;
  let staff: typeof owner;

  beforeEach(async () => {
    vi.useFakeTimers();
    sent.length = 0;
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "Pulse", slug: "pulse", plan: "max", status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "owner@pulse.test",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "owner@pulse.test", name: "Owner",
        role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_staff", email: "staff@pulse.test", name: "Staff",
        role: "staff", status: "active", invitedAt: 0,
      });
      for (const [orgId, name, user, email] of [
        ["org_a", "Studio Alpha", "u_a", "a@alpha.test"],
        ["org_b", "Studio Beta", "u_b", "b@beta.test"],
      ]) {
        await ctx.db.insert("orgs", { orgId, name, slug: orgId, tier: "growth", status: "active", agencyId: "org_ag" });
        await ctx.db.insert("members", { orgId, name: `${name} Owner`, email, role: "owner", clerkUserId: user, skills: [] } as never);
      }
    });
    owner = t.withIdentity({ subject: "u_owner", name: "Owner", orgId: "org_ag", orgType: "agency" } as Id);
    staff = t.withIdentity({ subject: "u_staff", name: "Staff", orgId: "org_ag", orgType: "agency" } as Id);
    studioA = t.withIdentity({ subject: "u_a", name: "Al", orgId: "org_a" } as Id);
    studioB = t.withIdentity({ subject: "u_b", name: "Bea", orgId: "org_b" } as Id);
  });
  afterEach(() => vi.useRealTimers());

  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  it("submit creates a request, auto-votes, notifies the owner in app and by email", async () => {
    const id = await studioA.mutation(api.featureRequests.submit, {
      title: "  Recurring   bookings ", description: "Weekly block for a band", category: "Booking",
    });
    const board = await studioA.query(api.featureRequests.list, {});
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ _id: id, title: "Recurring bookings", status: "pending", votes: 1, voted: true, mine: true });

    const bell = await owner.query(api.featureRequests.notifications, {});
    expect(bell.unread).toBe(1);
    expect(bell.items[0].title).toBe("New feature request: Recurring bookings");
    expect(bell.items[0].body).toContain("Studio Alpha");

    await drain();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("owner@pulse.test");
    expect(sent[0].subject).toBe("New feature request: Recurring bookings");
    expect(sent[0].html).toContain("Studio Alpha");
    expect(sent[0].html).toContain("a@alpha.test");
    expect(sent[0].html).toContain("/agency/feature-requests");

    await owner.mutation(api.featureRequests.markNotificationsRead, {});
    expect((await owner.query(api.featureRequests.notifications, {})).unread).toBe(0);
    // A studio never reads the owner's bell.
    expect((await studioB.query(api.featureRequests.notifications, {})).items).toHaveLength(0);
  });

  it("validates title and description length and category", async () => {
    await expect(studioA.mutation(api.featureRequests.submit, { title: "ab" })).rejects.toThrow();
    await expect(studioA.mutation(api.featureRequests.submit, { title: "x".repeat(121) })).rejects.toThrow();
    await expect(studioA.mutation(api.featureRequests.submit, { title: "Fine title", description: "d".repeat(2001) })).rejects.toThrow();
    await expect(studioA.mutation(api.featureRequests.submit, { title: "Fine title", category: "Nope" })).rejects.toThrow();
  });

  it("voting is one per person, idempotent, and the toggle removes it", async () => {
    const id = await studioA.mutation(api.featureRequests.submit, { title: "Dark mode for the portal" });
    await studioB.mutation(api.featureRequests.setVote, { requestId: id, voted: true });
    await studioB.mutation(api.featureRequests.setVote, { requestId: id, voted: true });
    expect((await studioB.query(api.featureRequests.list, {}))[0].votes).toBe(2);

    const off = await studioB.mutation(api.featureRequests.toggleVote, { requestId: id });
    expect(off).toEqual({ voted: false, votes: 1 });
    await studioB.mutation(api.featureRequests.setVote, { requestId: id, voted: false });
    expect((await studioB.query(api.featureRequests.list, {}))[0]).toMatchObject({ votes: 1, voted: false });
    const on = await studioB.mutation(api.featureRequests.toggleVote, { requestId: id });
    expect(on).toEqual({ voted: true, votes: 2 });
  });

  it("sorts by votes, then newest", async () => {
    const a = await studioA.mutation(api.featureRequests.submit, { title: "First idea" });
    vi.advanceTimersByTime(1000);
    const b = await studioA.mutation(api.featureRequests.submit, { title: "Second idea" });
    vi.advanceTimersByTime(1000);
    const c = await studioA.mutation(api.featureRequests.submit, { title: "Third idea" });
    await studioB.mutation(api.featureRequests.setVote, { requestId: a, voted: true });
    const order = (await studioB.query(api.featureRequests.list, {})).map((r) => r._id);
    expect(order).toEqual([a, c, b]);
  });

  it("only the platform owner can change status, edit or merge", async () => {
    const id = await studioA.mutation(api.featureRequests.submit, { title: "Offline mode" });
    await expect(studioA.mutation(api.featureRequests.setStatus, { requestId: id, status: "shipped" })).rejects.toThrow();
    await expect(studioB.mutation(api.featureRequests.edit, { requestId: id, title: "Hijacked" })).rejects.toThrow();
    await expect(staff.mutation(api.featureRequests.setStatus, { requestId: id, status: "beta" })).rejects.toThrow();
    await expect(studioA.query(api.featureRequests.adminList, {})).rejects.toThrow();

    await owner.mutation(api.featureRequests.setStatus, { requestId: id, status: "q3" });
    await owner.mutation(api.featureRequests.edit, { requestId: id, title: "Offline mode for the iOS app", category: "iOS app" });
    const row = (await studioB.query(api.featureRequests.list, {}))[0];
    expect(row).toMatchObject({ status: "q3", title: "Offline mode for the iOS app", category: "iOS app" });
  });

  it("other studios never see who asked; the owner does", async () => {
    await studioA.mutation(api.featureRequests.submit, { title: "Split invoices by song" });
    const seenByB = JSON.stringify(await studioB.query(api.featureRequests.list, {}));
    for (const leak of ["Studio Alpha", "a@alpha.test", "u_a", "org_a", "Al"]) {
      expect(seenByB).not.toContain(leak);
    }
    const similar = JSON.stringify(await studioB.query(api.featureRequests.similar, { text: "split invoices" }));
    expect(similar).toContain("Split invoices by song");
    expect(similar).not.toContain("Studio Alpha");

    const admin = await owner.query(api.featureRequests.adminList, {});
    expect(admin[0]).toMatchObject({ requesterOrgName: "Studio Alpha", requesterEmail: "a@alpha.test" });
  });

  it("limits a person to 10 requests a day, then resets", async () => {
    for (let i = 0; i < 10; i++) {
      await studioA.mutation(api.featureRequests.submit, { title: `Request number ${i}` });
    }
    await expect(studioA.mutation(api.featureRequests.submit, { title: "One too many" })).rejects.toThrow(/10 requests a day/);
    // Another person is unaffected.
    await studioB.mutation(api.featureRequests.submit, { title: "Someone else's idea" });
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    await studioA.mutation(api.featureRequests.submit, { title: "Tomorrow is fine" });
  });

  it("suggests existing requests while a title is typed", async () => {
    await studioA.mutation(api.featureRequests.submit, { title: "Calendar sync with Apple Calendar" });
    await studioA.mutation(api.featureRequests.submit, { title: "Stem delivery links" });
    const hits = await studioB.query(api.featureRequests.similar, { text: "apple cal" });
    expect(hits.map((h) => h.title)).toEqual(["Calendar sync with Apple Calendar"]);
    expect(await studioB.query(api.featureRequests.similar, { text: "x" })).toEqual([]);
  });

  it("merge moves votes once per person and hides the duplicate", async () => {
    const keep = await studioA.mutation(api.featureRequests.submit, { title: "Recurring sessions" });
    const dupe = await studioB.mutation(api.featureRequests.submit, { title: "Repeat weekly bookings" });
    await studioA.mutation(api.featureRequests.setVote, { requestId: dupe, voted: true }); // A is on both
    await expect(studioA.mutation(api.featureRequests.merge, { fromId: dupe, intoId: keep })).rejects.toThrow();
    const r = await owner.mutation(api.featureRequests.merge, { fromId: dupe, intoId: keep });
    expect(r.votes).toBe(2); // A (already there) + B (moved)
    const board = await studioB.query(api.featureRequests.list, {});
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ _id: keep, votes: 2, voted: true });
    await expect(studioB.mutation(api.featureRequests.setVote, { requestId: dupe, voted: true })).rejects.toThrow();
  });

  it("signed-out callers get nothing and cannot write", async () => {
    // Clerk configured: the no-identity path is denied, not treated as demo.
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.test");
    try {
      expect(await t.query(api.featureRequests.list, {})).toEqual([]);
      await expect(t.mutation(api.featureRequests.submit, { title: "Anonymous idea" })).rejects.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
