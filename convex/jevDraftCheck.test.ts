import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import type { WithoutSystemFields } from "convex/server";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { DRAFT_BADGE_THRESHOLDS, DRAFT_CHECK_QUESTIONS, draftCheckBadge, draftCheckState } from "./lib/jev/draftCheck";

/* Jev (TypeSafe System One) safety check on agent drafts. These tests hold
   the promises that matter: every email draft gets Jev's three probabilities
   once its wording is final, Jev sees the draft and nothing more, the label
   never sends or approves anything, and without Jev nothing changes. */

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => {
  class APIError extends Error {}
  class TypeSafeClient {
    systemOne = systemOne;
  }
  return { TypeSafeClient, APIError };
});

// Claude's rewrite (aiActions.enrichOpsActions), controlled per test.
const { complete } = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("./lib/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/openai")>()),
  complete,
}));

const jevSays = (safeToSend: number, mentionsMoney: number, hasPlaceholder: number) => ({
  model: "jev-1.13.0",
  answers: {
    safeToSend: { type: "noul", noul: safeToSend },
    mentionsMoney: { type: "noul", noul: mentionsMoney },
    hasPlaceholder: { type: "noul", noul: hasPlaceholder },
  },
  usage: { input_tokens: 310, output_tokens: 6 },
});

const ORG = "org_drafts";
const CLIENT_EMAIL = "nova@client.test";
const DAY = 86_400_000;
const initT = () => convexTest(schema);
type T = ReturnType<typeof initT>;

const actions = (t: T) => t.run(async (ctx) => (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === ORG));
const byType = (rows: Doc<"opsActions">[], type: string) => rows.find((r) => r.type === type)!;
const jobs = (t: T, name: string) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes(name)));

/** A studio whose scan yields three email drafts: a re-engage and a payment
 *  reminder (Claude rewrites both) and a deposit nudge (no rewrite), plus a
 *  session confirmation that is not an email. */
async function seedStudio(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active" });
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova Reign", type: "artist", genres: [], tags: [], status: "active",
      lifetimeValueCents: 0, sessionCount: 1, reliability: "solid",
      email: CLIENT_EMAIL, lastContactAt: Date.now() - 120 * DAY,
    });
    await ctx.db.insert("invoices", {
      orgId: ORG, number: "INV-7", artistId, status: "overdue",
      lineItems: [{ label: "Mix", amountCents: 54000 }], amountCents: 54000, dueDate: Date.now() - 5 * DAY,
    });
    await ctx.db.insert("sessions", {
      orgId: ORG, title: "Vocal day", artistId, serviceType: "recording",
      startTime: Date.now() + 2.5 * DAY, endTime: Date.now() + 2.5 * DAY + 3 * 3_600_000,
      status: "tentative", rateCents: 20000, depositCents: 5000, depositPaid: false, intakeCompleted: false,
      source: "public_booking", holdExpiresAt: Date.now() + DAY,
    });
  });
}

async function insertDraft(t: T, over: Partial<WithoutSystemFields<Doc<"opsActions">>> = {}) {
  return t.run((ctx) =>
    ctx.db.insert("opsActions", {
      orgId: ORG, type: "reengage_quiet_artist", priority: "medium", title: "Re-engage Nova Reign",
      rationale: "No contact in 90+ days.",
      payload: { kind: "email", to: CLIENT_EMAIL, subject: "We'd love to have you back", body: "Hi Nova, want to grab a date?", notifyKind: "artist.reengage" },
      status: "proposed", autonomy: false, source: "rule", dedupeKey: "reengage_quiet_artist:a1", createdAt: Date.now(),
      ...over,
    }),
  );
}

