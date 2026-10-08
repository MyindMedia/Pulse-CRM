import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import * as XLSX from "xlsx";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { gridFromSheetJs, parseBooksWorkbook, planToImportArgs } from "./lib/booksImport";
import { parsePeriod } from "./lib/ledgerMath";
import { booksFixtureWorkbook } from "./ledgerBooks.fixture";

/* End to end: an anonymized workbook, written to real .xlsx bytes and read
   back the way scripts/import-books.mjs reads one, through the import
   mutation, out of ledger.statements. openspec ledger-books-statements. */

const JULY = parsePeriod("2026-07");
const ORG = "org_books";
const OTHER = "org_other";
const BANK = {
  accountLabel: "Checking A",
  periodStart: JULY.start,
  periodEnd: JULY.end,
  beginningCents: 168_750,
  endingCents: 161_129,
  depositsCents: 244_500,
  withdrawalsCents: 250_521,
  feesCents: 1_600,
};

function planFromXlsxBytes() {
  const wb = booksFixtureWorkbook(XLSX as never) as XLSX.WorkBook;
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const read = XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: false, cellNF: true });
  return parseBooksWorkbook(gridFromSheetJs(read as never, XLSX as never), { period: "2026-07" });
}

async function studio(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    for (const orgId of [ORG, OTHER]) {
      await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "growth", status: "active" });
    }
    await ctx.db.insert("orgs", { orgId: "org_nomoney", name: "nm", slug: "nm", tier: "growth", status: "active", managersSeeMoney: false });
    const m = (orgId: string, clerkUserId: string, role: "owner" | "manager" | "engineer" | "accountant") =>
      ctx.db.insert("members", { orgId, name: clerkUserId, role, skills: [], clerkUserId });
    await m(ORG, "u_owner", "owner");
    await m(ORG, "u_manager", "manager");
    await m(ORG, "u_engineer", "engineer");
    await m(ORG, "u_accountant", "accountant");
    await m(OTHER, "u_other_owner", "owner");
    await m("org_nomoney", "u_nm_manager", "manager");
  });
  return {
    owner: t.withIdentity({ subject: "u_owner", orgId: ORG, name: "Owner" }),
    manager: t.withIdentity({ subject: "u_manager", orgId: ORG }),
    engineer: t.withIdentity({ subject: "u_engineer", orgId: ORG }),
    accountant: t.withIdentity({ subject: "u_accountant", orgId: ORG }),
    otherOwner: t.withIdentity({ subject: "u_other_owner", orgId: OTHER }),
    noMoneyManager: t.withIdentity({ subject: "u_nm_manager", orgId: "org_nomoney" }),
  };
}

async function importFixture(t: ReturnType<typeof convexTest>) {
  const plan = planFromXlsxBytes();
  return await t.mutation(internal.ledger.importBooksInternal, {
    orgId: ORG, plan: planToImportArgs(plan), bank: [BANK], seedOpening: "implied",
  });
}

