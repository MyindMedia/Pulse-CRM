import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import * as XLSX from "xlsx";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { gridFromSheetJs, parseBooksWorkbook, planToImportArgs } from "./lib/booksImport";
import { parsePeriod } from "./lib/ledgerMath";
import { booksFixtureWorkbook } from "./ledgerBooks.fixture";

/* Late entries end to end (openspec/changes/late-entries), on the anonymized
   July books: import -> add a missed item to July -> statements, variances,
   August's roll-forward, the audit trail -> reverse it -> back to the cent.
   The fixture's numbers: reported expenses 2,413.80, recomputed 2,432.80;
   the 19.00 Vendor S4 podcast distribution charge (Jul 24, Card E) is in the
   journal and missing from the reported statement. */

const JULY = parsePeriod("2026-07");
const AUG = parsePeriod("2026-08");
const NOW = Date.UTC(2026, 9, 9, 17, 30); // Oct 9, 2026
const ORG = "org_books";
const OTHER = "org_other";
const BANK = {
  accountLabel: "Checking A", periodStart: JULY.start, periodEnd: JULY.end,
  beginningCents: 168_750, endingCents: 161_129, depositsCents: 244_500, withdrawalsCents: 250_521, feesCents: 1_600,
};

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function plan() {
  const wb = booksFixtureWorkbook(XLSX as never) as XLSX.WorkBook;
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const read = XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: false, cellNF: true });
  return planToImportArgs(parseBooksWorkbook(gridFromSheetJs(read as never, XLSX as never), { period: "2026-07" }));
}

async function setup() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (const orgId of [ORG, OTHER]) await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "growth", status: "active" });
    const m = (orgId: string, clerkUserId: string, role: "owner" | "manager" | "engineer" | "accountant") =>
      ctx.db.insert("members", { orgId, name: clerkUserId, role, skills: [], clerkUserId });
    await m(ORG, "u_owner", "owner");
    await m(ORG, "u_manager", "manager");
    await m(ORG, "u_engineer", "engineer");
    await m(ORG, "u_accountant", "accountant");
    await m(OTHER, "u_other_owner", "owner");
  });
  // The workbook was imported (and checked) in early August.
  vi.setSystemTime(Date.UTC(2026, 7, 5, 12));
  await t.mutation(internal.ledger.importBooksInternal, { orgId: ORG, plan: plan(), bank: [BANK], seedOpening: "implied" });
  vi.setSystemTime(NOW);
  const who = {
    owner: t.withIdentity({ subject: "u_owner", orgId: ORG, name: "Owner" }),
    manager: t.withIdentity({ subject: "u_manager", orgId: ORG, name: "Manager" }),
    engineer: t.withIdentity({ subject: "u_engineer", orgId: ORG }),
    accountant: t.withIdentity({ subject: "u_accountant", orgId: ORG }),
    otherOwner: t.withIdentity({ subject: "u_other_owner", orgId: OTHER }),
  };
  const accounts = await who.owner.query(api.ledger.accounts, {});
  const id = (key: string) => accounts.find((a) => a.key === key)!._id;
  return { t, who, id };
}

const S4 = (accountId: Id<"ledgerAccounts">) => ({
  kind: "expense" as const,
  entryDate: Date.UTC(2026, 6, 24, 15),
  counterparty: "Vendor S4",
  amountCents: 1_900,
  accountId,
  paidFrom: "card" as const,
  memo: "podcast distribution subscription",
});

const lateDocs = (t: T) => t.run(async (ctx) => (await ctx.db.query("journalEntries").collect()).filter((e) => e.lateEntry));