describe("draft check questions and state (pure)", () => {
  it("asks three yes/no questions in the agreed words", () => {
    expect(Object.keys(DRAFT_CHECK_QUESTIONS)).toEqual(["safeToSend", "mentionsMoney", "hasPlaceholder"]);
    for (const q of Object.values(DRAFT_CHECK_QUESTIONS)) expect(q.type).toBe("noul");
    expect(DRAFT_CHECK_QUESTIONS.safeToSend.instructions).toBe(
      "Is this message ready to send to the recipient without the owner reviewing it?",
    );
    expect(DRAFT_CHECK_QUESTIONS.safeToSend.criteria.true).toMatch(/accurate, polite, on-topic, and makes no new promises/);
    expect(DRAFT_CHECK_QUESTIONS.safeToSend.criteria.false).toMatch(/refunds, discounts or dates not already agreed/);
    expect(DRAFT_CHECK_QUESTIONS.safeToSend.criteria.false).toMatch(/placeholders like \[Name\] or TODO/);
    expect(DRAFT_CHECK_QUESTIONS.mentionsMoney.instructions).toBe(
      "Does the message mention amounts, refunds, discounts, prices or payment terms?",
    );
    expect(DRAFT_CHECK_QUESTIONS.hasPlaceholder.instructions).toBe(
      "Does the message contain unfilled placeholders such as [Name], {{...}}, TODO or XXX?",
    );
  });

  it("gives Jev the draft as data plus its channel, the recipient's role and the action type, nothing else", () => {
    expect(draftCheckState({ actionType: "payment_reminder", subject: "Invoice INV-7", body: "Hi Nova, INV-7 is past due." })).toEqual({
      channel: "email from a recording studio",
      recipientRole: "client",
      actionType: "reminder about a past-due invoice",
      message: { subject: "Invoice INV-7", body: "Hi Nova, INV-7 is past due." },
    });
    expect(draftCheckState({ actionType: "convert_lead", subject: "s", body: "b" }).recipientRole).toBe("prospective client (a new lead)");
    expect(draftCheckState({ actionType: "some_new_type", subject: "s", body: "b" }).actionType).toBe("some new type");
  });
});

describe("draftCheckBadge (pure)", () => {
  const label = (safeToSend: number, mentionsMoney: number, hasPlaceholder: number) =>
    draftCheckBadge({ safeToSend, mentionsMoney, hasPlaceholder })?.label;

  it("uses the agreed thresholds", () => {
    expect(DRAFT_BADGE_THRESHOLDS).toEqual({ readySafeToSend: 0.85, readyMaxPlaceholder: 0.3, money: 0.7, placeholder: 0.5 });
  });

  it("maps each threshold at its edge", () => {
    // Looks ready: safeToSend >= 0.85 and hasPlaceholder < 0.3.
    expect(label(0.85, 0.1, 0.29)).toBe("Looks ready");
    expect(label(0.849, 0.1, 0.1)).toBe("Review");
    expect(label(0.95, 0.1, 0.3)).toBe("Review");
    // Check money details: mentionsMoney >= 0.7.
    expect(label(0.5, 0.7, 0.1)).toBe("Check money details");
    expect(label(0.5, 0.69, 0.1)).toBe("Review");
    // Has placeholders: hasPlaceholder >= 0.5.
    expect(label(0.2, 0.1, 0.5)).toBe("Has placeholders");
    expect(label(0.2, 0.1, 0.49)).toBe("Review");
    // Otherwise Review.
    expect(label(0.6, 0.3, 0.2)).toBe("Review");
  });

  it("lets a warning outrank Looks ready, and placeholders outrank money", () => {
    expect(label(0.95, 0.9, 0.1)).toBe("Check money details");
    expect(label(0.3, 0.9, 0.8)).toBe("Has placeholders");
  });

  it("shows no badge for a draft Jev did not check", () => {
    expect(draftCheckBadge(undefined)).toBeNull();
    expect(draftCheckBadge(null)).toBeNull();
  });
});