describe("books import, end to end", () => {
  it("reads the .xlsx exactly like the grid builder (dates, text date, formulas)", () => {
    const plan = planFromXlsxBytes();
    expect(plan.stats).toEqual({ lines: 96, entries: 48, totalDebitCents: 588_080, totalCreditCents: 588_080 });
    expect(plan.warnings.find((w) => w.code === "text_date_normalized")?.row).toBe(77);
    expect(plan.reported.incomeStatement.find((l) => l.key === "total_expenses")).toMatchObject({ cents: 241_380, formula: "=SUM(E14:E25)" });
  });

  it("imports the workbook and returns reported, recomputed, variances and checks", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    const result = await importFixture(t);
    expect(result).toMatchObject({ entriesCreated: 48, entriesSkipped: 0, accountsCreated: 30, bankUpserted: 1, opening: "created", period: "2026-07" });

    const s = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    const is = s.recomputed.incomeStatement;
    expect(is.totalRevenueCents).toBe(130_500);
    expect(is.totalExpensesCents).toBe(243_280);
    expect(is.netIncomeCents).toBe(-112_780);
    expect(is.expenses.find((l) => l.key === "expense.software_subscriptions")?.cents).toBe(7_299);

    // Income statement variances: exactly software +19.00, and the totals it moves.
    expect(s.variances!.incomeStatement.filter((x) => x.kind === "line").map((x) => [x.key, x.varianceCents]))
      .toEqual([["expense.software_subscriptions", 1_900]]);
    expect(s.variances!.incomeStatement.find((x) => x.key === "net_income")).toMatchObject({ reportedCents: -110_880, recomputedCents: -112_780, varianceCents: -1_900 });
    expect(s.variances!.incomeStatement.find((x) => x.key === "total_expenses")?.varianceCents).toBe(1_900);

    // Cash: the journal moved -706.21, the bank -76.21, flagged at 630.00.
    const bank = s.checks.find((c) => c.code === "cash_vs_bank")!;
    expect(bank.status).toBe("fail");
    expect(bank.amountCents).toBe(-63_000);
    expect(bank.detail).toMatchObject({ ledgerNetChangeCents: -70_621, bankNetChangeCents: -7_621, netChangeVarianceCents: -63_000, endingVarianceCents: -63_000, bankArithmeticDiffCents: 0 });
    expect(s.recomputed.cashFlow.netChangeCents).toBe(-70_621);
    expect(s.checks.find((c) => c.code === "cash_flow_ties")?.status).toBe("pass");
    expect(s.checks.find((c) => c.code === "balance_sheet_balances")?.status).toBe("pass");

    // The beginning cash label warning reaches the checks.
    const label = s.checks.find((c) => c.code === "reported_statement_warnings")!;
    expect(label.status).toBe("warn");
    expect((label.detail as { code: string }[]).map((w) => w.code)).toContain("beginning_cash_label_date");
    expect(label.message).toMatch(/May 1, 2026.*July 1, 2026/);

    // Reported values exactly as the workbook had them.
    const rep = s.reported!;
    const get = (ls: { key: string; cents: number }[], k: string) => ls.find((l) => l.key === k)?.cents;
    expect(rep.entityName).toBe("Studio Entity LLC");
    expect(get(rep.incomeStatement, "revenue.recording_session")).toBe(117_500);
    expect(get(rep.incomeStatement, "revenue.podcast_studio")).toBe(8_000);
    expect(get(rep.incomeStatement, "revenue.other_audio_services")).toBe(5_000);
    expect(get(rep.incomeStatement, "expense.rent")).toBe(150_000);
    expect(get(rep.incomeStatement, "expense.credit_card_interest_fees")).toBe(44_544);
    expect(get(rep.incomeStatement, "expense.advertising_promotion")).toBe(17_316);
    expect(get(rep.incomeStatement, "expense.insurance")).toBe(9_236);
    expect(get(rep.incomeStatement, "expense.internet")).toBe(7_500);
    expect(get(rep.incomeStatement, "expense.merchant_processing")).toBe(5_785);
    expect(get(rep.incomeStatement, "expense.software_subscriptions")).toBe(5_399);
    expect(get(rep.incomeStatement, "expense.bank_service_charges")).toBe(1_600);
    expect(get(rep.incomeStatement, "total_expenses")).toBe(241_380);
    expect(get(rep.incomeStatement, "net_income")).toBe(-110_880);
    expect(get(rep.balanceSheet, "asset.cash")).toBe(161_129);
    expect(get(rep.balanceSheet, "asset.business_funds_held_by_owner")).toBe(0);
    expect(get(rep.balanceSheet, "asset.deposits_in_transit")).toBe(0);
    expect(get(rep.balanceSheet, "asset.security_deposit")).toBe(150_000);
    expect(get(rep.balanceSheet, "asset.studio_equipment")).toBe(2_380_953);
    expect(get(rep.balanceSheet, "asset.furniture_fixtures")).toBe(134_968);
    expect(get(rep.balanceSheet, "asset.security_equipment")).toBe(80_306);
    expect(get(rep.balanceSheet, "asset.prepaid_professional_services")).toBe(3_500);
    expect(get(rep.balanceSheet, "total_assets")).toBe(2_910_856);
    expect(get(rep.balanceSheet, "liability.credit_card_payable")).toBe(3_500_581);
    expect(get(rep.balanceSheet, "liability.partner_investment_deposits")).toBe(75_000);
    expect(get(rep.balanceSheet, "liability.installment_payable")).toBe(73_779);
    expect(get(rep.balanceSheet, "liability.unearned_revenue")).toBe(20_000);
    expect(get(rep.balanceSheet, "total_liabilities")).toBe(3_669_360);
    expect(get(rep.balanceSheet, "equity.owner_contributions")).toBe(2_817_755);
    expect(get(rep.balanceSheet, "equity.retained_earnings")).toBe(-3_576_259);
    expect(get(rep.balanceSheet, "total_equity")).toBe(-758_504);
    expect(get(rep.cashFlow, "operating.customer_receipts")).toBe(158_600);
    expect(get(rep.cashFlow, "net_operating")).toBe(-22_721);
    expect(get(rep.cashFlow, "financing.owner_contributions")).toBe(56_800);
    expect(get(rep.cashFlow, "financing.partner_deposits")).toBe(25_000);
    expect(get(rep.cashFlow, "financing.owner_reimbursement")).toBe(4_100);
    expect(get(rep.cashFlow, "financing.credit_card_payments")).toBe(-70_800);
    expect(get(rep.cashFlow, "net_financing")).toBe(15_100);
    expect(get(rep.cashFlow, "net_investing")).toBe(0);
    expect(get(rep.cashFlow, "net_change")).toBe(-7_621);
    expect(get(rep.cashFlow, "beginning_cash")).toBe(168_750);
    expect(get(rep.cashFlow, "ending_cash")).toBe(161_129);
    expect(s.opening).toMatchObject({ asOf: JULY.start, source: "implied_from_reported_close" });

    // The bank reconciliation view says the same thing.
    const br = await who.owner.query(api.ledger.bankReconciliation, { period: "2026-07" });
    expect(br.rows).toHaveLength(1);
    expect(br.rows[0]).toMatchObject({ ledgerEndingCents: 98_129, bankEndingCents: 161_129, unclearedClearingTotalCents: 70_500, unexplainedCents: 7_500 });

    // Periods and the paginated, filtered journal.
    expect(await who.owner.query(api.ledger.periods, {})).toEqual([{ period: "2026-07", hasReported: true, hasBank: true, hasEntries: true }]);
    const all = await who.owner.query(api.ledger.journal, { period: "2026-07", paginationOpts: { numItems: 100, cursor: null } });
    expect(all.page).toHaveLength(48);
    const noReceipt = await who.owner.query(api.ledger.journal, { period: "2026-07", filter: { receiptStatus: "no" }, paginationOpts: { numItems: 100, cursor: null } });
    expect(noReceipt.page.map((e) => e.sourceRef).sort()).toEqual(["July Journal!A3:H4", "July Journal!A67:H68"]);
    const card = await who.owner.query(api.ledger.journal, { filter: { paymentKind: "credit_card" }, paginationOpts: { numItems: 100, cursor: null } });
    expect(card.page).toHaveLength(6);
    const accounts = await who.owner.query(api.ledger.accounts, {});
    const software = accounts.find((a) => a.key === "software")!;
    const softwareEntries = await who.owner.query(api.ledger.journal, { filter: { accountId: software._id }, paginationOpts: { numItems: 100, cursor: null } });
    expect(softwareEntries.page.reduce((s2, e) => s2 + e.totalCents, 0)).toBe(7_299);
    const text = await who.owner.query(api.ledger.journal, { filter: { text: "podcast studio" }, paginationOpts: { numItems: 100, cursor: null } });
    expect(text.page).toHaveLength(1);
  });

  it("re-importing the same workbook creates no duplicates", async () => {
    const t = convexTest(schema);
    await studio(t);
    await importFixture(t);
    const again = await importFixture(t);
    expect(again).toMatchObject({ entriesCreated: 0, entriesSkipped: 48, accountsCreated: 0, opening: "replaced" });
    const counts = await t.run(async (ctx) => ({
      entries: (await ctx.db.query("journalEntries").collect()).length,
      accounts: (await ctx.db.query("ledgerAccounts").collect()).length,
      reported: (await ctx.db.query("reportedStatements").collect()).length,
      opening: (await ctx.db.query("openingBalances").collect()).length,
      bank: (await ctx.db.query("bankStatementBalances").collect()).length,
    }));
    expect(counts).toEqual({ entries: 48, accounts: 30, reported: 1, opening: 1, bank: 1 });
  });
});