describe("adding a missed item to July", () => {
  it("catches the 19.00 Vendor S4 charge as a likely duplicate: it is already in the July journal", async () => {
    const { who, id } = await setup();
    const preview = await who.owner.query(api.ledger.lateEntryPreview, { period: "2026-07", input: S4(id("software")) });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.duplicates.map((d) => d.memo)).toEqual(["Vendor S4 podcast distribution subscription"]);
    expect(preview.before.expensesCents).toBe(243_280);
    expect(preview.after.expensesCents).toBe(245_180);
    await expect(who.owner.mutation(api.ledger.addLateEntry, { period: "2026-07", input: S4(id("software")), confirmPastMonth: true }))
      .rejects.toThrow(/may already be in the books: Vendor S4 podcast distribution subscription/);
  });

  it("posts a late entry dated in July, flags it, and never touches the reported statements", async () => {
    const { t, who, id } = await setup();
    const before = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    expect(before.recomputed.incomeStatement.totalExpensesCents).toBe(243_280);
    expect(before.lateEntries).toBeNull();
    const reportedRow = async () => t.run(async (ctx) => (await ctx.db.query("reportedStatements").collect()));
    const reportedBefore = await reportedRow();

    const out = await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", input: S4(id("software")), confirmPastMonth: true, allowDuplicate: true,
    });
    expect(out.before.netIncomeCents).toBe(-112_780);
    expect(out.after.netIncomeCents).toBe(-114_680);

    const [doc] = await lateDocs(t);
    expect(doc).toMatchObject({
      _id: out.entryId, status: "posted", source: "manual", lateEntry: true,
      entryDate: Date.UTC(2026, 6, 24), effectiveDate: Date.UTC(2026, 6, 24), enteredAt: NOW, enteredBy: "Owner",
      reason: "Missed invoice/receipt", lateKind: "expense", counterparty: "Vendor S4",
      memo: "Vendor S4 - podcast distribution subscription", totalCents: 1_900,
      paymentType: { kind: "credit_card", raw: "Credit Card" },
    });
    expect(doc.lines).toEqual([
      { accountId: id("software"), debitCents: 1_900, creditCents: 0 },
      { accountId: id("credit_card_payable"), debitCents: 0, creditCents: 1_900 },
    ]);

    const after = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    expect(after.recomputed.incomeStatement.totalExpensesCents).toBe(245_180);
    expect(after.reported).toEqual(before.reported);
    expect(await reportedRow()).toEqual(reportedBefore);
    const late = after.lateEntries!;
    expect(late.count).toBe(1);
    expect(late.since).toBe(Date.UTC(2026, 7, 5, 12));
    expect(late.lines.find((l) => l.key === "expense.software_subscriptions")).toMatchObject({ reportedCents: 5_399, recomputedCents: 9_199, lateEntryCents: 1_900, otherCents: 1_900, varianceCents: 3_800 });
    expect(late.headline).toBe("Recomputed net income differs from reported by $38.00: $19.00 from 1 late entry added Oct 9, $19.00 was there when the books were checked.");
    expect(after.checks.find((c) => c.code === "late_entries")).toMatchObject({ status: "warn", amountCents: -1_900 });

    // The journal shows it, and can list late entries alone.
    const lateOnly = await who.owner.query(api.ledger.journal, { period: "2026-07", filter: { lateOnly: true }, paginationOpts: { numItems: 100, cursor: null } });
    expect(lateOnly.page.map((e) => e._id)).toEqual([out.entryId]);
  });

  it("writes the finance audit log with the before and after, and an access audit row", async () => {
    const { t, who, id } = await setup();
    const out = await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", input: { ...S4(id("rent")), counterparty: "Landlord B", memo: "storage unit", amountCents: 12_500, paidFrom: "bank" }, confirmPastMonth: true,
    });
    const rows = await t.run(async (ctx) => ({
      finance: (await ctx.db.query("financeAudit").collect()).filter((r) => r.action.startsWith("ledger.late_entry")),
      access: (await ctx.db.query("auditEvents").collect()).filter((r) => r.action.startsWith("ledger.late_entry")),
    }));
    expect(rows.finance).toHaveLength(1);
    expect(rows.finance[0]).toMatchObject({ orgId: ORG, action: "ledger.late_entry.posted", actorType: "user", actorName: "Owner" });
    expect(rows.finance[0].before).toMatchObject({ netIncomeCents: -112_780, endingCashCents: 98_129 });
    expect(rows.finance[0].after).toMatchObject({ netIncomeCents: -125_280, endingCashCents: 85_629 });
    expect(rows.finance[0].detail).toContain(`entry ${out.entryId}`);
    expect(rows.access).toEqual([expect.objectContaining({ orgId: ORG, action: "ledger.late_entry.posted", resource: out.entryId, result: "allow", viewerType: "studio_member" })]);
  });

  it("attaches a receipt uploaded to R2 (a mediaFiles key, never Convex storage)", async () => {
    const { t, who, id } = await setup();
    const { mine, theirs } = await t.run(async (ctx) => {
      const media = (orgId: string) => ctx.db.insert("mediaFiles", {
        orgId, bucket: "private", key: `${orgId}/receipt/r.pdf`, purpose: "receipt", fileName: "r.pdf", mimeType: "application/pdf",
        size: 1024, status: "ready", uploadedBy: "Owner", createdAt: NOW, attachedAt: NOW,
      });
      const row = async (orgId: string) => ctx.db.insert("receipts", {
        orgId, storageId: await media(orgId), fileName: "r.pdf", fileType: "application/pdf", sizeBytes: 1024, uploadedBy: "Owner", uploadedAt: NOW, status: "ready",
      });
      return { mine: await row(ORG), theirs: await row(OTHER) };
    });
    const input = { ...S4(id("internet")), counterparty: "Vendor U2", memo: undefined, amountCents: 4_200, paidFrom: "bank" as const };
    await expect(who.owner.mutation(api.ledger.addLateEntry, { period: "2026-07", input, receiptId: theirs, confirmPastMonth: true }))
      .rejects.toThrow(/Receipt not found/);
    expect(await lateDocs(t)).toEqual([]);
    const out = await who.owner.mutation(api.ledger.addLateEntry, { period: "2026-07", input, receiptId: mine, confirmPastMonth: true });
    const doc = (await t.run((ctx) => ctx.db.get(out.entryId)))!;
    expect(doc).toMatchObject({ receiptStatus: "yes", receiptDocIds: [mine] });
    const receipt = (await t.run((ctx) => ctx.db.get(mine)))!;
    expect(await t.run(async (ctx) => ctx.db.normalizeId("mediaFiles", receipt.storageId))).not.toBeNull();
  });
});