describe("Jev's read on drafts the agents create or rewrite", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    systemOne.mockReset();
    complete.mockReset();
    complete.mockResolvedValue(null); // no AI provider: the rule layer's words stay
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "RESEND_API_KEY"]) vi.stubEnv(k, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("stores the three probabilities and the model on every email draft, once its wording is final", async () => {
    const t = initT();
    await seedStudio(t);
    systemOne.mockImplementation(async ({ state }: { state: { message: { body: string } } }) =>
      state.message.body.includes("INV-7")
        ? jevSays(0.62, 0.97, 0.02)
        : state.message.body.includes("deposit")
          ? jevSays(0.7, 0.8, 0.05)
          : jevSays(0.91, 0.04, 0.03),
    );

    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await actions(t);
    expect(rows.filter((r) => r.payload.kind === "email").map((r) => r.type).sort()).toEqual([
      "deposit_unpaid_nudge", "payment_reminder", "reengage_quiet_artist",
    ]);
    expect(byType(rows, "payment_reminder").draftCheck).toMatchObject({ safeToSend: 0.62, mentionsMoney: 0.97, hasPlaceholder: 0.02, model: "jev-1.13.0" });
    expect(byType(rows, "deposit_unpaid_nudge").draftCheck).toMatchObject({ safeToSend: 0.7, mentionsMoney: 0.8, hasPlaceholder: 0.05, model: "jev-1.13.0" });
    expect(byType(rows, "reengage_quiet_artist").draftCheck).toMatchObject({ safeToSend: 0.91, mentionsMoney: 0.04, hasPlaceholder: 0.03, model: "jev-1.13.0" });
    expect(typeof byType(rows, "reengage_quiet_artist").draftCheck?.checkedAt).toBe("number");
    // A session confirmation is not a message: never asked about, never labeled.
    expect(byType(rows, "confirm_unconfirmed_session").draftCheck).toBeUndefined();

    // The draft no model rewrites is checked straight away; the two Claude
    // rewrites are checked once enrichment is done.
    const checks = await jobs(t, "jevDraftCheck:checkDrafts");
    expect(checks.map((j) => (j.args[0] as { ids: string[] }).ids.length).sort()).toEqual([1, 2]);
    expect(checks.every((j) => j.state.kind === "success")).toBe(true);

    // One call per draft, with the draft as data and no other personal data.
    expect(systemOne).toHaveBeenCalledTimes(3);
    for (const [req] of systemOne.mock.calls) {
      expect(Object.keys(req.state).sort()).toEqual(["actionType", "channel", "message", "recipientRole"]);
      expect(JSON.stringify(req.state)).not.toContain(CLIENT_EMAIL);
      expect(req.questions).toEqual(DRAFT_CHECK_QUESTIONS);
    }
  });

  it("labels a draft Claude rewrote from the rewritten words, never the first draft", async () => {
    const t = initT();
    await seedStudio(t);
    const rewrite = "Hey Nova, we have missed you around the studio. Want to book a session soon?";
    complete.mockResolvedValue({ source: "anthropic", model: "claude-test", text: rewrite });
    systemOne.mockResolvedValue(jevSays(0.9, 0.05, 0.02));

    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const reengage = byType(await actions(t), "reengage_quiet_artist");
    expect(reengage.payload.kind === "email" && reengage.payload.body).toBe(rewrite);
    expect(reengage.draftCheck).toMatchObject({ safeToSend: 0.9, model: "jev-1.13.0" });
    const bodiesJevRead = systemOne.mock.calls.map(([req]) => req.state.message.body as string);
    expect(bodiesJevRead).toContain(rewrite);
    expect(bodiesJevRead.some((b) => b.startsWith("Hi Nova, it has been a while"))).toBe(false);
  });

  it("never sends, approves or changes an approval rule, even when every draft looks ready", async () => {
    const t = initT();
    await seedStudio(t);
    systemOne.mockResolvedValue(jevSays(0.99, 0.01, 0.01));

    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await actions(t);
    expect(rows.filter((r) => r.payload.kind === "email").map((r) => draftCheckBadge(r.draftCheck)?.label)).toEqual([
      "Looks ready", "Looks ready", "Looks ready",
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ status: "proposed", autonomy: false });
      expect(r.decidedAt ?? r.decidedBy ?? r.executedAt).toBeUndefined();
    }
    expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("opsAutonomy").collect())).toHaveLength(0);
    expect(await jobs(t, "opsActions:execute")).toHaveLength(0);
  });

  it("leaves approval to the owner exactly as before, even on a draft Jev flagged", async () => {
    const t = initT();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Skyline", slug: "skyline", tier: "growth", status: "active" });
      await ctx.db.insert("members", { orgId: ORG, name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
    });
    const id = await insertDraft(t, {
      draftCheck: { safeToSend: 0.1, mentionsMoney: 0.2, hasPlaceholder: 0.95, model: "jev-1.13.0", checkedAt: Date.now() },
    });
    expect(draftCheckBadge((await t.run((ctx) => ctx.db.get(id)))?.draftCheck)?.label).toBe("Has placeholders");

    await t.withIdentity({ subject: "u1", name: "Owner", orgId: ORG }).mutation(api.opsActions.approve, { id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("executed");
  });

  it("stores a read only while the draft still says what Jev read, and drops it when Claude rewrites", async () => {
    const t = initT();
    const id = await insertDraft(t);
    const read = { id, subject: "We'd love to have you back", safeToSend: 0.9, mentionsMoney: 0.1, hasPlaceholder: 0.05, model: "jev-1.13.0" };

    expect(await t.mutation(internal.jevDraftCheck._record, { ...read, body: "Older words." })).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(id)))?.draftCheck).toBeUndefined();

    expect(await t.mutation(internal.jevDraftCheck._record, { ...read, body: "Hi Nova, want to grab a date?" })).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(id)))?.draftCheck).toMatchObject({ safeToSend: 0.9 });

    await t.mutation(internal.opsActions.applyEnrichment, { id, body: "Hey Nova, new words from Claude." });
    expect((await t.run((ctx) => ctx.db.get(id)))?.draftCheck).toBeUndefined();
  });

  it("never sends a decided draft or an accounting item to Jev", async () => {
    const t = initT();
    const decided = await insertDraft(t, { status: "approved" });
    const acct = await insertDraft(t, {
      type: "acct_anomaly", title: "Worth a look", payload: { kind: "acct_note", evidence: ["A cash draw with no memo."] },
      dedupeKey: "acct_anomaly:2026-07:x",
    });
    expect(await t.action(internal.jevDraftCheck.checkDrafts, { ids: [decided, acct] })).toEqual({ checked: 0 });
    expect(systemOne).not.toHaveBeenCalled();
  });
});

