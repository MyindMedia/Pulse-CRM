import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import * as XLSX from "xlsx";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { gridFromSheetJs, parseBooksWorkbook, planToImportArgs } from "./lib/booksImport";
import { parsePeriod } from "./lib/ledgerMath";
import { booksFixtureWorkbook } from "./ledgerBooks.fixture";
import { ACCOUNTING_ACTION_TYPES } from "./lib/agentScope";

/* End to end on the anonymized July books (convex/ledgerBooks.fixture.ts):
   import -> accounting scan -> the proposals -> approve -> the books move.
   No model is ever called: the enrichment only schedules when an OpenAI key
   exists, and none does here. */

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

type T = ReturnType<typeof convexTest>;

// Never reach a model from a test, whatever the host environment holds
// (gotcha: host env leaks into the suite).
beforeEach(() => { vi.stubEnv("OPENAI_API_KEY", ""); });
afterEach(() => { vi.unstubAllEnvs(); });

function plan() {
  const wb = booksFixtureWorkbook(XLSX as never) as XLSX.WorkBook;
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const read = XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: false, cellNF: true });
  return planToImportArgs(parseBooksWorkbook(gridFromSheetJs(read as never, XLSX as never), { period: "2026-07" }));
}

async function studio(t: T) {
  await t.run(async (ctx) => {
    for (const orgId of [ORG, OTHER]) await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "growth", status: "active" });
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

async function importJuly(t: T, orgId = ORG) {
  await t.mutation(internal.ledger.importBooksInternal, { orgId, plan: plan(), bank: [BANK], seedOpening: "implied" });
}

async function setup() {
  const t = convexTest(schema);
  const who = await studio(t);
  await importJuly(t);
  return { t, who };
}

const actions = (t: T, orgId = ORG): Promise<Doc<"opsActions">[]> =>
  t.run(async (ctx) => (await ctx.db.query("opsActions").collect()).filter((r) => r.orgId === orgId && (ACCOUNTING_ACTION_TYPES as readonly string[]).includes(r.type)));
const entries = (t: T, orgId = ORG): Promise<Doc<"journalEntries">[]> => t.run(async (ctx) => (await ctx.db.query("journalEntries").collect()).filter((e) => e.orgId === orgId));
const byType = (rows: Doc<"opsActions">[], type: string) => rows.filter((r) => r.type === type);

async function bankCheck(who: Awaited<ReturnType<typeof studio>>) {
  const s = await who.owner.query(api.ledger.statements, { period: "2026-07" });
  const c = s.checks.find((x) => x.code === "cash_vs_bank")!;
  return { check: c, detail: c.detail as { ledgerEndingCents: number; endingVarianceCents: number; unclearedClearingTotalCents: number; unexplainedCents: number }, statements: s };
}

describe("accounting scan on the July books", () => {
  it("proposes exactly what the books call for, as drafts and flags, and changes nothing", async () => {
    const { t, who } = await setup();
    const before = await bankCheck(who);
    expect(before.check.amountCents).toBe(-63_000);
    const postedBefore = (await entries(t)).filter((e) => e.status === "posted").length;
    expect(postedBefore).toBe(48);

    const res = await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(res).toMatchObject({ periods: ["2026-07"], proposed: 13, autoLinked: 0 });

    const rows = await actions(t);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
    expect(counts).toEqual({
      acct_clearing_draft: 2,
      acct_cash_draw_reclass: 1,
      acct_fee_split: 3,
      acct_receipt_missing: 2,
      acct_unexplained_cash: 1,
      acct_categorize: 3,
      acct_anomaly: 1,
    });
    expect(rows.every((r) => r.status === "proposed" && r.source === "rule" && r.autonomy === false)).toBe(true);

    // Clearing drafts: 455.00 and 250.00 into Bank / Cash.
    const clearing = byType(rows, "acct_clearing_draft").sort((a, b) => a.title.localeCompare(b.title));
    expect(clearing.map((r) => r.title)).toEqual([
      "Move $250.00 from Business Funds Held by Owner into Bank / Cash",
      "Move $455.00 from Deposits In Transit into Bank / Cash",
    ]);
    const payloads = clearing.map((r) => r.payload as Extract<Doc<"opsActions">["payload"], { kind: "ledger_draft" }>);
    expect(payloads.map((p) => p.cashEffectCents)).toEqual([25_000, 45_500]);
    expect(payloads[1].evidence.join(" ")).toContain("$981.29");
    expect(payloads[1].evidence.join(" ")).toContain("$1,611.29");

    // The 41.00 cash owner draw comes off Bank / Cash.
    const reclass = byType(rows, "acct_cash_draw_reclass")[0];
    expect(reclass.title).toBe("Take the $41.00 cash owner draw off Bank / Cash");
    expect((reclass.payload as { cashEffectCents: number }).cashEffectCents).toBe(4_100);

    // Three processor deposits: 25.00 less 1.00 = 24.00.
    expect(byType(rows, "acct_fee_split").map((r) => r.title.replace(/ \(.*\)$/, ""))).toEqual([
      "Processor deposit: $25.00 less $1.00 fee = $24.00",
      "Processor deposit: $25.00 less $1.00 fee = $24.00",
      "Processor deposit: $25.00 less $1.00 fee = $24.00",
    ]);

    // The two entries marked No receipt, and 75.00 left unexplained.
    const missing = byType(rows, "acct_receipt_missing");
    const missingEntries = await t.run(async (ctx) =>
      Promise.all(missing.map(async (r) => (await ctx.db.get((r.payload as { entryIds: Id<"journalEntries">[] }).entryIds[0]))!.sourceRef)),
    );
    expect(missingEntries.sort()).toEqual(["July Journal!A3:H4", "July Journal!A67:H68"]);
    expect(byType(rows, "acct_unexplained_cash")[0].title).toBe("Cash differs from the bank by $75.00 with nothing to explain it");

    // Categorization and anomalies from the importer's own findings.
    expect(byType(rows, "acct_categorize").map((r) => r.title).sort()).toEqual([
      "1 line has no category",
      "11 revenue lines were sorted by keyword",
      "Payment type disagrees inside one entry: Client A - Recording Session",
    ]);
    expect(byType(rows, "acct_anomaly")[0].title).toBe("Card interest was $445.44 against $708.00 paid on the cards");

    // Only drafts were written to the journal; every posted entry is untouched.
    const all = await entries(t);
    const drafts = all.filter((e) => e.status === "draft");
    expect(drafts).toHaveLength(3);
    expect(drafts.every((e) => e.source === "agent" && e.sourceRef?.startsWith("agent:") && e.createdBy === "Accounting agent")).toBe(true);
    expect(all.filter((e) => e.status === "posted")).toHaveLength(48);
    expect(all.filter((e) => e.status === "void")).toHaveLength(0);
    const after = await bankCheck(who);
    expect(after.check.amountCents).toBe(-63_000);
    expect(after.statements.recomputed.incomeStatement.netIncomeCents).toBe(-112_780);

    // Nothing was sent to anyone.
    const sent = await t.run(async (ctx) => (await ctx.db.query("notifications").collect()).length);
    expect(sent).toBe(0);

    // The run is logged.
    const runs = await t.run(async (ctx) => (await ctx.db.query("agentRuns").collect()).filter((r) => r.orgId === ORG));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runType: "accounting_scan", status: "completed", initiatedBy: "system" });
    expect(runs[0].summary).toContain("13 new items");
  });

  it("writes the close checklist and the owner digest, with the July numbers", async () => {
    const { t, who } = await setup();
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    const insights = await t.run(async (ctx) => (await ctx.db.query("agentInsights").collect()).filter((i) => i.orgId === ORG));
    expect(insights.map((i) => i.title).sort()).toEqual(["Month-end close: July 2026", "Monthly summary: July 2026"]);
    const digest = insights.find((i) => i.title.startsWith("Monthly"))!;
    expect(digest.explanation.split("\n")[0]).toBe(
      "Revenue $1,305.00, expenses $2,432.80, net loss $1,127.80. Your books show $981.29 cash; the bank shows $1,611.29. Three things need your attention.",
    );
    const close = insights.find((i) => i.title.startsWith("Month-end"))!;
    expect(close.severity).toBe("warning");
    expect(close.explanation).toContain("Software & Subscriptions: your statement says $53.99, the journal adds up to $72.99 (+$19.00).");
    expect(close.explanation).toContain("The books show $981.29 in cash and the Checking A statement shows $1,611.29, $630.00 apart.");
    expect(close.explanation).toContain("Deposits In Transit still holds $455.00.");
    expect(close.explanation).toContain("Business Funds Held by Owner still holds $250.00.");
    expect(close.explanation).toContain('Row 77 had the date "7//27/26" typed as text.');
    expect(close.explanation).toContain("The cash flow's beginning cash label says May 1, 2026");
    expect(close.explanation).toContain("Done - Regular expenses");
    expect(close.explanation).not.toMatch(/[–—]/);

    // The same picture is available on demand.
    const o = await who.owner.query(api.accountingAgent.overview, {});
    expect(o?.label).toBe("July 2026");
    expect(o?.digest.attentionCount).toBe(3);
    expect(o?.checklist.find((i) => i.key === "bank")?.status).toBe("needs_attention");
  });

  it("is idempotent: a second scan adds nothing, a dismissed item stays dismissed", async () => {
    const { t, who } = await setup();
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    const snapshot = async () => ({
      actions: (await actions(t)).length,
      entries: (await entries(t)).length,
      insights: await t.run(async (ctx) => (await ctx.db.query("agentInsights").collect()).length),
    });
    const first = await snapshot();
    const again = await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(again).toMatchObject({ proposed: 0, insights: 0 });
    expect(await snapshot()).toEqual(first);

    const note = byType(await actions(t), "acct_fee_split")[0];
    await who.owner.mutation(api.opsActions.dismiss, { id: note._id });
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(await snapshot()).toEqual(first);
    expect((await t.run((ctx) => ctx.db.get(note._id)))?.status).toBe("dismissed");
  });
});