describe("validation", () => {
  it("refuses a bad amount, a wrong category, a date outside the month, a future month, and no confirmation", async () => {
    const { who, id } = await setup();
    const add = (input: Partial<ReturnType<typeof S4>>, period = "2026-07", confirmPastMonth = true) =>
      who.owner.mutation(api.ledger.addLateEntry, { period, input: { ...S4(id("rent")), counterparty: "Vendor Q", ...input }, confirmPastMonth });
    await expect(add({ amountCents: 0 })).rejects.toThrow(/greater than zero/);
    await expect(add({ amountCents: -500 })).rejects.toThrow(/greater than zero/);
    await expect(add({ amountCents: 10.5 })).rejects.toThrow(/greater than zero/);
    await expect(add({ accountId: id("revenue_recording") })).rejects.toThrow(/not an expense account/);
    await expect(add({ accountId: id("bank_cash") })).rejects.toThrow(/not an expense account/);
    await expect(add({ entryDate: Date.UTC(2026, 7, 3) })).rejects.toThrow(/between Jul 1, 2026 and Jul 31, 2026/);
    await expect(add({ entryDate: Date.UTC(2026, 9, 5) }, "2026-10")).rejects.toThrow(/months that have ended/);
    await expect(add({ entryDate: Date.UTC(2026, 5, 20) }, "2026-06")).rejects.toThrow(/books start on Jul 1, 2026/);
    await expect(add({}, "2026-07", false)).rejects.toThrow(/Confirm that you are changing a past month/);
    // Another studio's account is not in this chart.
    const theirs = await (async () => {
      const t2 = who.otherOwner;
      await t2.mutation(api.ledger.seedChart, {});
      return (await t2.query(api.ledger.accounts, {})).find((a) => a.key === "rent")!._id;
    })();
    await expect(add({ accountId: theirs })).rejects.toThrow(/isn't in this studio's chart/);
  });

  it("refuses a July change once opening balances are fixed for a later month", async () => {
    const { t, who, id } = await setup();
    await t.run((ctx) => ctx.db.insert("openingBalances", { orgId: ORG, asOf: AUG.start, lines: [], source: "manual", createdBy: "x", createdAt: NOW }));
    await expect(who.owner.mutation(api.ledger.addLateEntry, { period: "2026-07", input: { ...S4(id("rent")), counterparty: "Vendor Q" }, confirmPastMonth: true }))
      .rejects.toThrow(/Opening balances were set for Aug 1, 2026/);
  });

  it("returns a readable preview error instead of throwing", async () => {
    const { who, id } = await setup();
    const p = await who.owner.query(api.ledger.lateEntryPreview, { period: "2026-07", input: { ...S4(id("rent")), amountCents: 0 } });
    expect(p).toEqual({ ok: false, error: "Enter an amount greater than zero." });
  });
});

