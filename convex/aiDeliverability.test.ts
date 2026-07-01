/* ============================================================
   AI deliverability - the two audit fixes:

   1. Send-time merge-token substitution: the model only ever emits
      {{user_FirstName}} / {{room_name}} (privacy: it never sees the
      real client name); the tokens are substituted at SEND time by
      applyMergeTokens() and a body still carrying any token is
      refused (consistent with lib/aiVerify.ts).

   2. Daily digest schedule + delivery: isDigestDue() honors
      agentPolicies.digestHourLocal (interpreted against UTC - orgs
      carry no timezone field) and the completed digest is emailed to
      the owner exactly once via the notify() seam.
   ============================================================ */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { applyMergeTokens, hasUnmergedTokens, MERGE_TOKENS } from "./agent";
import {
  isDigestDue,
  normalizeDigestHour,
  orgLocalHour,
  DIGEST_MIN_GAP_MS,
} from "./lib/digestSchedule";

const ORG = "pulse-demo"; // demo viewer resolves to an owner on this org

// ── 1a. Merge-token substitution (pure) ─────────────────────────────────

describe("applyMergeTokens", () => {
  it("substitutes every supported token with the real value", () => {
    const body = "Hey {{user_FirstName}},\n\nWe are set up in {{room_name}} for you.";
    const out = applyMergeTokens(body, { firstName: "Nova", roomName: "Studio A" });
    expect(out).toBe("Hey Nova,\n\nWe are set up in Studio A for you.");
  });

  it("covers ALL tokens the aiActions prompts can emit", () => {
    // If a new token is added to the prompts, add it to MERGE_TOKENS and here.
    const everyToken = MERGE_TOKENS.map((t) => `{{${t.token}}}`).join(" ");
    const out = applyMergeTokens(everyToken, { firstName: "Ivy", roomName: "Room B" });
    expect(hasUnmergedTokens(out)).toBe(false);
    expect(out).toContain("Ivy");
    expect(out).toContain("Room B");
  });

  it("falls back safely when a value is missing", () => {
    const out = applyMergeTokens("Hey {{user_FirstName}}, see you in {{room_name}}.", {});
    expect(out).toBe("Hey there, see you in the studio.");
  });

  it("treats blank / whitespace values as missing", () => {
    const out = applyMergeTokens("Hey {{user_FirstName}}!", { firstName: "  " });
    expect(out).toBe("Hey there!");
  });

  it("is case-insensitive and tolerates inner whitespace", () => {
    const out = applyMergeTokens("Hi {{ USER_FIRSTNAME }} - {{Room_Name}}", {
      firstName: "Mo",
      roomName: "The Loft",
    });
    expect(out).toBe("Hi Mo - The Loft");
  });

  it("replaces repeated occurrences everywhere", () => {
    const out = applyMergeTokens("{{user_FirstName}} + {{user_FirstName}}", { firstName: "Jo" });
    expect(out).toBe("Jo + Jo");
  });

  it("strips em, en, and horizontal-bar dashes (brand egress rule)", () => {
    const out = applyMergeTokens("Hey {{user_FirstName}} — see you soon – ok ― bye", {
      firstName: "Ash",
    });
    expect(out).toBe("Hey Ash - see you soon - ok - bye");
    expect(out).not.toMatch(/[—–―]/);
  });
});

describe("hasUnmergedTokens", () => {
  it("flags any leftover {{...}} token, matching the aiVerify placeholder gate", () => {
    expect(hasUnmergedTokens("Hi {{some_unknown_token}}")).toBe(true);
    expect(hasUnmergedTokens("Hi {{user_FirstName}}")).toBe(true);
    expect(hasUnmergedTokens("Hi Nova, welcome back")).toBe(false);
  });

  it("is false after a full merge", () => {
    const merged = applyMergeTokens("Hi {{user_FirstName}} in {{room_name}}", {
      firstName: "Kai",
      roomName: "Studio B",
    });
    expect(hasUnmergedTokens(merged)).toBe(false);
  });
});

// ── 2a. Digest schedule decision (pure) ─────────────────────────────────

/** Epoch ms for an arbitrary fixed day at hh:mm UTC. */
function atUtc(hour: number, minute = 0, day = 15): number {
  return Date.UTC(2026, 5, day, hour, minute, 0, 0);
}

