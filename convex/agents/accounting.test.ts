import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { BankReconciliationRow } from "../lib/statements";
import { assertActionInScope } from "../lib/agentScope";
import { planLateEntry } from "../lib/lateEntries";
import {
  type AccountingSignals,
  type AcctAccount,
  type AcctEntry,
  type AcctReceipt,
  accountingCandidates,
  accountingInsights,
  anomalyCandidates,
  categorizationCandidates,
  clearingCandidates,
  closeChecklist,
  dollars,
  lateEntryCandidates,
  lateEntryInsight,
  matchReceipts,
  missingRecurring,
  ownerDigest,
  planClearing,
  receiptCandidates,
  recurringKey,
} from "./accounting";

/* Pure generators on hand-built signals. The end-to-end run on the anonymized
   July books is in convex/accountingAgent.test.ts. */

const D = (m: number, d: number, y = 2026) => Date.UTC(y, m - 1, d);

const ACCOUNTS: AcctAccount[] = [
  { id: "bank_cash", key: "bank_cash", name: "Bank / Cash", type: "asset", isCash: true },
  { id: "deposits_in_transit", key: "deposits_in_transit", name: "Deposits In Transit", type: "asset", isClearing: true },
  { id: "business_funds_held_by_owner", key: "business_funds_held_by_owner", name: "Business Funds Held by Owner", type: "asset", isClearing: true },
  { id: "owner_draw", key: "owner_draw", name: "Owner Draw / Distribution", type: "equity" },
  { id: "unearned_revenue", key: "unearned_revenue", name: "Unearned Revenue", type: "liability" },
  { id: "credit_card_payable", key: "credit_card_payable", name: "Credit Card Payable", type: "liability" },
  { id: "revenue_recording", key: "revenue_recording", name: "Recording Session Revenue", type: "revenue" },
  { id: "rent", key: "rent", name: "Rent Expense", type: "expense" },
  { id: "insurance", key: "insurance", name: "Insurance Expenses", type: "expense" },
  { id: "internet", key: "internet", name: "Internet Expense", type: "expense" },
  { id: "software", key: "software", name: "Software & Subscriptions Expense", type: "expense" },
  { id: "merchant_processing", key: "merchant_processing", name: "Merchant/Processing Expense", type: "expense" },
  { id: "cc_interest_fees", key: "cc_interest_fees", name: "Credit Card Interest & Fees Expense", type: "expense" },
];

let seq = 0;
function entry(date: number, memo: string, lines: [string, number, number][], extra: Partial<AcctEntry> = {}): AcctEntry {
  const total = lines.reduce((s, l) => s + l[1], 0);
  return {
    id: `e${++seq}` as Id<"journalEntries">,
    entryDate: date,
    memo,
    status: "posted",
    source: "import",
    receiptStatus: "yes",
    lines: lines.map(([accountId, debitCents, creditCents]) => ({ accountId, debitCents, creditCents })),
    totalCents: total,
    receiptIds: [],
    ...extra,
  };
}

function receipt(id: string, over: Partial<AcctReceipt> = {}): AcctReceipt {
  return { id: id as Id<"receipts">, status: "ready", ...over };
}

function recon(over: Partial<BankReconciliationRow> = {}): BankReconciliationRow {
  return {
    accountLabel: "Checking A", ledgerAccountIds: ["bank_cash"],
    bankBeginningCents: 168_750, bankEndingCents: 161_129, bankNetChangeCents: -7_621, bankArithmeticDiffCents: 0,
    ledgerBeginningCents: 168_750, ledgerEndingCents: 98_129, ledgerNetChangeCents: -70_621,
    beginningVarianceCents: 0, endingVarianceCents: -63_000, netChangeVarianceCents: -63_000,
    unclearedClearing: [
      { accountId: "deposits_in_transit", name: "Deposits In Transit", cents: 45_500 },
      { accountId: "business_funds_held_by_owner", name: "Business Funds Held by Owner", cents: 25_000 },
    ],
    unclearedClearingTotalCents: 70_500, unexplainedCents: 7_500,
    ...over,
  };
}