describe("ledger access", () => {
  it("keeps one studio's books from another studio", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    await importFixture(t);
    const theirs = await who.otherOwner.query(api.ledger.statements, { period: "2026-07" });
    expect(theirs.reported).toBeNull();
    expect(theirs.recomputed.incomeStatement.totalRevenueCents).toBe(0);
    const page = await who.otherOwner.query(api.ledger.journal, { paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page).toHaveLength(0);

    const entryId = await t.run(async (ctx) => (await ctx.db.query("journalEntries").first())!._id);
    await expect(who.otherOwner.mutation(api.ledger.voidEntry, { id: entryId, reason: "not mine" })).rejects.toThrow(/not found/i);
    const accountId = await t.run(async (ctx) => (await ctx.db.query("ledgerAccounts").first())!._id);
    await expect(who.otherOwner.mutation(api.ledger.addEntry, {
      entryDate: JULY.start, memo: "x", status: "posted",
      lines: [{ accountId, debitCents: 100, creditCents: 0 }, { accountId, debitCents: 0, creditCents: 100 }],
    })).rejects.toThrow(/isn't in this studio/);
  });

  it("denies roles that never see money, and managers when the owner turned money off", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    await importFixture(t);
    await expect(who.engineer.query(api.ledger.statements, { period: "2026-07" })).rejects.toThrow(/insights.read/);
    await expect(who.engineer.query(api.ledger.accounts, {})).rejects.toThrow(/insights.read/);
    await expect(who.noMoneyManager.query(api.ledger.periods, {})).rejects.toThrow(/insights.read/);
    // A manager with money reads; an accountant reads but cannot write.
    expect((await who.manager.query(api.ledger.statements, { period: "2026-07" })).reported).not.toBeNull();
    expect((await who.accountant.query(api.ledger.statements, { period: "2026-07" })).reported).not.toBeNull();
    await expect(who.accountant.mutation(api.ledger.seedChart, {})).rejects.toThrow(/owner or manager/);
    await expect(who.engineer.mutation(api.ledger.seedChart, {})).rejects.toThrow(/insights.read/);
  });
});