describe("isDigestDue", () => {
  it("fires during the configured hour when never run before", () => {
    expect(isDigestDue({ now: atUtc(8, 5), digestHourLocal: 8 })).toBe(true);
    expect(isDigestDue({ now: atUtc(8, 59), digestHourLocal: 8 })).toBe(true);
  });

  it("does NOT fire before the configured hour", () => {
    expect(isDigestDue({ now: atUtc(7, 59), digestHourLocal: 8 })).toBe(false);
    expect(isDigestDue({ now: atUtc(0, 0), digestHourLocal: 8 })).toBe(false);
  });

  it("does NOT fire after the hour has passed (waits for tomorrow)", () => {
    expect(isDigestDue({ now: atUtc(9, 1), digestHourLocal: 8 })).toBe(false);
    expect(isDigestDue({ now: atUtc(23, 30), digestHourLocal: 8 })).toBe(false);
  });

  it("does not fire twice in the same day (20h gap)", () => {
    const first = atUtc(8, 5);
    // A later tick inside the same hour: hour matches but gap blocks it.
    expect(isDigestDue({ now: atUtc(8, 35), digestHourLocal: 8, lastDigestAt: first })).toBe(false);
    expect(isDigestDue({ now: atUtc(8, 50), digestHourLocal: 8, lastDigestAt: first })).toBe(false);
  });

  it("fires again the next day at the configured hour", () => {
    const yesterday = atUtc(8, 10, 14);
    expect(isDigestDue({ now: atUtc(8, 5, 15), digestHourLocal: 8, lastDigestAt: yesterday })).toBe(true);
  });

  it("honors a changed digestHourLocal", () => {
    const lastAt8 = atUtc(8, 5);
    // Owner moves the brief to 17:00; same-day 17:05 is >20h? No (9h) - so it
    // waits, then fires the NEXT day at 17.
    expect(isDigestDue({ now: atUtc(17, 5, 15), digestHourLocal: 17, lastDigestAt: lastAt8 })).toBe(false);
    expect(isDigestDue({ now: atUtc(17, 5, 16), digestHourLocal: 17, lastDigestAt: lastAt8 })).toBe(true);
  });

  it("respects an org-local UTC offset when provided", () => {
    // 13:00 UTC == 8:00 local at UTC-5.
    expect(isDigestDue({ now: atUtc(13, 0), digestHourLocal: 8, utcOffsetMinutes: -300 })).toBe(true);
    expect(isDigestDue({ now: atUtc(8, 0), digestHourLocal: 8, utcOffsetMinutes: -300 })).toBe(false);
  });

  it("normalizes junk hour settings instead of never firing", () => {
    expect(normalizeDigestHour(24)).toBe(0);
    expect(normalizeDigestHour(-1)).toBe(23);
    expect(normalizeDigestHour(8.9)).toBe(8);
    expect(normalizeDigestHour(Number.NaN)).toBe(8);
    expect(isDigestDue({ now: atUtc(0, 30), digestHourLocal: 24 })).toBe(true);
  });

  it("exposes a 20h minimum gap and a UTC hour helper", () => {
    expect(DIGEST_MIN_GAP_MS).toBe(20 * 60 * 60 * 1000);
    expect(orgLocalHour(atUtc(9, 59))).toBe(9);
  });
});

// ── Integration: send path + digest scheduling/delivery ────────────────

async function drain(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("sendArtifactDraft (send-time merge + client email path)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "demo", plan: "studio", status: "active" });
    });
  });
  afterEach(() => vi.useRealTimers());

  async function seedRecapArtifact(opts?: { withArtistEmail?: boolean; body?: string }) {
    return await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova Reyes", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
        ...(opts?.withArtistEmail === false ? {} : { email: "nova@example.com" }),
      });
      const roomId = await ctx.db.insert("rooms", { orgId: ORG, name: "Studio A", status: "available", bookable: true });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Vocal tracking", artistId, roomId, serviceType: "recording",
        startTime: Date.now() + 3_600_000, endTime: Date.now() + 7_200_000, status: "confirmed",
        rateCents: 20000, depositCents: 0, depositPaid: true, intakeCompleted: true,
      });
      const artifactId = await ctx.db.insert("aiArtifacts", {
        orgId: ORG, kind: "session_recap", sessionId, roomId,
        title: "Recap drafted - Vocal tracking", summary: "Recap ready.",
        body: opts?.body ?? "Hey {{user_FirstName}},\n\nGreat session in {{room_name}} — talk soon.",
        emailDraft: {
          to: "nova@example.com",
          subject: "Recap: Vocal tracking",
          body: opts?.body ?? "Hey {{user_FirstName}},\n\nGreat session in {{room_name}} — talk soon.",
        },
        source: "fallback", status: "ready", generatedAt: Date.now(),
      });
      return { artistId, artifactId };
    });
  }

  it("substitutes tokens at send time and logs the clean body to the client thread", async () => {
    const { artistId, artifactId } = await seedRecapArtifact();
    const res = await t.action(api.agent.sendArtifactDraft, { artifactId });
    // No RESEND key in tests -> internal channel simulates, still "ok".
    expect(res.ok).toBe(true);
    expect(res.channel).toBe("internal");

    const messages = await t.query(api.clientEmail.thread, { artistId });
    expect(messages).toHaveLength(1);
    const sent = messages[0];
    expect(sent.body).toContain("Hey Nova,");
    expect(sent.body).toContain("Studio A");
    expect(sent.body).not.toContain("{{");
    expect(sent.body).not.toMatch(/[—–―]/); // stripEmDashes applied
    expect(sent.direction).toBe("out");

    // Artifact flips to acknowledged after a successful send.
    const artifact = await t.query(api.aiArtifacts.get, { id: artifactId });
    expect(artifact?.status).toBe("acknowledged");
  });

  it("mergedDraftEmail returns a token-free preview for the UI/mailto fallback", async () => {
    const { artifactId } = await seedRecapArtifact();
    const merged = await t.query(api.agent.mergedDraftEmail, { artifactId });
    expect(merged).not.toBeNull();
    expect(merged!.body).toContain("Hey Nova,");
    expect(merged!.body).not.toContain("{{");
    expect(merged!.canSend).toBe(true);
  });

  it("refuses to send when the client has no email on file", async () => {
    const { artifactId } = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Ghost", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Mix", artistId, serviceType: "mixing",
        startTime: Date.now(), endTime: Date.now() + 1, status: "confirmed",
        rateCents: 1000, depositCents: 0, depositPaid: true, intakeCompleted: true,
      });
      const artifactId = await ctx.db.insert("aiArtifacts", {
        orgId: ORG, kind: "session_recap", sessionId,
        title: "Recap", summary: "x",
        emailDraft: { subject: "Recap", body: "Hey {{user_FirstName}}" },
        source: "fallback", status: "ready", generatedAt: Date.now(),
      });
      return { artifactId };
    });
    await expect(t.action(api.agent.sendArtifactDraft, { artifactId })).rejects.toThrow(/email/i);
  });

  it("refuses to send a body that still carries an unknown token after merging", async () => {
    const { artifactId } = await seedRecapArtifact({
      body: "Hey {{user_FirstName}}, your code is {{discount_code}}.",
    });
    await expect(t.action(api.agent.sendArtifactDraft, { artifactId })).rejects.toThrow(/merge token/i);
    // Nothing was logged and the artifact stays ready.
    const artifact = await t.query(api.aiArtifacts.get, { id: artifactId });
    expect(artifact?.status).toBe("ready");
  });
});

