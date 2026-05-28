import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { scoreEntry, rankWaitlist, bestFit, type RankableEntry, type FreedSlot } from "./waitlist";

const ORG = "pulse-demo"; // demo viewer resolves to this org with owner caps
const DAY = 86_400_000;

function entry(over: Partial<RankableEntry> = {}): RankableEntry {
  return {
    _id: "e1",
    artistId: "a1",
    priority: "standard",
    createdAt: 1000,
    ...over,
  };
}

describe("waitlist ranking (pure)", () => {
  const slot: FreedSlot = { roomId: "roomA", serviceType: "recording", startTime: 5_000 };

  it("rewards an exact room + service match", () => {
    const exact = scoreEntry(slot, entry({ roomId: "roomA", serviceType: "recording" }));
    const flexible = scoreEntry(slot, entry({})); // no preferences
    expect(exact).toBeGreaterThan(flexible);
  });

  it("penalises a specified-but-mismatched room", () => {
    const mismatch = scoreEntry(slot, entry({ roomId: "roomB" }));
    expect(mismatch).toBeLessThan(0);
  });

  it("high priority outranks a standard entry", () => {
    const vip = scoreEntry(slot, entry({ priority: "high" }));
    const standard = scoreEntry(slot, entry({ priority: "standard" }));
    expect(vip).toBeGreaterThan(standard);
  });

  it("penalises a slot outside the desired window", () => {
    const inWindow = scoreEntry(slot, entry({ preferredFrom: 0, preferredTo: 10_000 }));
    const outOfWindow = scoreEntry(slot, entry({ preferredFrom: 10_000, preferredTo: 20_000 }));
    expect(inWindow).toBeGreaterThan(outOfWindow);
    expect(outOfWindow).toBeLessThan(inWindow - 50);
  });

  it("ranks best-first and breaks ties FIFO (oldest first)", () => {
    const older = entry({ _id: "older", createdAt: 100 });
    const newer = entry({ _id: "newer", createdAt: 900 });
    const ranked = rankWaitlist(slot, [newer, older]);
    expect(ranked.map((e) => e._id)).toEqual(["older", "newer"]);
  });

  it("bestFit returns null when nobody is a positive fit", () => {
    const onlyMismatch = entry({ roomId: "roomB", priority: "standard" });
    expect(bestFit(slot, [onlyMismatch])).toBeNull();
  });
});

describe("waitlist smart-fill (integration)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("cancelling a future session proposes a waitlist_fill action for the best match", async () => {
    const { sessionId, entryId } = await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", {
        orgId: ORG, name: "Studio A", roomType: "Live room", status: "available", hourlyRateCents: 10000,
      });
      const waitingArtist = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", email: "nova@x.com", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const bookedArtist = await ctx.db.insert("artists", {
        orgId: ORG, name: "Booked", type: "artist", email: "b@x.com", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Tracking day", artistId: bookedArtist, serviceType: "recording", roomId,
        startTime: Date.now() + DAY, endTime: Date.now() + DAY + 7_200_000,
        status: "confirmed", rateCents: 20000, depositCents: 5000, depositPaid: true, intakeCompleted: false,
      });
      const entryId = await ctx.db.insert("waitlistEntries", {
        orgId: ORG, artistId: waitingArtist, roomId, serviceType: "recording",
        priority: "standard", status: "waiting", createdAt: Date.now(),
      });
      return { sessionId, entryId };
    });

    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "cancelled" });

    const res = await t.run(async (ctx) => ({
      actions: (await ctx.db.query("opsActions").collect()).filter((a) => a.orgId === ORG && a.type === "waitlist_fill"),
      entry: await ctx.db.get(entryId),
    }));

    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].entityId).toBe(sessionId);
    expect(res.actions[0].payload.kind).toBe("email");
    expect(res.actions[0].payload.kind === "email" && res.actions[0].payload.to).toBe("nova@x.com");
    expect(res.entry?.status).toBe("notified");
  });

  it("does not propose a fill when the waitlist is empty", async () => {
    const sessionId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Solo", type: "artist", email: "s@x.com", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("sessions", {
        orgId: ORG, title: "Lonely day", artistId, serviceType: "mixing",
        startTime: Date.now() + DAY, endTime: Date.now() + DAY + 3_600_000,
        status: "confirmed", rateCents: 10000, depositCents: 2000, depositPaid: true, intakeCompleted: false,
      });
    });

    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "cancelled" });

    const actions = await t.run(async (ctx) =>
      (await ctx.db.query("opsActions").collect()).filter((a) => a.orgId === ORG && a.type === "waitlist_fill"),
    );
    expect(actions).toHaveLength(0);
  });
});