function signals(over: Partial<AccountingSignals> = {}): AccountingSignals {
  return {
    now: D(8, 5), periodKey: "2026-07", periodStart: D(7, 1), periodEnd: D(8, 1),
    accounts: ACCOUNTS, entries: [], prior: [], receipts: [], recon: [], checks: [], variances: [], warnings: [],
    hasReported: false,
    totals: { revenueCents: 130_500, expensesCents: 243_280, netIncomeCents: -112_780, endingCashCents: 98_129 },
    ...over,
  };
}

describe("receipt matching", () => {
  const rent = () => entry(D(7, 2), "July rent and CAM - Landlord A", [["rent", 150_000, 0], ["bank_cash", 0, 150_000]], { receiptStatus: "pending" });

  it("an exact match (amount, same day, vendor) is low risk and carries its score", () => {
    const e = rent();
    const out = receiptCandidates(signals({ entries: [e], receipts: [receipt("r1", { vendor: "Landlord A", date: D(7, 2), totalCents: 150_000 })] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "acct_receipt_link", riskLevel: "low", priority: "low" });
    expect(out[0].payload).toMatchObject({ kind: "receipt_link", entryId: e.id, receiptId: "r1", exact: true, score: 100 });
    expect(out[0].confidence).toBe(1);
  });

  it("a close but uncertain match is offered at medium risk, never as exact", () => {
    const e = rent();
    const out = receiptCandidates(signals({ entries: [e], receipts: [receipt("r1", { vendor: "Unknown shop", date: D(7, 6), totalCents: 150_000 })] }));
    expect(out).toHaveLength(1);
    expect(out[0].riskLevel).toBe("medium");
    expect(out[0].payload).toMatchObject({ exact: false, score: 70 });
  });

  it("two receipts for the same amount make neither exact", () => {
    const e = rent();
    const matches = matchReceipts(signals({
      entries: [e],
      receipts: [
        receipt("r1", { vendor: "Landlord A", date: D(7, 2), totalCents: 150_000 }),
        receipt("r2", { vendor: "Landlord A", date: D(7, 2), totalCents: 150_000 }),
      ],
    }));
    expect(matches).toHaveLength(1);
    expect(matches[0].exact).toBe(false);
  });

  it("proposes nothing when the amount differs, the date is a month off or the receipt is already linked", () => {
    const e = rent();
    const linked = entry(D(7, 3), "Other", [["software", 1_200, 0], ["bank_cash", 0, 1_200]], { receiptIds: ["r3"] });
    const out = receiptCandidates(signals({
      entries: [e, linked],
      receipts: [
        receipt("r1", { vendor: "Landlord A", date: D(7, 2), totalCents: 149_000 }),
        receipt("r2", { vendor: "Landlord A", date: D(8, 20), totalCents: 150_000 }),
        receipt("r3", { vendor: "Other", date: D(7, 3), totalCents: 1_200 }),
      ],
    }));
    expect(out.filter((a) => a.type === "acct_receipt_link")).toEqual([]);
  });

  it("flags only the entries the books mark No, and not once a match exists", () => {
    const no = entry(D(7, 21), "Personal expenditure by Owner", [["owner_draw", 4_100, 0], ["bank_cash", 0, 4_100]], { receiptStatus: "no" });
    const matched = entry(D(7, 1), "Processor A monthly fee", [["merchant_processing", 5_140, 0], ["bank_cash", 0, 5_140]], { receiptStatus: "no" });
    const pending = entry(D(7, 9), "Pending thing", [["software", 900, 0], ["bank_cash", 0, 900]], { receiptStatus: "pending" });
    const agent = entry(D(7, 31), "Agent draft", [["bank_cash", 100, 0], ["deposits_in_transit", 0, 100]], { receiptStatus: "no", source: "agent", status: "draft" });
    const out = receiptCandidates(signals({
      entries: [no, matched, pending, agent],
      receipts: [receipt("r1", { vendor: "Processor A", date: D(7, 1), totalCents: 5_140 })],
    }));
    expect(out.filter((a) => a.type === "acct_receipt_missing").map((a) => a.payload.kind === "acct_note" && a.payload.entryIds)).toEqual([[no.id]]);
    expect(out.filter((a) => a.type === "acct_receipt_link")).toHaveLength(1);
  });
});

describe("clearing proposals", () => {
  const draw = () => entry(D(7, 21), "Personal expenditure by Owner", [["owner_draw", 4_100, 0], ["bank_cash", 0, 4_100]], { paymentKind: "cash", paymentRaw: "Cash", receiptStatus: "no" });
  const reversal = () => entry(D(7, 27), "Reimbursement of personal expenditure", [["bank_cash", 4_100, 0], ["owner_draw", 0, 4_100]], { paymentKind: "zelle", paymentRaw: "Zelle" });

  it("drafts a balanced entry per clearing balance when the bank holds more than the books", () => {
    const out = clearingCandidates(signals({ recon: [recon()] })).filter((a) => a.type === "acct_clearing_draft");
    expect(out.map((a) => a.title)).toEqual([
      "Move $455.00 from Deposits In Transit into Bank / Cash",
      "Move $250.00 from Business Funds Held by Owner into Bank / Cash",
    ]);
    const first = out[0].payload;
    expect(first.kind).toBe("ledger_draft");
    if (first.kind !== "ledger_draft") return;
    expect(first.entryDate).toBe(D(7, 31));
    expect(first.lines).toEqual([
      { accountKey: "bank_cash", accountName: "Bank / Cash", debitCents: 45_500, creditCents: 0 },
      { accountKey: "deposits_in_transit", accountName: "Deposits In Transit", debitCents: 0, creditCents: 45_500 },
    ]);
    expect(first.cashEffectCents).toBe(45_500);
    expect(first.evidence.join(" ")).toContain("$1,611.29");
    expect(first.evidence.join(" ")).toContain("$75.00 above");
  });

  it("proposes no clearing when the bank does not hold more than the books", () => {
    const out = clearingCandidates(signals({ recon: [recon({ endingVarianceCents: 5_000, ledgerEndingCents: 166_129 })] }));
    expect(out.filter((a) => a.type === "acct_clearing_draft")).toEqual([]);
  });

  it("reports what is left, 75.00 for July, and names no cause", () => {
    const plan = planClearing(signals({ recon: [recon()] }))!;
    expect(plan.residualCents).toBe(7_500);
    const lead = entry(D(7, 27), "Internet service - Vendor U1", [["internet", 7_500, 0], ["bank_cash", 0, 7_500]]);
    const out = clearingCandidates(signals({ recon: [recon()], entries: [lead] })).find((a) => a.type === "acct_unexplained_cash")!;
    expect(out.title).toBe("Cash differs from the bank by $75.00 with nothing to explain it");
    expect(out.payload.kind).toBe("acct_note");
    if (out.payload.kind !== "acct_note") return;
    expect(out.payload.evidence.join(" ")).toContain("leads to check, not conclusions");
    expect(out.payload.evidence.join(" ")).toContain("Internet service");
  });

  it("moves a cash-paid owner draw off the bank account and cites the later reimbursement", () => {
    const out = clearingCandidates(signals({ recon: [recon()], entries: [draw(), reversal()] })).find((a) => a.type === "acct_cash_draw_reclass")!;
    expect(out.title).toBe("Take the $41.00 cash owner draw off Bank / Cash");
    if (out.payload.kind !== "ledger_draft") throw new Error("expected a draft");
    expect(out.payload.lines).toEqual([
      { accountKey: "bank_cash", accountName: "Bank / Cash", debitCents: 4_100, creditCents: 0 },
      { accountKey: "deposits_in_transit", accountName: "Deposits In Transit", debitCents: 0, creditCents: 4_100 },
    ]);
    const text = out.payload.evidence.join(" ");
    expect(text).toContain("Jul 27");
    expect(text).toContain("moves $414.00 instead of $455.00");
  });

  it("proposes no draw reclass once Deposits In Transit can no longer cover it", () => {
    const cleared = recon({ unclearedClearing: [{ accountId: "deposits_in_transit", name: "Deposits In Transit", cents: 1_000 }] });
    const out = clearingCandidates(signals({ recon: [cleared], entries: [draw(), reversal()] }));
    expect(out.some((a) => a.type === "acct_cash_draw_reclass")).toBe(false);
  });

  it("does not touch a draw paid from the bank", () => {
    const bankDraw = entry(D(7, 21), "Owner draw", [["owner_draw", 4_100, 0], ["bank_cash", 0, 4_100]], { paymentKind: "zelle", paymentRaw: "Zelle" });
    const out = clearingCandidates(signals({ recon: [recon()], entries: [bankDraw] }));
    expect(out.some((a) => a.type === "acct_cash_draw_reclass")).toBe(false);
  });

  it("pairs a processor deposit with its fee as a note, not a second entry", () => {
    const dep = entry(D(7, 21), "Client D - July 29th Session Deposit", [["bank_cash", 2_500, 0], ["unearned_revenue", 0, 2_500]], { paymentKind: "other", paymentRaw: "Processor A" });
    const fee = entry(D(7, 21), "Processing fee - Client D deposit", [["merchant_processing", 100, 0], ["bank_cash", 0, 100]], { paymentKind: "other", paymentRaw: "Processor A" });
    const otherDep = entry(D(7, 26), "Client E - July 31st Session Deposit", [["bank_cash", 2_500, 0], ["unearned_revenue", 0, 2_500]], { paymentKind: "other", paymentRaw: "Processor A" });
    const out = clearingCandidates(signals({ entries: [dep, fee, otherDep] })).filter((a) => a.type === "acct_fee_split");
    expect(out).toHaveLength(1); // Client E has no fee entry to pair with
    expect(out[0].title).toBe("Processor deposit: $25.00 less $1.00 fee = $24.00 (Client D - July 29th Session Deposit)");
    expect(out[0].payload.kind).toBe("acct_note");
  });
});

describe("categorization help", () => {
  it("groups blank categories, keyword-sorted revenue and payment mismatches, by the row the importer named", () => {
    const rev = entry(D(7, 7), "Client B - Audio Stem Export", [["bank_cash", 5_000, 0], ["revenue_recording", 0, 5_000]], { sourceRef: "July Journal!A19:H20" });
    const adv = entry(D(7, 31), "Vendor M2 ads", [["rent", 14_816, 0], ["bank_cash", 0, 14_816]], { sourceRef: "July Journal!A95:H96" });
    const mix = entry(D(7, 21), "Client A - Recording Session", [["bank_cash", 20_000, 0], ["revenue_recording", 0, 20_000]], { sourceRef: "July Journal!A65:H66", paymentRaw: "Cash" });
    const out = categorizationCandidates(signals({
      entries: [rev, adv, mix],
      warnings: [
        { code: "revenue_line_inferred", severity: "info", message: "", row: 20, normalized: "Other Audio Services Revenue" },
        { code: "category_missing", severity: "warn", message: "", row: 95, raw: "-" },
        { code: "payment_type_mismatch", severity: "warn", message: "", row: 65, raw: "\"Cash\" vs \"Zelle\"" },
      ],
    }));
    expect(out.map((a) => a.title)).toEqual([
      "1 line has no category",
      "1 revenue line was sorted by keyword",
      "Payment type disagrees inside one entry: Client A - Recording Session",
    ]);
    expect(out.every((a) => a.type === "acct_categorize" && a.payload.kind === "acct_note")).toBe(true);
    const blank = out[0].payload.kind === "acct_note" ? out[0].payload.evidence[0] : "";
    expect(blank).toContain("Row 95");
    expect(blank).toContain("Rent Expense");
  });
});

describe("month-end close", () => {
  it("reads a recurring key past the month name and the year", () => {
    expect(recurringKey("July rent and CAM - Landlord A")).toBe("rent and cam landlord a");
    expect(recurringKey("June rent and CAM - Landlord A")).toBe(recurringKey("July rent and CAM - Landlord A"));
    expect(recurringKey("Vendor S1 scheduling subscription - July 2026")).toBe("vendor s1 scheduling subscription");
  });

  const monthly = (m: number, includeInternet: boolean) => [
    entry(D(m, 2), `${m === 5 ? "May" : "June"} rent and CAM - Landlord A`, [["rent", 150_000, 0], ["bank_cash", 0, 150_000]]),
    entry(D(m, 15), "General liability insurance - Insurer A (monthly premium)", [["insurance", 9_236, 0], ["bank_cash", 0, 9_236]]),
    ...(includeInternet ? [entry(D(m, 27), "Internet service - Vendor U1", [["internet", 7_500, 0], ["bank_cash", 0, 7_500]])] : []),
    entry(D(m, 1), "Vendor S1 scheduling subscription", [["software", 1_200, 0], ["bank_cash", 0, 1_200]]),
  ];

  it("finds an expense that appeared in each of the last two months and not this one", () => {
    const july = [
      entry(D(7, 2), "July rent and CAM - Landlord A", [["rent", 150_000, 0], ["bank_cash", 0, 150_000]]),
      entry(D(7, 15), "General liability insurance - Insurer A (monthly premium)", [["insurance", 9_236, 0], ["bank_cash", 0, 9_236]]),
      entry(D(7, 1), "Vendor S1 scheduling subscription - July 2026", [["software", 1_200, 0], ["bank_cash", 0, 1_200]]),
    ];
    const s = signals({ entries: july, prior: [{ key: "2026-06", entries: monthly(6, true) }, { key: "2026-05", entries: monthly(5, true) }] });
    const missing = missingRecurring(s);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ accountName: "Internet Expense", lastCents: 7_500 });
    const item = closeChecklist(s).find((i) => i.key === "recurring")!;
    expect(item.status).toBe("needs_attention");
    expect(item.details[0]).toContain("Internet service - Vendor U1");
  });

  it("flags nothing with only one prior month, or when the second month lacked it too", () => {
    const s1 = signals({ prior: [{ key: "2026-06", entries: monthly(6, true) }] });
    expect(missingRecurring(s1)).toEqual([]);
    const s2 = signals({ prior: [{ key: "2026-06", entries: monthly(6, true) }, { key: "2026-05", entries: monthly(5, false) }] });
    expect(missingRecurring(s2).map((m) => m.accountName)).not.toContain("Internet Expense");
  });

  it("lists statement variances, the bank gap, money in transit, text dates, outside entries and the label", () => {
    const s = signals({
      hasReported: true,
      recon: [recon()],
      variances: [{ statement: "incomeStatement", key: "expense.software_subscriptions", label: "Software & Subscriptions", kind: "line", reportedCents: 5_399, recomputedCents: 7_299, varianceCents: 1_900 }],
      checks: [
        { code: "cash_vs_bank", status: "fail", message: "", amountCents: -63_000 },
        { code: "clearing_not_cleared", status: "warn", message: "", detail: [{ name: "Deposits In Transit", endingCents: 45_500 }] },
        { code: "entries_outside_period", status: "warn", message: "", detail: [{ date: "2026-08-02", memo: "Late entry" }] },
      ],
      warnings: [
        { code: "text_date_normalized", severity: "warn", message: "", row: 77, raw: "7//27/26", normalized: "2026-07-27" },
        { code: "beginning_cash_label_date", severity: "warn", message: "The beginning cash label says May 1, 2026." },
      ],
    });
    const items = closeChecklist(s);
    const by = (k: string) => items.find((i) => i.key === k)!;
    expect(by("statements").details.join(" ")).toContain("Software & Subscriptions: your statement says $53.99, the journal adds up to $72.99 (+$19.00).");
    expect(by("bank").status).toBe("needs_attention");
    expect(by("clearing").details).toEqual(["Deposits In Transit still holds $455.00."]);
    expect(by("text_dates").details[0]).toContain('"7//27/26"');
    expect(by("outside").status).toBe("tidy_up");
    expect(by("cash_label").status).toBe("tidy_up");
  });
});

