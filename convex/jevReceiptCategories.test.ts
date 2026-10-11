import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EXPENSE_CATEGORIES } from "./lib/financeCategories";
import {
  LOOKS_PERSONAL_AT,
  LOOKS_PERSONAL_QUESTION,
  looksPersonal,
  readCategoryAnswer,
  receiptCategoryQuestions,
  receiptCategoryState,
} from "./lib/jev/receiptCategories";

/* Jev (TypeSafe System One) receipt category suggestions. The promises held
   here: a suggestion is stored after a receipt is read and shown to the
   owner, a category a person chose is never replaced, "Looks personal?"
   starts at 0.7, Jev being off or down changes nothing, and Jev only ever
   sees the receipt's own vendor, total, currency and date. */

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => {
  class APIError extends Error {}
  class TypeSafeClient {
    systemOne = systemOne;
  }
  return { TypeSafeClient, APIError };
});

const ORG = "pulse-demo";
const realFetch = globalThis.fetch;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const jevAnswers = (category: string, probability: number, personal: number, confidence = probability) => ({
  model: "jev-1.13.0",
  answers: {
    category: { type: "choice", choice: category, confidence, probabilities: { [category]: probability, other: 1 - probability } },
    looksPersonal: { type: "noul", noul: personal },
  },
  usage: { input_tokens: 1124, output_tokens: 236 },
});

async function studio() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "growth", status: "active" });
    for (const [name, role, subject] of [["Olu", "owner", "user_owner"], ["Quincy Uploader", "manager", "user_manager"]] as const) {
      await ctx.db.insert("members", { orgId: ORG, name, role, email: `${subject}@demo.com`, skills: [], clerkUserId: subject });
    }
  });
  return {
    t,
    owner: t.withIdentity({ subject: "user_owner", name: "Olu" }),
    manager: t.withIdentity({ subject: "user_manager", name: "Quincy Uploader" }),
  };
}
type Studio = Awaited<ReturnType<typeof studio>>;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
async function stored(t: Studio["t"]) {
  const data = new Uint8Array(2048);
  PNG.forEach((b, i) => { data[i] = b; });
  return await t.run(async (ctx) => await ctx.storage.store(new Blob([data], { type: "image/png" })));
}

async function upload(s: Studio, fileName = "receipt.png", expenseId?: Id<"expenses">) {
  const res = await s.manager.mutation(api.receipts.attach, { storageId: await stored(s.t), fileName, expenseId });
  if (!res.ok) throw new Error(res.message);
  return res.receiptId;
}

/** A receipt the AI has read: Sweetwater, $64.99, card ending 3333. */
async function readReceipt(s: Studio, fields: { vendor?: string; total?: number } = {}, fileName?: string, expenseId?: Id<"expenses">) {
  const receiptId = await upload(s, fileName, expenseId);
  await s.t.mutation(internal.receipts._saveExtraction, {
    receiptId, model: "gemini-3.5-flash-lite", vendor: fields.vendor ?? "Sweetwater", date: "2026-09-01",
    total: fields.total ?? 64.99, tax: 5.2, currency: "USD", cardLast4: "3333", confidence: 0.95,
  });
  return receiptId;
}

const queued = (t: Studio["t"]) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("suggestCategory")));
const getReceipt = (t: Studio["t"], id: Id<"receipts">) => t.run(async (ctx) => (await ctx.db.get(id))!);
const listed = async (s: Studio, id: Id<"receipts">) => (await s.owner.query(api.receipts.list, { status: "all" })).find((r) => r._id === id)!;
const suggestedLog = async (s: Studio, receiptId: Id<"receipts">) =>
  (await s.owner.query(api.reconcile.history, { receiptId })).filter((e) => e.action === "receipt.category_suggested");