describe("approving", () => {
  it("posts a clearing draft through the ledger API, balanced, and the bank gap shrinks by that amount", async () => {
    const { t, who } = await setup();
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    const dit = byType(await actions(t), "acct_clearing_draft").find((r) => r.title.includes("$455.00"))!;
    const draftId = (dit.payload as { draftEntryId: Id<"journalEntries"> }).draftEntryId;

    // Through the shared inbox, which hands money items to the Accounting path.
    await who.owner.mutation(api.opsActions.approve, { id: dit._id });

    const posted = (await t.run((ctx) => ctx.db.get(draftId)))!;
    expect(posted).toMatchObject({ status: "posted", source: "agent", totalCents: 45_500, entryDate: Date.UTC(2026, 6, 31) });
    expect(posted.lines.reduce((s, l) => s + l.debitCents, 0)).toBe(45_500);
    expect(posted.lines.reduce((s, l) => s + l.creditCents, 0)).toBe(45_500);
    const row = (await t.run((ctx) => ctx.db.get(dit._id)))!;
    expect(row).toMatchObject({ status: "executed", decidedBy: "Owner" });
    expect(row.result).toContain("Posted");

    const { check, detail, statements } = await bankCheck(who);
    expect(check.amountCents).toBe(-17_500); // -630.00 -> -175.00
    expect(detail.ledgerEndingCents).toBe(143_629);
    expect(detail.unexplainedCents).toBe(7_500); // the unexplained part does not move
    expect(statements.checks.find((c) => c.code === "balanced_entries")?.status).toBe("pass");
    expect(statements.checks.find((c) => c.code === "balance_sheet_balances")?.status).toBe("pass");
    expect(statements.recomputed.incomeStatement.netIncomeCents).toBe(-112_780); // a transfer: no P&L effect

    // The same item cannot be approved twice.
    await expect(who.owner.mutation(api.opsActions.approve, { id: dit._id })).rejects.toThrow(/executed/);

    // A fresh scan keeps the other draft and the unexplained 75.00, and adds nothing.
    const again = await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(again.proposed).toBe(0);
    // The cash draw can no longer come out of Deposits In Transit (already
    // cleared), so the rescan withdraws it instead of leaving a trap.
    const reclass = byType(await actions(t), "acct_cash_draw_reclass")[0];
    expect(reclass).toMatchObject({ status: "dismissed", decidedBy: "accounting:rescan" });
    const open = (await actions(t)).filter((r) => r.status === "proposed");
    expect(open.map((r) => r.type).sort()).toEqual([
      "acct_anomaly", "acct_categorize", "acct_categorize", "acct_categorize",
      "acct_clearing_draft", "acct_fee_split", "acct_fee_split", "acct_fee_split", "acct_receipt_missing", "acct_receipt_missing", "acct_unexplained_cash",
    ]);

    // Approve the other through the Accounting API directly: books now 75.00 above the bank.
    const bf = byType(await actions(t), "acct_clearing_draft").find((r) => r.status === "proposed")!;
    await who.manager.mutation(api.accountingAgent.approve, { id: bf._id });
    const done = await bankCheck(who);
    expect(done.check.amountCents).toBe(7_500);
    expect(done.detail.unclearedClearingTotalCents).toBe(0);
    const last = await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(last.proposed).toBe(0);
    // Still exactly one unexplained item, for the same 75.00.
    expect(byType(await actions(t), "acct_unexplained_cash")).toHaveLength(1);
  });

  it("approving the cash draw first re-sizes the clearing draft, and a stale draft cannot be posted", async () => {
    const { t, who } = await setup();
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    const reclass = byType(await actions(t), "acct_cash_draw_reclass")[0];
    const old = byType(await actions(t), "acct_clearing_draft").find((r) => r.title.includes("$455.00"))!;
    await who.owner.mutation(api.accountingAgent.approve, { id: reclass._id });
    const afterDraw = await bankCheck(who);
    expect(afterDraw.check.amountCents).toBe(-58_900); // up 41.00 on its own

    // The old 455.00 draft would now overdraw Deposits In Transit (414.00): refused.
    await expect(who.owner.mutation(api.accountingAgent.approve, { id: old._id })).rejects.toThrow(/changed since this draft was made/);
    expect((await t.run((ctx) => ctx.db.get(old._id)))?.status).toBe("proposed");

    // A fresh scan withdraws it and proposes 414.00; the unexplained part stays 75.00.
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    const rows = await actions(t);
    expect((await t.run((ctx) => ctx.db.get(old._id)))).toMatchObject({ status: "dismissed", decidedBy: "accounting:rescan" });
    const fresh = byType(rows, "acct_clearing_draft").filter((r) => r.status === "proposed").map((r) => r.title).sort();
    expect(fresh).toEqual([
      "Move $250.00 from Business Funds Held by Owner into Bank / Cash",
      "Move $414.00 from Deposits In Transit into Bank / Cash",
    ]);
    const unexplained = byType(rows, "acct_unexplained_cash").filter((r) => r.status === "proposed");
    expect(unexplained).toHaveLength(1);
    expect(unexplained[0].title).toContain("$75.00");

    for (const r of byType(rows, "acct_clearing_draft").filter((x) => x.status === "proposed")) {
      await who.owner.mutation(api.accountingAgent.approve, { id: r._id });
    }
    const done = await bankCheck(who);
    expect(done.check.amountCents).toBe(7_500);
    expect(done.statements.checks.find((c) => c.code === "balance_sheet_balances")?.status).toBe("pass");
  });

  it("acknowledging a finding changes nothing in the books", async () => {
    const { t, who } = await setup();
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    const before = JSON.stringify((await entries(t)).map((e) => [e._id, e.status, e.lines]));
    const note = byType(await actions(t), "acct_receipt_missing")[0];
    await who.owner.mutation(api.opsActions.approve, { id: note._id });
    expect((await t.run((ctx) => ctx.db.get(note._id)))).toMatchObject({ status: "executed", result: "Acknowledged. Nothing in the books changed." });
    expect(JSON.stringify((await entries(t)).map((e) => [e._id, e.status, e.lines]))).toBe(before);
  });

  it("an owner can never set Accounting to auto", async () => {
    const { t, who } = await setup();
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === ORG)!;
      await ctx.db.patch(org._id, { tier: "max" }); // autonomy settings need the Max plan
    });
    await expect(who.owner.mutation(api.opsActions.setMode, { actionType: "acct_clearing_draft", mode: "auto" })).rejects.toThrow(/cannot be set to auto/);
  });
});