describe("anomalies", () => {
  it("finds duplicates, a card-interest load and negative cash, and reads the trailing average", () => {
    const a = entry(D(7, 3), "Vendor X subscription", [["software", 2_200, 0], ["bank_cash", 0, 2_200]]);
    const b = entry(D(7, 3), "vendor x  subscription", [["software", 2_200, 0], ["bank_cash", 0, 2_200]]);
    const interest = entry(D(7, 10), "Card B interest", [["cc_interest_fees", 44_544, 0], ["credit_card_payable", 0, 44_544]]);
    const paid = entry(D(7, 14), "Payment to Card B", [["credit_card_payable", 70_800, 0], ["bank_cash", 0, 70_800]]);
    const out = anomalyCandidates(signals({
      entries: [a, b, interest, paid],
      checks: [{ code: "negative_cash", status: "warn", message: "Cash per ledger is negative at the end of 1 days.", detail: [{ date: "2026-07-09", cents: -1_500 }] }],
    }));
    const titles = out.map((o) => o.title);
    expect(titles).toContain("Possible duplicate: Vendor X subscription ($22.00) entered 2 times");
    expect(titles).toContain("Card interest was $445.44 against $708.00 paid on the cards");
    expect(titles).toContain("Cash in the books goes below zero (1 day)");
  });

  it("flags an expense that doubles its usual level, and not a small bump", () => {
    const history = (cents: number) => [entry(D(6, 5), "Software", [["software", cents, 0], ["bank_cash", 0, cents]])];
    const now = (cents: number) => [entry(D(7, 5), "Software", [["software", cents, 0], ["bank_cash", 0, cents]])];
    const prior = [{ key: "2026-06", entries: history(20_000) }, { key: "2026-05", entries: history(20_000) }];
    const big = anomalyCandidates(signals({ entries: now(60_000), prior }));
    expect(big.map((o) => o.title)).toEqual(["Software & Subscriptions Expense is $400.00 above its usual level"]);
    expect(anomalyCandidates(signals({ entries: now(25_000), prior }))).toEqual([]);
    expect(anomalyCandidates(signals({ entries: now(60_000), prior: [prior[0]] }))).toEqual([]);
  });
});

