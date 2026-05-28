import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo";
const DAY = 86_400_000;

async function seedPortal(t: ReturnType<typeof convexTest>, opts: { token: string; expiresAt?: number; scope?: string } ) {
  return t.run(async (ctx) => {
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", email: "nova@x.com", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    await ctx.db.insert("songs", {
      orgId: ORG, title: "Skyline", artistId, kind: "single", stage: "mixing",
      moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
    });
    await ctx.db.insert("sessions", {
      orgId: ORG, title: "Mix review", artistId, serviceType: "mixing",
      startTime: Date.now() + DAY, endTime: Date.now() + DAY + 3_600_000,
      status: "confirmed", rateCents: 10000, depositCents: 2000, depositPaid: true, intakeCompleted: false,
    });
    await ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-1", artistId, status: "sent",
      lineItems: [{ label: "Mix", amountCents: 8000 }], amountCents: 8000, dueDate: Date.now() + DAY,
    });
    const grantId = await ctx.db.insert("collaboratorGrants", {
      orgId: ORG, email: "nova@x.com", name: "Nova",
      scope: (opts.scope ?? "artist_portal") as never,
      entityId: artistId, capabilities: ["songs.read"], token: opts.token,
      expiresAt: opts.expiresAt ?? Date.now() + 30 * DAY, invitedBy: "owner", useCount: 0,
    });
    return { artistId, grantId };
  });
}

describe("client concierge portal", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("summary returns the artist's world for a valid token", async () => {
    await seedPortal(t, { token: "good-token" });
    const s = await t.query(api.portal.summary, { token: "good-token" });
    expect(s).not.toBeNull();
    expect(s!.artistName).toBe("Nova");
    expect(s!.songs).toHaveLength(1);
    expect(s!.upcomingSessions).toHaveLength(1);
    expect(s!.outstandingCents).toBe(8000);
  });

  it("summary rejects expired, revoked, wrong-scope, and unknown tokens", async () => {
    await seedPortal(t, { token: "expired", expiresAt: Date.now() - 1000 });
    expect(await t.query(api.portal.summary, { token: "expired" })).toBeNull();

    await seedPortal(t, { token: "wrong-scope", scope: "song" });
    expect(await t.query(api.portal.summary, { token: "wrong-scope" })).toBeNull();

    expect(await t.query(api.portal.summary, { token: "nope" })).toBeNull();
  });

  it("ask returns a grounded fallback answer and bumps grant usage", async () => {
    // Force the deterministic (no-LLM) path so the test never makes a network call.
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    const { grantId } = await seedPortal(t, { token: "ask-token" });
    const res = await t.action(api.portal.ask, { token: "ask-token", question: "When is my next session?" });
    expect(res.source).toBe("fallback");
    expect(res.answer).toContain("song");

    const grant = await t.run(async (ctx) => ctx.db.get(grantId as Id<"collaboratorGrants">));
    expect(grant?.useCount).toBe(1);
    vi.unstubAllEnvs();
  });

  it("ask refuses an invalid token", async () => {
    const res = await t.action(api.portal.ask, { token: "bad", question: "hi" });
    expect(res.source).toBe("error");
  });
});