describe("who can see and approve", () => {
  it("hides money items from non-money roles and refuses them any decision", async () => {
    const { t, who } = await setup();
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    const id = byType(await actions(t), "acct_clearing_draft")[0]._id;

    // Owner, manager and accountant see them; an engineer does not.
    const inbox = async (c: typeof who.owner) => (await c.query(api.opsActions.list, { limit: 100 })).filter((r) => (ACCOUNTING_ACTION_TYPES as readonly string[]).includes(r.type)).length;
    expect(await inbox(who.owner)).toBe(13);
    expect(await inbox(who.manager)).toBe(13);
    expect(await inbox(who.accountant)).toBe(13);
    expect(await inbox(who.engineer)).toBe(0);
    expect((await who.engineer.query(api.opsActions.counts, {})).open).toBe(0);
    expect((await who.owner.query(api.opsActions.counts, {})).open).toBe(13);
    await expect(who.engineer.query(api.accountingAgent.overview, {})).rejects.toThrow(/insights.read/);

    // An engineer cannot decide; an accountant reads but cannot approve.
    for (const c of [who.engineer, who.accountant]) {
      await expect(c.mutation(api.opsActions.approve, { id })).rejects.toThrow();
      await expect(c.mutation(api.accountingAgent.approve, { id })).rejects.toThrow();
      await expect(c.mutation(api.opsActions.dismiss, { id })).rejects.toThrow();
      await expect(c.mutation(api.accountingAgent.snooze, { id, until: Date.now() + 1000 })).rejects.toThrow();
    }
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("proposed");
    expect((await entries(t)).filter((e) => e.status === "posted")).toHaveLength(48);
  });

  it("a manager whose owner turned money off sees and approves nothing", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    await importJuly(t, "org_nomoney");
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: "org_nomoney" });
    const rows = await actions(t, "org_nomoney");
    expect(rows.length).toBeGreaterThan(0);
    expect((await who.noMoneyManager.query(api.opsActions.list, { limit: 100 })).filter((r) => (ACCOUNTING_ACTION_TYPES as readonly string[]).includes(r.type))).toEqual([]);
    await expect(who.noMoneyManager.mutation(api.accountingAgent.approve, { id: rows[0]._id })).rejects.toThrow();
  });

  it("another studio's data never appears, and another studio cannot act on it", async () => {
    const t = convexTest(schema);
    const who = await studio(t);
    await importJuly(t, ORG);
    await importJuly(t, OTHER);
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: OTHER });

    const mine = await actions(t, ORG);
    const theirs = await actions(t, OTHER);
    expect(mine).toHaveLength(13);
    expect(theirs).toHaveLength(13);

    // Every journal id a proposal names belongs to the proposal's own studio.
    const orgOf = (id: Id<"journalEntries">) => t.run(async (ctx) => (await ctx.db.get(id))!.orgId);
    for (const [rows, org] of [[mine, ORG], [theirs, OTHER]] as const) {
      for (const r of rows) {
        const p = r.payload as { draftEntryId?: Id<"journalEntries">; entryIds?: Id<"journalEntries">[]; entryId?: Id<"journalEntries"> };
        for (const id of [p.draftEntryId, p.entryId, ...(p.entryIds ?? [])]) if (id) expect(await orgOf(id)).toBe(org);
      }
    }
    const mineIds = new Set(mine.map((r) => r._id));
    const otherInbox = await who.otherOwner.query(api.opsActions.list, { limit: 100 });
    expect(otherInbox.every((r) => !mineIds.has(r._id) && r.orgId === OTHER)).toBe(true);

    // Their owner cannot touch my item.
    await expect(who.otherOwner.mutation(api.accountingAgent.approve, { id: mine[0]._id })).rejects.toThrow(/Not found/);
    await expect(who.otherOwner.mutation(api.opsActions.approve, { id: mine[0]._id })).rejects.toThrow();
    expect((await t.run((ctx) => ctx.db.get(mine[0]._id)))?.status).toBe("proposed");

    // A studio with no books gets nothing.
    await t.run(async (ctx) => { await ctx.db.insert("orgs", { orgId: "org_empty", name: "e", slug: "e", tier: "growth", status: "active" }); });
    expect(await t.mutation(internal.accountingAgent.scanOrg, { orgId: "org_empty" })).toMatchObject({ skipped: "no_books", proposed: 0 });
  });
});