describe("who may change a past month", () => {
  it("the studio owner only: a manager, an accountant, an engineer and another studio are refused", async () => {
    const { t, who, id } = await setup();
    const args = { period: "2026-07", input: { ...S4(id("rent")), counterparty: "Vendor Q" }, confirmPastMonth: true };
    await expect(who.manager.mutation(api.ledger.addLateEntry, args)).rejects.toThrow(/Only the studio owner can change a past month/);
    await expect(who.accountant.mutation(api.ledger.addLateEntry, args)).rejects.toThrow(/Only the studio owner/);
    await expect(who.engineer.mutation(api.ledger.addLateEntry, args)).rejects.toThrow(/insights.read/);
    await expect(who.otherOwner.mutation(api.ledger.addLateEntry, args)).rejects.toThrow(/isn't in this studio's chart/);
    expect(await lateDocs(t)).toEqual([]);
    expect((await who.owner.query(api.ledger.lateEntryAccess, {})).canAdd).toBe(true);
    expect((await who.manager.query(api.ledger.lateEntryAccess, {})).canAdd).toBe(false);
    expect((await who.engineer.query(api.ledger.lateEntryAccess, {})).canAdd).toBe(false);
  });
});

describe("reversal: no deletes", () => {
  it("cancels a late entry with a linked reversing entry and returns July to the exact prior totals", async () => {
    const { t, who, id } = await setup();
    const was = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    const out = await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", input: { ...S4(id("rent")), counterparty: "Landlord B", amountCents: 12_500, paidFrom: "bank" }, confirmPastMonth: true,
    });
    await expect(who.owner.mutation(api.ledger.voidEntry, { id: out.entryId, reason: "oops" })).rejects.toThrow(/Reverse a late entry instead/);
    await expect(who.manager.mutation(api.ledger.reverseLateEntry, { id: out.entryId, reason: "oops", confirmPastMonth: true })).rejects.toThrow(/Only the studio owner/);
    await expect(who.owner.mutation(api.ledger.reverseLateEntry, { id: out.entryId, reason: "  ", confirmPastMonth: true })).rejects.toThrow(/Say why/);

    const rev = await who.owner.mutation(api.ledger.reverseLateEntry, { id: out.entryId, reason: "Entered twice", confirmPastMonth: true });
    expect(rev.before.netIncomeCents).toBe(-125_280);
    expect(rev.after.netIncomeCents).toBe(-112_780);

    const now = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    for (const k of ["incomeStatement", "balanceSheet", "cashFlow"] as const) {
      const nonzero = (s: typeof was) => s.recomputed[k].lines.filter((l) => l.cents !== 0).map((l) => [l.key, l.cents]);
      expect(nonzero(now)).toEqual(nonzero(was));
    }
    expect(now.variances).toEqual(was.variances);
    expect(now.lateEntries).toMatchObject({ count: 2, lines: [] });
    expect(now.checks.find((c) => c.code === "late_entries")!.status).toBe("pass");

    // Both entries stay, linked both ways; nothing was deleted or voided.
    const docs = await lateDocs(t);
    expect(docs).toHaveLength(2);
    const original = docs.find((d) => d._id === out.entryId)!;
    const reversal = docs.find((d) => d._id === rev.entryId)!;
    expect(original).toMatchObject({ status: "posted", reversedBy: rev.entryId, reversedAt: NOW });
    expect(reversal).toMatchObject({ status: "posted", reversalOf: out.entryId, reason: "Entered twice", entryDate: original.entryDate, memo: "Reversal of late entry: Landlord B - podcast distribution subscription" });
    expect(reversal.lines).toEqual(original.lines.map((l: Doc<"journalEntries">["lines"][number]) => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents })));
    expect(await t.run(async (ctx) => (await ctx.db.query("journalEntries").collect()).length)).toBe(50);

    await expect(who.owner.mutation(api.ledger.reverseLateEntry, { id: out.entryId, reason: "again", confirmPastMonth: true })).rejects.toThrow(/already reversed/);
    await expect(who.owner.mutation(api.ledger.reverseLateEntry, { id: rev.entryId, reason: "again", confirmPastMonth: true })).rejects.toThrow(/itself a reversal/);
    const imported = await t.run(async (ctx) => (await ctx.db.query("journalEntries").collect()).find((e) => !e.lateEntry)!._id);
    await expect(who.owner.mutation(api.ledger.reverseLateEntry, { id: imported, reason: "x", confirmPastMonth: true })).rejects.toThrow(/Only a late entry/);

    const audit = await t.run(async (ctx) => (await ctx.db.query("financeAudit").collect()).map((r) => r.action).filter((a) => a.startsWith("ledger.late")));
    expect(audit).toEqual(["ledger.late_entry.posted", "ledger.late_entry.reversed"]);
  });
});