describe("receipt category questions (pure)", () => {
  it("offers the studio's own categories, each described, plus other for none of these fit", () => {
    const q = receiptCategoryQuestions();
    expect(q.category.type).toBe("choice");
    const offered = Object.keys(q.category.criteria);
    // Every category in the studio's list except the accountant-only P&L adjustment, "other" last.
    expect(offered).toEqual([...EXPENSE_CATEGORIES.map((c) => c.value).filter((c) => c !== "adjustment" && c !== "other"), "other"]);
    for (const c of EXPENSE_CATEGORIES.filter((x) => x.value !== "adjustment" && x.value !== "other")) {
      const description = q.category.criteria[c.value];
      expect(description.startsWith(`${c.label}: `), c.value).toBe(true);
      expect(description.length, c.value).toBeGreaterThan(c.label.length + 12);
    }
    expect(q.category.criteria.other).toBe("Other: none of these fit");
    expect(q.looksPersonal).toMatchObject({ type: "noul", instructions: LOOKS_PERSONAL_QUESTION });
    expect(LOOKS_PERSONAL_QUESTION).toBe("Does this receipt look like a personal purchase rather than a business expense for a recording studio?");
    expect(q.looksPersonal.criteria.true.length).toBeGreaterThan(40);
    expect(q.looksPersonal.criteria.false.length).toBeGreaterThan(40);
  });

  it("builds the options from the list it is given, in the studio's wording", () => {
    const q = receiptCategoryQuestions([
      { value: "gear", label: "Studio gear" },
      { value: "adjustment", label: "P&L adjustment" },
      { value: "podcast_props", label: "Podcast props" },
    ]);
    expect(Object.keys(q.category.criteria)).toEqual(["gear", "podcast_props", "other"]);
    expect(q.category.criteria.gear).toMatch(/^Studio gear: buying microphones/);
    expect(q.category.criteria.podcast_props).toBe("Podcast props");
  });

  it("reads an answer only when it names one of the studio's categories", () => {
    expect(readCategoryAnswer(jevAnswers("gear", 0.92, 0.12, 0.91).answers)).toEqual({
      category: "gear", probability: 0.92, confidence: 0.91, looksPersonal: 0.12,
    });
    for (const label of ["adjustment", "lunch", "toString"]) {
      expect(readCategoryAnswer(jevAnswers(label, 0.9, 0.1).answers), label).toBeNull();
    }
    expect(readCategoryAnswer(jevAnswers("gear", Number.NaN, 0.1).answers)).toBeNull();
    expect(readCategoryAnswer(jevAnswers("gear", 0.9, 1.5).answers)).toBeNull();
    expect(readCategoryAnswer(undefined)).toBeNull();
    expect(readCategoryAnswer({ category: jevAnswers("gear", 0.9, 0.1).answers.category } as never)).toBeNull();
  });

  it("thresholds looksPersonal at 0.7", () => {
    expect(LOOKS_PERSONAL_AT).toBe(0.7);
    expect(looksPersonal(0.69)).toBe(false);
    expect(looksPersonal(0.7)).toBe(true);
    expect(looksPersonal(0.95)).toBe(true);
  });

  it("puts only the receipt's own fields in the state, never card digits, files or bank links", () => {
    const row = {
      _id: "r1", orgId: ORG, storageId: "kg2storage", fileName: "family-card-4242.png", fileType: "image/png", sizeBytes: 2048,
      uploadedBy: "Olu", uploadedAt: day("2026-09-02"), status: "ready", vendor: "Sweetwater", date: day("2026-09-01"),
      totalCents: 6499, taxCents: 520, currency: "USD", cardLast4: "4242", confidence: 0.95, model: "gemini-3.5-flash-lite",
      bankTransactionId: "bank-txn-1", expenseId: undefined, error: "x",
    };
    const state = receiptCategoryState(row);
    expect(state).toEqual({ receipt: { vendor: "Sweetwater", total: 64.99, currency: "USD", date: "2026-09-01" } });
    const sent = JSON.stringify(state);
    for (const secret of ["4242", "family", "Olu", "bank-txn-1", "kg2storage", "gemini", "520"]) expect(sent).not.toContain(secret);
    // A missing field is left out, never guessed.
    expect(receiptCategoryState({ vendor: "Shop" })).toEqual({ receipt: { vendor: "Shop" } });
  });
});