describe("autonomy", () => {
  async function withReceipts(autonomy: "suggest" | "auto_low" | "auto_trusted") {
    const { t, who } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("agentPolicies", { orgId: ORG, enabled: true, defaultTone: "professional", autonomy, digestEnabled: true, updatedAt: 1 });
      const storageId = await ctx.storage.store(new Blob(["r"], { type: "image/png" }));
      const base = { orgId: ORG, storageId, fileName: "r.png", fileType: "image/png", sizeBytes: 1, uploadedBy: "t", uploadedAt: 1, status: "ready" as const };
      // Exact: amount, same day, vendor name in the description.
      await ctx.db.insert("receipts", { ...base, vendor: "Processor A", date: Date.UTC(2026, 6, 1), totalCents: 5_140 });
      // Close, not certain: amount and date, no vendor clue.
      await ctx.db.insert("receipts", { ...base, vendor: "Unknown shop", date: Date.UTC(2026, 6, 24), totalCents: 4_100 });
    });
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    return { t, who };
  }

  it("auto_trusted links an exact receipt match and nothing else", async () => {
    const { t, who } = await withReceipts("auto_trusted");
    const links = byType(await actions(t), "acct_receipt_link");
    expect(links).toHaveLength(2);
    const exact = links.find((r) => (r.payload as { exact: boolean }).exact)!;
    const near = links.find((r) => !(r.payload as { exact: boolean }).exact)!;
    expect(exact).toMatchObject({ status: "executed", autonomy: true, riskLevel: "low", decidedBy: "accounting:auto_trusted" });
    expect(near).toMatchObject({ status: "proposed", autonomy: false, riskLevel: "medium" });

    const all = await entries(t);
    const linked = all.find((e) => e.sourceRef === "July Journal!A3:H4")!;
    expect(linked.receiptStatus).toBe("yes");
    expect(linked.receiptDocIds).toHaveLength(1);
    // The near match is left alone, so its entry still has no receipt.
    expect(all.find((e) => e.sourceRef === "July Journal!A67:H68")?.receiptStatus).toBe("no");
    // Both entries now have a link proposal, so neither is also flagged as missing.
    expect(byType(await actions(t), "acct_receipt_missing")).toHaveLength(0);

    // At every autonomy level the clearing drafts stay drafts and nothing is posted by the scan.
    expect(all.filter((e) => e.source === "agent").every((e) => e.status === "draft")).toBe(true);
    expect(all.filter((e) => e.status === "posted")).toHaveLength(48);
    expect(byType(await actions(t), "acct_clearing_draft").every((r) => r.status === "proposed")).toBe(true);

    // The near match still needs a person.
    await who.owner.mutation(api.opsActions.approve, { id: near._id });
    expect((await entries(t)).find((e) => e.sourceRef === "July Journal!A67:H68")?.receiptStatus).toBe("yes");
  });

  it.each(["suggest", "auto_low"] as const)("%s links nothing on its own", async (level) => {
    const { t } = await withReceipts(level);
    const links = byType(await actions(t), "acct_receipt_link");
    expect(links).toHaveLength(2);
    expect(links.every((r) => r.status === "proposed" && r.autonomy === false)).toBe(true);
    expect((await entries(t)).filter((e) => e.receiptStatus === "yes" && (e.receiptDocIds ?? []).length > 0)).toHaveLength(0);
  });
});