describe("the owner digest", () => {
  const julySignals = () =>
    signals({
      hasReported: true,
      recon: [recon()],
      variances: [{ statement: "incomeStatement", key: "expense.software_subscriptions", label: "Software", kind: "line", reportedCents: 5_399, recomputedCents: 7_299, varianceCents: 1_900 }],
      checks: [{ code: "cash_vs_bank", status: "fail", message: "" }, { code: "clearing_not_cleared", status: "warn", message: "", detail: [{ name: "Deposits In Transit", endingCents: 45_500 }] }],
      entries: [entry(D(7, 21), "Personal expenditure by Owner", [["owner_draw", 4_100, 0], ["bank_cash", 0, 4_100]], { receiptStatus: "no" })],
    });

  it("says it in plain English with the real numbers", () => {
    const s = julySignals();
    const d = ownerDigest(s, closeChecklist(s), []);
    expect(d.headline).toBe(
      "Revenue $1,305.00, expenses $2,432.80, net loss $1,127.80. Your books show $981.29 cash; the bank shows $1,611.29. Three things need your attention.",
    );
    expect(d.attentionCount).toBe(3);
  });

  it("handles a profit, no bank statement and nothing to fix", () => {
    const s = signals({ totals: { revenueCents: 500_000, expensesCents: 300_000, netIncomeCents: 200_000, endingCashCents: 0 } });
    const d = ownerDigest(s, closeChecklist(s).filter((i) => i.status === "done"), []);
    expect(d.headline).toBe("Revenue $5,000.00, expenses $3,000.00, net income $2,000.00. Nothing needs your attention.");
    const one = ownerDigest(s, [{ key: "x", group: "receipts", label: "Receipts", status: "needs_attention", details: ["d"] }], []);
    expect(one.headline).toContain("One thing needs your attention.");
  });

  it("publishes a checklist and a summary as read-only notes", () => {
    const out = accountingInsights(julySignals());
    expect(out.map((i) => i.title)).toEqual(["Month-end close: July 2026", "Monthly summary: July 2026"]);
    expect(out[0].severity).toBe("warning");
  });
});