describe("receipts.suggestCategory", () => {
  // Fake timers keep convex-test from running scheduled functions in the
  // background; each test runs the action itself, or finishes the queue.
  beforeEach(() => {
    vi.useFakeTimers();
    systemOne.mockReset();
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    globalThis.fetch = realFetch;
  });

  it("stores Jev's suggestion after a receipt is read, logs it, and the owner sees it", async () => {
    const s = await studio();
    const receiptId = await readReceipt(s);
    expect(await queued(s.t)).toHaveLength(1);

    systemOne.mockResolvedValue(jevAnswers("gear", 0.92, 0.12, 0.91));
    await s.t.action(internal.receipts.suggestCategory, { receiptId });

    expect((await getReceipt(s.t, receiptId)).categorySuggestion).toMatchObject({
      category: "gear", probability: 0.92, confidence: 0.91, looksPersonal: 0.12, model: "jev-1.13.0",
    });
    expect((await listed(s, receiptId)).categorySuggestion).toEqual({ category: "gear", confidence: 0.91, looksPersonal: false });
    const [log] = await suggestedLog(s, receiptId);
    expect(log).toMatchObject({ actorType: "ai", model: "jev-1.13.0", detail: "suggested Gear and equipment, 91% sure" });
    // A suggestion only: nothing is posted, the receipt itself is unchanged.
    expect(await s.t.run(async (ctx) => await ctx.db.query("expenses").collect())).toHaveLength(0);
    expect(await getReceipt(s.t, receiptId)).toMatchObject({ status: "ready", vendor: "Sweetwater", totalCents: 6499 });
  });

  it("runs by itself after an upload is read, and creates nothing in the books", async () => {
    vi.stubEnv("RECEIPT_AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    const s = await studio();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{
      finishReason: "STOP",
      content: { parts: [{ text: JSON.stringify({ vendor: "Sweetwater", date: "2026-09-01", total: 64.99, tax: 0, currency: "USD", cardLast4: "3333", confidence: 0.95 }) }] },
    }] }))) as typeof fetch;
    systemOne.mockResolvedValue(jevAnswers("gear", 0.92, 0.12, 0.91));
    const receiptId = await upload(s, "upload.png");
    // Runs the upload's extract -> save -> suggestCategory (and matching) chain.
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await listed(s, receiptId)).toMatchObject({
      vendor: "Sweetwater", totalCents: 6499, categorySuggestion: { category: "gear", confidence: 0.91, looksPersonal: false },
    });
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(await s.t.run(async (ctx) => await ctx.db.query("expenses").collect())).toHaveLength(0);
  });

  it("never asks about, or writes over, a receipt uploaded against an expense a person filed", async () => {
    const s = await studio();
    const expenseId = await s.manager.mutation(api.expenses.create, { category: "software", amountCents: 6499, date: day("2026-09-01"), vendor: "Sweetwater" });
    const receiptId = await readReceipt(s, {}, "receipt.png", expenseId);
    expect(await queued(s.t)).toHaveLength(0);
    systemOne.mockResolvedValue(jevAnswers("gear", 0.95, 0.05));
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    expect(systemOne).not.toHaveBeenCalled();
    expect((await getReceipt(s.t, receiptId)).categorySuggestion).toBeUndefined();
    expect((await s.t.run(async (ctx) => await ctx.db.get(expenseId)))!.category).toBe("software");
  });

  it("drops an answer that arrives after the owner chose the category", async () => {
    const s = await studio();
    const receiptId = await readReceipt(s);
    // While Jev is thinking, the owner creates the expense as Gear.
    systemOne.mockImplementation(async () => {
      await s.manager.mutation(api.receipts.createExpense, { id: receiptId, category: "gear" });
      return jevAnswers("supplies", 0.8, 0.1);
    });
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    expect(systemOne).toHaveBeenCalledTimes(1);
    const r = await getReceipt(s.t, receiptId);
    expect(r.categorySuggestion).toBeUndefined();
    expect((await s.t.run(async (ctx) => await ctx.db.get(r.expenseId!)))!.category).toBe("gear");
    expect(await suggestedLog(s, receiptId)).toHaveLength(0);
  });

  it("stops showing a stored suggestion once the receipt is in the books, and keeps the person's category", async () => {
    const s = await studio();
    const receiptId = await readReceipt(s);
    systemOne.mockResolvedValue(jevAnswers("supplies", 0.7, 0.9));
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    expect((await listed(s, receiptId)).categorySuggestion).toMatchObject({ category: "supplies", looksPersonal: true });
    const expenseId = await s.manager.mutation(api.receipts.createExpense, { id: receiptId, category: "gear" });
    expect((await listed(s, receiptId)).categorySuggestion).toBeNull();
    expect((await s.t.run(async (ctx) => await ctx.db.get(expenseId as Id<"expenses">)))!.category).toBe("gear");
  });

  it("shows Looks personal? from 0.7, not below", async () => {
    const s = await studio();
    const below = await readReceipt(s, { vendor: "Target" });
    const at = await readReceipt(s, { vendor: "Toys R Us" });
    systemOne.mockResolvedValueOnce(jevAnswers("supplies", 0.6, 0.69)).mockResolvedValueOnce(jevAnswers("other", 0.75, 0.7));
    await s.t.action(internal.receipts.suggestCategory, { receiptId: below });
    await s.t.action(internal.receipts.suggestCategory, { receiptId: at });
    expect((await listed(s, below)).categorySuggestion).toMatchObject({ looksPersonal: false });
    expect((await listed(s, at)).categorySuggestion).toMatchObject({ category: "other", looksPersonal: true });
    expect((await suggestedLog(s, at))[0].detail).toBe("suggested Other, 75% sure; looks personal");
  });

  it("without a Jev key nothing is queued or stored, and the receipt reads exactly as before", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const s = await studio();
    const receiptId = await readReceipt(s);
    expect(await queued(s.t)).toHaveLength(0);
    const before = await getReceipt(s.t, receiptId);
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    expect(systemOne).not.toHaveBeenCalled();
    expect(await getReceipt(s.t, receiptId)).toEqual(before);
    expect(before.categorySuggestion).toBeUndefined();
    expect((await listed(s, receiptId)).categorySuggestion).toBeNull();
    expect(await suggestedLog(s, receiptId)).toHaveLength(0);
  });

  it("when Jev is down or answers off the list, the receipt is left exactly as it was", async () => {
    const s = await studio();
    const receiptId = await readReceipt(s);
    const before = await getReceipt(s.t, receiptId);
    systemOne.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(jevAnswers("lunch", 0.9, 0.1));
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    expect(systemOne).toHaveBeenCalledTimes(2);
    expect(await getReceipt(s.t, receiptId)).toEqual(before);
    expect((await listed(s, receiptId)).categorySuggestion).toBeNull();
    expect(await suggestedLog(s, receiptId)).toHaveLength(0);
  });

  it("privacy: Jev sees only the receipt's vendor, total, currency and date, never the bank line, balances or card digits", async () => {
    const s = await studio();
    const receiptId = await readReceipt(s, {}, "card-4242-statement.png");
    await s.t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId: ORG, plaidItemId: "plaid-item-secret", institutionName: "Chase", status: "active", createdAt: Date.now(),
        tokenCiphertext: "sealed-token-secret", tokenIv: "iv-secret",
      });
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId: ORG, connectionId, plaidAccountId: "plaid-account-secret", name: "Business Checking", mask: "9876",
        type: "depository", currentCents: 1234567, availableCents: 7654321, currency: "USD", balanceAsOf: Date.now(),
      });
      const bankTransactionId = await ctx.db.insert("bankTransactions", {
        orgId: ORG, connectionId, accountId, plaidTransactionId: "plaid-txn-secret", date: day("2026-09-02"), amountCents: 6499,
        direction: "out", currency: "USD", name: "SQ *SWEETWATER SOUND 260", merchantName: "Sweetwater Sound", pending: false,
        receiptId, updatedAt: Date.now(),
      });
      await ctx.db.patch(receiptId, { bankTransactionId });
    });
    systemOne.mockResolvedValue(jevAnswers("gear", 0.92, 0.12));
    await s.t.action(internal.receipts.suggestCategory, { receiptId });

    expect(systemOne).toHaveBeenCalledTimes(1);
    const request = systemOne.mock.calls[0][0];
    expect(Object.keys(request).sort()).toEqual(["questions", "state"]);
    expect(request.state).toEqual({ receipt: { vendor: "Sweetwater", total: 64.99, currency: "USD", date: "2026-09-01" } });
    const sent = JSON.stringify(request);
    for (const secret of [
      "3333", "4242", "card-4242", "SQ *SWEETWATER", "Sweetwater Sound", "Business Checking", "9876", "Chase", "plaid-",
      "sealed-token", "1234567", "12345.67", "7654321", "76543.21", "Quincy", String(receiptId),
    ]) {
      expect(sent, secret).not.toContain(secret);
    }
    // The suggestion is still stored; the bank link is untouched.
    expect(await getReceipt(s.t, receiptId)).toMatchObject({ categorySuggestion: { category: "gear" } });
  });

  it("a person's correction drops the old suggestion, asks again, and refuses a late answer about the old reading", async () => {
    const s = await studio();
    const receiptId = await readReceipt(s, { vendor: "Amazon", total: 43.2 });
    systemOne.mockResolvedValue(jevAnswers("other", 0.55, 0.6));
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    expect((await getReceipt(s.t, receiptId)).categorySuggestion).toMatchObject({ category: "other" });

    await s.manager.mutation(api.receipts.update, { id: receiptId, vendor: "Sweetwater", totalCents: 6499 });
    expect((await getReceipt(s.t, receiptId)).categorySuggestion).toBeUndefined();
    expect(await queued(s.t)).toHaveLength(2); // one after reading, one after the correction

    // An answer about the old reading (Amazon, $43.20) lands late: refused.
    const late = await s.t.mutation(internal.receipts._saveCategorySuggestion, {
      receiptId, basis: { vendor: "Amazon", totalCents: 4320, currency: "USD", date: day("2026-09-01") },
      category: "supplies", probability: 0.6, confidence: 0.58, looksPersonal: 0.5, model: "jev-1.13.0",
    });
    expect(late).toEqual({ stored: false, reason: "stale" });

    systemOne.mockResolvedValue(jevAnswers("gear", 0.9, 0.1));
    await s.t.action(internal.receipts.suggestCategory, { receiptId });
    expect((await getReceipt(s.t, receiptId)).categorySuggestion).toMatchObject({ category: "gear" });
    expect(systemOne.mock.calls.at(-1)![0].state).toEqual({ receipt: { vendor: "Sweetwater", total: 64.99, currency: "USD", date: "2026-09-01" } });
  });
});