describe("the studio switch and the fleet view", () => {
  it("honors the studio on/off in agentPolicies, owner-only to change", async () => {
    const { t, who } = await setup();
    expect(await who.owner.query(api.accountingAgent.status, {})).toMatchObject({ enabled: true, autonomy: "suggest", openProposals: 0 });
    await who.owner.mutation(api.accountingAgent.setEnabled, { enabled: false });
    expect(await who.owner.query(api.accountingAgent.status, {})).toMatchObject({ enabled: false });
    expect(await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG })).toMatchObject({ skipped: "off", proposed: 0 });
    expect(await actions(t)).toHaveLength(0);

    await expect(who.engineer.mutation(api.accountingAgent.setEnabled, { enabled: true })).rejects.toThrow();
    await expect(who.accountant.mutation(api.accountingAgent.setEnabled, { enabled: true })).rejects.toThrow();

    await who.owner.mutation(api.accountingAgent.setEnabled, { enabled: true });
    const res = await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(res.proposed).toBe(13);
    expect(await who.owner.query(api.accountingAgent.status, {})).toMatchObject({ enabled: true, openProposals: 13 });
  });

  it("the master agent switch turns Accounting off too", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => { await ctx.db.insert("agentPolicies", { orgId: ORG, enabled: false, defaultTone: "professional", autonomy: "suggest", digestEnabled: true, updatedAt: 1 }); });
    expect(await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG })).toMatchObject({ skipped: "off" });
  });

  it("shows the agent on the agency fleet view, with its own switch", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: "ag", name: "AG", slug: "ag", plan: "max", status: "active", ownerClerkUserId: "u_ag", ownerEmail: "o@x.com" });
      await ctx.db.insert("agencyMembers", { agencyId: "ag", clerkUserId: "u_ag", email: "o@x.com", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: "sub_a", name: "Studio A", slug: "a", tier: "growth", status: "active", agencyId: "ag" });
    });
    await importJuly(t, "sub_a");
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: "sub_a" });
    const agency = t.withIdentity({ subject: "u_ag", name: "Owner", orgId: "ag", orgType: "agency" });
    let fleet = await agency.query(api.agentFleet.fleet, {});
    expect(fleet).toHaveLength(1);
    expect(fleet[0].accounting).toMatchObject({ enabled: true, openProposals: 13 });
    expect(fleet[0].accounting.lastScanAt).not.toBeNull();
    await agency.mutation(api.agentFleet.setAccountingAgent, { orgId: "sub_a", enabled: false });
    fleet = await agency.query(api.agentFleet.fleet, {});
    expect(fleet[0].accounting.enabled).toBe(false);
    expect(await t.mutation(internal.accountingAgent.scanOrg, { orgId: "sub_a" })).toMatchObject({ skipped: "off" });
  });
});