describe("roll-forward into August", () => {
  async function august(who: Awaited<ReturnType<typeof setup>>["who"], id: (k: string) => Id<"ledgerAccounts">) {
    await who.owner.mutation(api.ledger.addEntry, {
      entryDate: Date.UTC(2026, 7, 3), memo: "August rent", status: "posted",
      lines: [{ accountId: id("rent"), debitCents: 150_000, creditCents: 0 }, { accountId: id("bank_cash"), debitCents: 0, creditCents: 150_000 }],
    });
    await who.owner.mutation(api.ledger.addEntry, {
      entryDate: Date.UTC(2026, 7, 9), memo: "Client A session", status: "posted",
      lines: [{ accountId: id("bank_cash"), debitCents: 20_000, creditCents: 0 }, { accountId: id("revenue_recording"), debitCents: 0, creditCents: 20_000 }],
    });
  }

  it("a late July expense paid from the bank moves August's opening cash and retained earnings by exactly 19.00", async () => {
    const { who, id } = await setup();
    await august(who, id);
    const was = await who.owner.query(api.ledger.statements, { period: "2026-08" });
    await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", input: { ...S4(id("internet")), counterparty: "Vendor U2", amountCents: 1_900, paidFrom: "bank" }, confirmPastMonth: true,
    });
    const now = await who.owner.query(api.ledger.statements, { period: "2026-08" });
    expect(now.recomputed.cashFlow.beginningCashCents - was.recomputed.cashFlow.beginningCashCents).toBe(-1_900);
    expect(now.recomputed.cashFlow.endingCashCents - was.recomputed.cashFlow.endingCashCents).toBe(-1_900);
    expect(now.recomputed.balanceSheet.retainedEarnings.totalCents - was.recomputed.balanceSheet.retainedEarnings.totalCents).toBe(-1_900);
    expect(now.recomputed.balanceSheet.retainedEarnings.priorUnclosedIncomeCents - was.recomputed.balanceSheet.retainedEarnings.priorUnclosedIncomeCents).toBe(-1_900);
    // August's own month is unchanged: the expense belongs to July.
    expect(now.recomputed.incomeStatement).toEqual(was.recomputed.incomeStatement);
    expect(now.recomputed.cashFlow.netChangeCents).toBe(was.recomputed.cashFlow.netChangeCents);
    expect(now.recomputed.balanceSheet.balanced).toBe(true);
    // August shows the change through its opening, labelled as a late entry from July.
    expect(now.lateEntries!.entries[0]).toMatchObject({ inPeriod: false, cashEffectCents: -1_900, netIncomeEffectCents: 0 });
    expect(now.lateEntries!.lines.find((l) => l.key === "beginning_cash")!.lateEntryCents).toBe(-1_900);
  });

  it("on a card: August cash holds, the card payable carries 19.00 more, retained earnings 19.00 less", async () => {
    const { who, id } = await setup();
    await august(who, id);
    const was = await who.owner.query(api.ledger.statements, { period: "2026-08" });
    await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", input: { ...S4(id("internet")), counterparty: "Vendor U2" }, confirmPastMonth: true,
    });
    const now = await who.owner.query(api.ledger.statements, { period: "2026-08" });
    const cc = (s: typeof was) => s.recomputed.balanceSheet.lines.find((l) => l.key === "liability.credit_card_payable")!.cents;
    expect(now.recomputed.cashFlow.beginningCashCents).toBe(was.recomputed.cashFlow.beginningCashCents);
    expect(cc(now) - cc(was)).toBe(1_900);
    expect(now.recomputed.balanceSheet.retainedEarnings.totalCents - was.recomputed.balanceSheet.retainedEarnings.totalCents).toBe(-1_900);
  });

  it("re-importing July keeps the opening balances instead of absorbing the late entry", async () => {
    const { t, who, id } = await setup();
    await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", input: { ...S4(id("internet")), counterparty: "Vendor U2", paidFrom: "bank" }, confirmPastMonth: true,
    });
    const openingBefore = await t.run(async (ctx) => (await ctx.db.query("openingBalances").collect()));
    const res = await t.mutation(internal.ledger.importBooksInternal, { orgId: ORG, plan: plan(), bank: [BANK], seedOpening: "implied" });
    expect(res).toMatchObject({ entriesCreated: 0, opening: "kept" });
    expect(await t.run(async (ctx) => (await ctx.db.query("openingBalances").collect()))).toEqual(openingBefore);
    const s = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    expect(s.recomputed.incomeStatement.totalExpensesCents).toBe(245_180);
    // The same workbook re-imported keeps when it was reported, so the late
    // entry is still a change since reported, not part of the checked books.
    expect(s.reported!.importedAt).toBe(Date.UTC(2026, 7, 5, 12));
    expect(s.lateEntries).toMatchObject({ count: 1, since: Date.UTC(2026, 7, 5, 12) });
  });
});