describe("daily digest: schedule honored + delivered to the owner once", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    vi.useFakeTimers();
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG, name: "Skyline", slug: "demo", plan: "studio", status: "active",
        ownerEmail: "owner@skyline.studio",
      });
      await ctx.db.insert("agentPolicies", {
        orgId: ORG, enabled: true, defaultTone: "professional", autonomy: "suggest",
        digestEnabled: true, digestHourLocal: 9, updatedAt: Date.now(),
      });
    });
  });
  afterEach(() => vi.useRealTimers());

  it("_maybeStartDigest fires at the configured hour, not before, not twice", async () => {
    // Before the hour: nothing.
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 8, 45)));
    expect(await t.mutation(internal.agent._maybeStartDigest, { orgId: ORG })).toBeNull();

    // Inside the hour: fires.
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 5)));
    const runId = await t.mutation(internal.agent._maybeStartDigest, { orgId: ORG });
    expect(runId).not.toBeNull();

    // A later tick the same hour/day: blocked (no double digest).
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 35)));
    expect(await t.mutation(internal.agent._maybeStartDigest, { orgId: ORG })).toBeNull();

    // Next day, same hour: fires again.
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 16, 9, 10)));
    expect(await t.mutation(internal.agent._maybeStartDigest, { orgId: ORG })).not.toBeNull();
  });

  it("a completed digest run emails the owner via notify(), exactly once", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 0)));
    const runId = await t.mutation(internal.agent._maybeStartDigest, { orgId: ORG });
    expect(runId).not.toBeNull();

    await t.mutation(internal.agent._finalize, {
      runId: runId!, orgId: ORG, status: "completed",
      summary: "2 sessions today, 1 overdue invoice.",
      assistant: "Good morning — 2 sessions today and 1 overdue invoice worth chasing.",
      source: "fallback",
    });
    await drain(t);

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "agent_daily_digest"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("email");
    expect(rows[0].recipient).toBe("owner@skyline.studio");
    expect(rows[0].subject).toMatch(/daily studio brief/i);
    expect(rows[0].body).toContain("overdue invoice");
    expect(rows[0].body).not.toMatch(/[—–―]/); // em dashes stripped
    // No provider configured in tests -> the deliver action marks it simulated.
    expect(rows[0].status).toBe("simulated");

    // Re-finalizing the same (already completed) run must NOT double-send.
    await t.mutation(internal.agent._finalize, {
      runId: runId!, orgId: ORG, status: "completed", summary: "dup", assistant: "dup", source: "fallback",
    });
    await drain(t);
    const after = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "agent_daily_digest"),
    );
    expect(after).toHaveLength(1);
  });

  it("a failed digest run sends nothing", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 15, 9, 0)));
    const runId = await t.mutation(internal.agent._maybeStartDigest, { orgId: ORG });
    await t.mutation(internal.agent._finalize, {
      runId: runId!, orgId: ORG, status: "failed", error: "boom",
    });
    await drain(t);
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).filter((n) => n.kind === "agent_daily_digest"),
    );
    expect(rows).toHaveLength(0);
  });
});