describe("a money question reaches Accounting", () => {
  afterEach(() => vi.useRealTimers());

  it("routes the question, answers from the books and never calls the general agent", async () => {
    vi.useFakeTimers();
    const { t, who } = await setup();
    const runId = await who.owner.mutation(api.agent.createRun, { prompt: "Why is my cash different from the bank?" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const run = (await t.run((ctx) => ctx.db.get(runId)))!;
    expect(run).toMatchObject({ status: "completed", source: "accounting" });
    const msgs = await t.run(async (ctx) => (await ctx.db.query("agentMessages").collect()).filter((m) => m.runId === runId));
    const answer = msgs.find((m) => m.role === "assistant")!.body;
    expect(answer).toContain("July 2026. Revenue $1,305.00");
    expect(answer).toContain("$630.00 apart");
    expect(answer).toContain("Deposits In Transit still holds $455.00");
    expect(answer).not.toMatch(/[–—]/);
    const log = await t.run(async (ctx) => (await ctx.db.query("agentAuditLogs").collect()).filter((l) => l.runId === runId).map((l) => l.event));
    expect(log).toContain("run.routed");
    expect(log).not.toContain("llm.called");
  });

  it("leaves a non-money question, and any question when Accounting is off, to the general agent", async () => {
    vi.useFakeTimers();
    const { t, who } = await setup();
    const scheduled = async () => (await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((f) => f.name))).sort();

    await who.owner.mutation(api.agent.createRun, { prompt: "Who should I follow up with this week?" });
    expect(await scheduled()).toEqual(["agent:runAgentLLM"]);

    await who.owner.mutation(api.accountingAgent.setEnabled, { enabled: false });
    await who.owner.mutation(api.agent.createRun, { prompt: "Which receipts are missing?" });
    expect(await scheduled()).toEqual(["agent:runAgentLLM", "agent:runAgentLLM"]);
    expect(await scheduled()).not.toContain("accountingAgent:answerRun");
  });

  it("schedules optional AI wording only when a model key exists, so tests never call one", async () => {
    vi.useFakeTimers();
    const { t } = await setup();
    const names = async () => (await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((f) => f.name)));
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(await names()).toEqual([]); // no key: the deterministic text is the text

    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-real");
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG, period: "2026-06" }); // no June books: nothing to enrich
    expect(await names()).toEqual([]);
    await t.run(async (ctx) => { for (const a of await ctx.db.query("opsActions").collect()) await ctx.db.delete(a._id); });
    await t.mutation(internal.accountingAgent.scanOrg, { orgId: ORG });
    expect(await names()).toEqual(["aiActions:enrichAccountingActions"]); // never drained here: no model call
  });
});