describe("ledger writes", () => {
  it("adds, posts and voids entries; refuses an unbalanced one", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    await who.owner.mutation(api.ledger.seedChart, {});
    const accounts = await who.manager.query(api.ledger.accounts, {});
    const id = (key: string) => accounts.find((a) => a.key === key)!._id;
    await expect(who.manager.mutation(api.ledger.addEntry, {
      entryDate: Date.UTC(2026, 6, 3, 15), memo: "Rent", status: "posted",
      lines: [{ accountId: id("rent"), debitCents: 150_000, creditCents: 0 }, { accountId: id("bank_cash"), debitCents: 0, creditCents: 149_999 }],
    })).rejects.toThrow(/must equal/);
    const draft = await who.manager.mutation(api.ledger.addEntry, {
      entryDate: Date.UTC(2026, 6, 3, 15), memo: "Rent", status: "draft",
      lines: [{ accountId: id("rent"), debitCents: 150_000, creditCents: 0 }, { accountId: id("bank_cash"), debitCents: 0, creditCents: 150_000 }],
    });
    let s = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    expect(s.recomputed.incomeStatement.totalExpensesCents).toBe(0);
    await who.owner.mutation(api.ledger.postEntry, { id: draft });
    s = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    expect(s.recomputed.incomeStatement.totalExpensesCents).toBe(150_000);
    const row = await t.run((ctx) => ctx.db.get(draft));
    expect(row?.entryDate).toBe(Date.UTC(2026, 6, 3));
    await who.owner.mutation(api.ledger.voidEntry, { id: draft, reason: "entered twice" });
    s = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    expect(s.recomputed.incomeStatement.totalExpensesCents).toBe(0);
    await expect(who.owner.mutation(api.ledger.voidEntry, { id: draft, reason: "again" })).rejects.toThrow(/already void/);
  });

  it("links a receipt from the same studio only", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    await importFixture(t);
    const { entryId, mine, theirs } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["r"], { type: "image/png" }));
      const base = { storageId, fileName: "r.png", fileType: "image/png", sizeBytes: 1, uploadedBy: "t", uploadedAt: 1, status: "ready" as const };
      const mineId = await ctx.db.insert("receipts", { orgId: ORG, ...base });
      const theirsId = await ctx.db.insert("receipts", { orgId: OTHER, ...base });
      const e = (await ctx.db.query("journalEntries").collect()).find((x) => x.receiptStatus === "no")!;
      return { entryId: e._id, mine: mineId, theirs: theirsId };
    });
    await expect(who.owner.mutation(api.ledger.linkReceipt, { entryId, receiptId: theirs })).rejects.toThrow(/Receipt not found/);
    expect(await who.owner.mutation(api.ledger.linkReceipt, { entryId, receiptId: mine })).toEqual({ receiptDocIds: [mine] });
    const e = await t.run((ctx) => ctx.db.get(entryId));
    expect(e?.receiptStatus).toBe("yes");
  });

  it("posts an existing expense once, explicitly", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    const { rent, gear } = await t.run(async (ctx) => ({
      rent: await ctx.db.insert("expenses", { orgId: ORG, category: "rent", amountCents: 150_000, date: Date.UTC(2026, 6, 2, 9), vendor: "Landlord A" }),
      gear: await ctx.db.insert("expenses", { orgId: ORG, category: "gear", amountCents: 9_900, date: Date.UTC(2026, 6, 2) }),
    }));
    const first = await who.owner.mutation(api.ledger.postFromExpense, { expenseId: rent });
    expect(first.created).toBe(true);
    const second = await who.owner.mutation(api.ledger.postFromExpense, { expenseId: rent });
    expect(second).toEqual({ entryId: first.entryId, created: false });
    await expect(who.owner.mutation(api.ledger.postFromExpense, { expenseId: gear })).rejects.toThrow(/Choose the ledger account/);
    const entry = await t.run((ctx) => ctx.db.get(first.entryId as Id<"journalEntries">));
    expect(entry).toMatchObject({ source: "expense", sourceRef: `expense:${rent}`, totalCents: 150_000, entryDate: Date.UTC(2026, 6, 2), status: "posted" });
    const s = await who.owner.query(api.ledger.statements, { period: "2026-07" });
    expect(s.recomputed.incomeStatement.expenses.find((l) => l.key === "expense.rent")?.cents).toBe(150_000);
    expect(s.recomputed.cashFlow.netChangeCents).toBe(-150_000);
  });
});