describe("every proposal is inside the Accounting scope", () => {
  const busy = () => {
    const draw = entry(D(7, 21), "Personal expenditure by Owner", [["owner_draw", 4_100, 0], ["bank_cash", 0, 4_100]], { paymentKind: "cash", paymentRaw: "Cash", receiptStatus: "no" });
    const dup1 = entry(D(7, 3), "Same thing", [["software", 2_200, 0], ["bank_cash", 0, 2_200]]);
    const dup2 = entry(D(7, 3), "Same thing", [["software", 2_200, 0], ["bank_cash", 0, 2_200]]);
    return signals({
      recon: [recon()],
      entries: [draw, dup1, dup2],
      receipts: [receipt("r1", { vendor: "Same thing", date: D(7, 3), totalCents: 2_200 })],
    });
  };

  it("emits only money action kinds, balanced drafts and copy without em dashes", () => {
    const out = accountingCandidates(busy());
    expect(out.length).toBeGreaterThan(4);
    for (const a of out) {
      expect(() => assertActionInScope("accounting", a)).not.toThrow();
      expect(a.type.startsWith("acct_")).toBe(true);
      expect(`${a.title} ${a.rationale}`).not.toMatch(/[–—]/);
      if (a.payload.kind === "ledger_draft") {
        expect(a.payload.lines.reduce((s, l) => s + l.debitCents, 0)).toBe(a.payload.lines.reduce((s, l) => s + l.creditCents, 0));
        expect(a.payload.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic and names each proposal with a stable key", () => {
    const keys = (x: AccountingSignals) => accountingCandidates(x).map((a) => `${a.type}:${a.entityId}`);
    const s = busy();
    expect(keys(s)).toEqual(keys(s));
    expect(new Set(keys(s)).size).toBe(keys(s).length);
  });

  it("dollars() formats cents", () => {
    expect(dollars(130_500)).toBe("$1,305.00");
    expect(dollars(-112_780)).toBe("-$1,127.80");
    expect(dollars(5)).toBe("$0.05");
  });
});

describe("late entry suggestions (openspec late-entries)", () => {
  const bank = (id: string, over: Partial<import("./accounting").AcctBankLine> = {}): import("./accounting").AcctBankLine =>
    ({ id: id as Id<"bankTransactions">, date: D(7, 14), amountCents: 2_900, direction: "out", name: "Vendor H hosting", ...over });
  const rent = () => entry(D(7, 2), "July rent and CAM - Landlord A", [["rent", 150_000, 0], ["bank_cash", 0, 150_000]]);
  const hostingJune = entry(D(6, 14), "Vendor H hosting", [["software", 2_900, 0], ["bank_cash", 0, 2_900]]);

  it("suggests a bank line the July books never recorded, with the category of a similar earlier entry", () => {
    const out = lateEntryCandidates(signals({ entries: [rent()], prior: [{ key: "2026-06", entries: [hostingJune] }], bankLines: [bank("b1")], hasReported: true }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "acct_late_entry", riskLevel: "medium", title: "Missed expense in July 2026: Vendor H hosting ($29.00)", entityId: "2026-07:late:bank:b1" });
    expect(out[0].payload).toMatchObject({ kind: "late_entry", lateKind: "expense", accountKey: "software", paidFrom: "bank", amountCents: 2_900, bankTransactionId: "b1", reason: "Missed bank transaction" });
    const evidence = (out[0].payload as { evidence: string[] }).evidence;
    expect(evidence).toContain("July 2026, already reported, would move: net income -$1,127.80 to -$1,156.80");
    expect(() => assertActionInScope("accounting", out[0])).not.toThrow();
    expect(() => assertActionInScope("operations", out[0])).toThrow(/belong to the Accounting agent/);
  });

  it("leaves a bank line the books already carry, within three days, and money in as income", () => {
    const paid = entry(D(7, 16), "Vendor H", [["software", 2_900, 0], ["bank_cash", 0, 2_900]]);
    expect(lateEntryCandidates(signals({ entries: [paid], bankLines: [bank("b1")] }))).toEqual([]);
    const deposit = lateEntryCandidates(signals({ bankLines: [bank("b2", { direction: "in", name: "Client Z", amountCents: 15_000 })] }));
    expect(deposit[0].payload).toMatchObject({ lateKind: "income", paidFrom: "bank" });
    expect((deposit[0].payload as { accountKey?: string }).accountKey).toBeUndefined();
    const card = lateEntryCandidates(signals({ bankLines: [bank("b3", { onCard: true, category: "software" })] }));
    expect(card[0].payload).toMatchObject({ paidFrom: "card", accountKey: "software" });
    // Money onto a card is a payment or a credit, not income: not suggested.
    expect(lateEntryCandidates(signals({ bankLines: [bank("b5", { onCard: true, direction: "in" })] }))).toEqual([]);
  });

  it("suggests an unmatched receipt once, never one an entry carries or matches", () => {
    const r = receipt("r9", { vendor: "Vendor K", date: D(7, 20), totalCents: 4_500, cardLast4: "1234" });
    const out = lateEntryCandidates(signals({ receipts: [r] }));
    expect(out[0].payload).toMatchObject({ receiptId: "r9", paidFrom: "card", lateKind: "expense" });
    expect((out[0].payload as { accountKey?: string }).accountKey).toBeUndefined();
    const carried = entry(D(7, 20), "Vendor K", [["software", 4_500, 0], ["bank_cash", 0, 4_500]], { receiptIds: ["r9"] });
    expect(lateEntryCandidates(signals({ entries: [carried], receipts: [r] }))).toEqual([]);
    const same = entry(D(7, 25), "Something", [["software", 4_500, 0], ["bank_cash", 0, 4_500]]);
    expect(lateEntryCandidates(signals({ entries: [same], receipts: [r] }))).toEqual([]);
    // A bank line that carries the receipt suggests once, not twice.
    expect(lateEntryCandidates(signals({ receipts: [r], bankLines: [bank("b4", { amountCents: 4_500, date: D(7, 20), receiptId: "r9" as Id<"receipts"> })] }))).toHaveLength(1);
  });

  it("every complete suggestion is one the ledger accepts as is", () => {
    const ledgerAccounts = ACCOUNTS.map((a) => ({ ...a }));
    const out = lateEntryCandidates(signals({
      prior: [{ key: "2026-06", entries: [hostingJune] }],
      bankLines: [bank("c1"), bank("c2", { direction: "in", name: "Client Z", amountCents: 15_000 }), bank("c3", { onCard: true, category: "software", date: D(7, 18) }), bank("c4", { onCard: true, direction: "in", amountCents: 5_000 })],
      receipts: [receipt("r1", { vendor: "Vendor H hosting", date: D(7, 22), totalCents: 3_300, cardLast4: "9999" })],
    }));
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const c of out) {
      const p = c.payload as { lateKind: "expense" | "income" | "refund"; entryDate: number; counterparty: string; amountCents: number; accountKey?: string; paidFrom?: "bank" | "card" };
      if (!p.accountKey || !p.paidFrom) continue;
      expect(() => planLateEntry({ kind: p.lateKind, entryDate: p.entryDate, counterparty: p.counterparty, amountCents: p.amountCents, accountId: p.accountKey!, paidFrom: p.paidFrom! }, ledgerAccounts), c.title).not.toThrow();
    }
  });

  it("only for a month that has ended", () => {
    expect(lateEntryCandidates(signals({ now: D(7, 20), bankLines: [bank("b1")] }))).toEqual([]);
    expect(lateEntryCandidates(signals({ now: D(8, 1), bankLines: [bank("b1")] }))).toHaveLength(1);
  });

  it("notes a reported month that late entries changed, in plain words", () => {
    const s = signals({
      hasReported: true,
      lateImpact: {
        count: 1,
        before: { netIncomeCents: -112_780, endingCashCents: 98_129 },
        after: { netIncomeCents: -114_680, endingCashCents: 96_229 },
        entries: [{ memo: "Vendor U2 - hosting", totalCents: 1_900, enteredAt: Date.UTC(2026, 9, 9, 15), reversal: false }],
      },
    });
    const ins = accountingInsights(s).find((i) => i.title === "Late entries: July 2026")!;
    expect(ins.explanation.split("\n")[0]).toBe("July 2026 net income moved from -$1,127.80 to -$1,146.80 after 1 late entry.");
    expect(ins.explanation).not.toMatch(/[–—]/);
    expect(lateEntryInsight(s, { ...s.lateImpact!, count: 2, after: s.lateImpact!.before }).explanation.split("\n")[0])
      .toBe("July 2026 has 2 late entries that cancel out: net income and cash are back where they were.");
    expect(accountingInsights(signals({ hasReported: false, lateImpact: s.lateImpact })).some((i) => i.title.startsWith("Late entries"))).toBe(false);
  });
});