describe("the Accounting agent suggests, a person posts", () => {
  async function withReceipt(t: T) {
    return await t.run(async (ctx) => {
      const mediaId = await ctx.db.insert("mediaFiles", {
        orgId: ORG, bucket: "private", key: `${ORG}/receipt/z.pdf`, purpose: "receipt", fileName: "z.pdf", mimeType: "application/pdf",
        size: 900, status: "ready", uploadedBy: "Owner", createdAt: NOW, attachedAt: NOW,
      });
      return await ctx.db.insert("receipts", {
        orgId: ORG, storageId: mediaId, fileName: "z.pdf", fileType: "application/pdf", sizeBytes: 900, uploadedBy: "Owner", uploadedAt: NOW,
        status: "ready", vendor: "Vendor S3", date: Date.UTC(2026, 6, 12), totalCents: 4_200,
      });
    });
  }
  const lateProposals = (t: T): Promise<Doc<"opsActions">[]> =>
    t.run(async (ctx) => (await ctx.db.query("opsActions").collect()).filter((r) => r.type === "acct_late_entry"));

  it("a receipt with no entry in an ended month becomes a pre-filled suggestion, never posted on its own, even at auto_trusted", async () => {
    const { t, who } = await setup();
    const receiptId = await withReceipt(t);
    await t.run((ctx) => ctx.db.insert("agentPolicies", { orgId: ORG, enabled: true, defaultTone: "professional", autonomy: "auto_trusted", digestEnabled: true, digestHourLocal: 8, updatedAt: NOW }));
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG, period: "2026-07" });
    const [p] = await lateProposals(t);
    expect(p).toMatchObject({ status: "proposed", autonomy: false, title: "Missed expense in July 2026: Vendor S3 ($42.00)" });
    expect(p.payload).toMatchObject({
      kind: "late_entry", period: "2026-07", lateKind: "expense", entryDate: Date.UTC(2026, 6, 12), counterparty: "Vendor S3",
      amountCents: 4_200, accountKey: "software", receiptId, reason: "Missed invoice/receipt",
    });
    expect(await lateDocs(t)).toEqual([]);
    // The Books screen lists it for review.
    expect((await who.owner.query(api.ledger.lateEntrySuggestions, { period: "2026-07" })).map((s) => s._id)).toEqual([p._id]);
  });

  it("approval runs the same path: the owner approves, the entry posts as late with the receipt; a manager cannot", async () => {
    const { t, who, id } = await setup();
    const receiptId = await withReceipt(t);
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG, period: "2026-07" });
    const [p] = await lateProposals(t);
    // The receipt carried no card, so how it was paid is the owner's to choose.
    expect(p.payload.kind === "late_entry" && p.payload.paidFrom).toBeFalsy();
    await expect(who.owner.mutation(api.accountingAgent.approve, { id: p._id })).rejects.toThrow(/Open Books to choose/);

    // From Books: the owner reviews the suggestion, picks "bank", adds it.
    await expect(who.manager.mutation(api.ledger.addLateEntry, {
      period: "2026-07", proposalId: p._id, receiptId, confirmPastMonth: true,
      input: { kind: "expense", entryDate: Date.UTC(2026, 6, 12), counterparty: "Vendor S3", amountCents: 4_200, accountId: id("software"), paidFrom: "bank" },
    })).rejects.toThrow(/Only the studio owner/);
    const out = await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", proposalId: p._id, receiptId, confirmPastMonth: true,
      input: { kind: "expense", entryDate: Date.UTC(2026, 6, 12), counterparty: "Vendor S3", amountCents: 4_200, accountId: id("software"), paidFrom: "bank" },
    });
    const doc = (await t.run((ctx) => ctx.db.get(out.entryId)))!;
    expect(doc).toMatchObject({ lateEntry: true, source: "agent", receiptDocIds: [receiptId], receiptStatus: "yes", status: "posted" });
    expect((await t.run((ctx) => ctx.db.get(p._id)))!).toMatchObject({ status: "executed", decidedBy: "Owner" });
  });

  it("approving a complete suggestion in the inbox posts it as a late entry", async () => {
    const { t, who } = await setup();
    await withReceipt(t);
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG, period: "2026-07" });
    const [p] = await lateProposals(t);
    await t.run((ctx) => ctx.db.patch(p._id, { payload: { ...(p.payload as Extract<Doc<"opsActions">["payload"], { kind: "late_entry" }>), paidFrom: "bank" } }));
    await expect(who.manager.mutation(api.accountingAgent.approve, { id: p._id })).rejects.toThrow(/Only the studio owner/);
    await who.owner.mutation(api.accountingAgent.approve, { id: p._id });
    const [doc] = await lateDocs(t);
    expect(doc).toMatchObject({ lateEntry: true, source: "agent", totalCents: 4_200, counterparty: "Vendor S3", status: "posted" });
    expect((await t.run((ctx) => ctx.db.get(p._id)))!).toMatchObject({ status: "executed", result: "Added to July 2026 as a late entry. Net income -$1,127.80 to -$1,169.80." });
  });

  it("notes the change on a month that was already reported", async () => {
    const { t, who, id } = await setup();
    await who.owner.mutation(api.ledger.addLateEntry, {
      period: "2026-07", input: { ...S4(id("internet")), counterparty: "Vendor U2", paidFrom: "bank" }, confirmPastMonth: true,
    });
    // The late entry asked for a rescan of July.
    const names = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((f) => f.name));
    expect(names).toContain("accountingAgent:scanOrg");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const insights = await t.run(async (ctx) => (await ctx.db.query("agentInsights").collect()).filter((i) => i.orgId === ORG && i.title === "Late entries: July 2026"));
    expect(insights).toHaveLength(1);
    expect(insights[0].explanation).toContain("July 2026 net income moved from -$1,127.80 to -$1,146.80 after 1 late entry.");
    expect(insights[0].explanation).toContain("- Vendor U2 - podcast distribution subscription, $19.00, entered Oct 9");
    expect(insights[0].explanation).not.toMatch(/[–—]/);
  });
});