describe("without Jev, everything is as before", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    systemOne.mockReset();
    complete.mockReset();
    complete.mockResolvedValue(null);
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "RESEND_API_KEY"]) vi.stubEnv(k, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("with no key: nothing is queued, asked or stored", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const t = initT();
    await seedStudio(t);

    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const rows = await actions(t);
    expect(rows.filter((r) => r.payload.kind === "email")).toHaveLength(3);
    for (const r of rows) {
      expect(r.draftCheck).toBeUndefined();
      expect(r.status).toBe("proposed");
    }
    expect(await jobs(t, "jevDraftCheck")).toHaveLength(0);
    expect(systemOne).not.toHaveBeenCalled();
    const ids = rows.map((r) => r._id);
    expect(await t.action(internal.jevDraftCheck.checkDrafts, { ids })).toEqual({ checked: 0, reason: "no_key" });
  });

  it("when Jev fails: drafts keep no label and nothing errors", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
    const t = initT();
    await seedStudio(t);
    systemOne.mockRejectedValue(new Error("network down"));

    await t.mutation(internal.opsBrain.scanOrg, { orgId: ORG });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(systemOne).toHaveBeenCalledTimes(3);
    const rows = await actions(t);
    for (const r of rows) {
      expect(r.draftCheck).toBeUndefined();
      expect(r.status).toBe("proposed");
    }
    const all = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((j) => j.state.kind === "success")).toBe(true);
  });
});
