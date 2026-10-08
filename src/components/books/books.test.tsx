// @vitest-environment node
/* Every Books tab rendered from the anonymized July fixture, run through the
   Phase A engine. Each displayed figure is checked against the engine's own
   output, and the literal figures from the July books are asserted too. */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildFixture } from "@/lib/books/fixture";
import { formatAmount, formatUsd } from "@/lib/books/money";
import { aboutNotes, attentionCards, explainDifference, filterJournal, kpis, lineDifferences, needsAttention, statementRows, topExpenses, revenueMix } from "@/lib/books/view";
import { FullBook } from "./full-book";
import { journalCsv, statementCsv, checksCsv } from "@/lib/books/export";
import { SummaryPanel } from "./summary-panel";
import { JournalPanel } from "./journal-panel";
import { StatementPanel } from "./statement-panel";
import { ChecksPanel } from "./checks-panel";
import { BrandBar, PrintFrame } from "./brand-bar";

const fx = buildFixture();
const s = fx.statements;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (text: string, needle: string) => text.split(needle).length - 1;

const line = (kind: "balanceSheet" | "incomeStatement" | "cashFlow", key: string) =>
  statementRows(kind, s).find((r) => r.key === key)!;

describe("July fixture: the engine's own figures", () => {
  it("matches the books the owner reported and the ledger recomputes", () => {
    const is = s.recomputed.incomeStatement;
    expect(is.totalRevenueCents).toBe(130_500); // 1,305.00
    expect(is.totalExpensesCents).toBe(243_280); // 2,432.80 recomputed
    expect(s.reported!.incomeStatement.find((l) => l.key === "total_expenses")!.cents).toBe(241_380); // 2,413.80
    expect(is.netIncomeCents).toBe(-112_780); // -1,127.80
    expect(s.reported!.incomeStatement.find((l) => l.key === "net_income")!.cents).toBe(-110_880); // -1,108.80
    expect(s.recomputed.cashFlow.endingCashCents).toBe(98_129); // 981.29
    expect(s.reported!.cashFlow.find((l) => l.key === "ending_cash")!.cents).toBe(161_129); // 1,611.29
    expect(fx.bank[0].bankNetChangeCents).toBe(-7_621); // -76.21
    expect(s.journalTotals).toEqual({ entryCount: 48, debitCents: 588_080, creditCents: 588_080 }); // 5,880.80
  });

  it("has exactly nine line-level differences, and flags the subtotals too", () => {
    const lineVariances = [...(s.variances!.incomeStatement), ...(s.variances!.balanceSheet), ...(s.variances!.cashFlow)]
      .filter((v) => v.kind === "line");
    expect(lineVariances).toHaveLength(9);
    const flagged = (["balanceSheet", "incomeStatement", "cashFlow"] as const).flatMap((k) =>
      statementRows(k, s).filter((r) => r.differenceCents !== 0),
    );
    expect(flagged).toHaveLength(18);
  });
});

describe("Summary", () => {
  const out = html(<SummaryPanel statements={s} bank={fx.bank} onGo={() => {}} />);

  it("shows the four figures from the engine", () => {
    const k = kpis(s, fx.bank);
    expect(k.map((x) => x.journalCents)).toEqual([130_500, 243_280, -112_780, 98_129]);
    expect(out).toContain("$1,305.00");
    expect(out).toContain("$2,432.80");
    expect(out).toContain("−$1,127.80");
    expect(out).toContain("$981.29");
    expect(out).toContain("Statements: ");
    expect(out).toContain("$2,413.80");
    expect(out).toContain("−$1,108.80");
    expect(out).toContain("$1,611.29");
  });

  it("explains the cash gap from the bank check, with the engine's amounts", () => {
    expect(out).toContain("Cash does not match the bank");
    expect(out).toContain("$630.00 below the bank statement");
    expect(out).toContain("$705.00 sits in clearing accounts");
    expect(out).toContain("$75.00 is still unexplained");
  });

  it("lists the line-level differences in plain words", () => {
    expect(out).toContain("Software &amp; Subscriptions differs from your journal");
    expect(out).toContain("in your statements is $19.00 lower than your journal.");
  });

  it("ranks revenue and expenses from the engine lines", () => {
    expect(revenueMix(s)[0]).toMatchObject({ label: "Recording Session Revenue", cents: 117_500 });
    expect(topExpenses(s)[0]).toMatchObject({ key: "expense.rent", cents: 150_000 });
    expect(out).toContain(formatUsd(150_000));
  });

  it("never shows a dash placeholder for money", () => {
    expect(out).not.toContain("—");
  });
});

describe("Journal", () => {
  const out = html(
    <JournalPanel
      entries={fx.entries}
      accounts={fx.accounts}
      totals={s.journalTotals}
      filter={{}}
      onFilterChange={() => {}}
      hasMore={false}
      onLoadMore={() => {}}
      loadingMore={false}
    />,
  );

  it("shows all 48 entries and the posted totals row", () => {
    expect(count(out, "books-avoid-break align-top")).toBe(48);
    expect(out).toContain("5,880.80");
    expect(out).toContain("Posted total for the month");
    expect(out).toContain("48 entries");
  });

  it("shows the workbook's own receipt flags", () => {
    expect(count(out, ">No</span>")).toBeGreaterThanOrEqual(2);
  });

  it("filters the same way the ledger does", () => {
    // The ledger matches the memo, line memos and the raw payment type.
    const byText = filterJournal(fx.entries, { text: "processor a" });
    expect(byText).toHaveLength(8);
    expect(byText.every((e) => `${e.memo} ${e.paymentType?.raw ?? ""}`.toLowerCase().includes("processor a"))).toBe(true);
    expect(filterJournal(fx.entries, { receiptStatus: "no" })).toHaveLength(2);
    expect(filterJournal(fx.entries, { accountId: "rent" })).toHaveLength(1); // the July rent entry
  });

  it("exports the workbook's columns, one line per row", () => {
    const csv = journalCsv(fx.entries, fx.accounts);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("Date,Description / Purpose,Account,Expense Category,Payment Type,Debit (-),Credit (+),Receipt (Yes/No)");
    expect(rows).toHaveLength(1 + 96);
    expect(rows[1]).toBe("2026-07-01,Processor A monthly processing fee,Merchant/Processing Expense,Operating Expenses,Bank Transfer,51.40,,No");
  });
});

describe("Balance Sheet, Income Statement, Cash Flow", () => {
  const bs = html(<StatementPanel kind="balanceSheet" statements={s} />);
  const is = html(<StatementPanel kind="incomeStatement" statements={s} />);
  const cf = html(<StatementPanel kind="cashFlow" statements={s} />);

  it("renders every reported and recomputed figure exactly", () => {
    expect(is).toContain("1,305.00");
    expect(is).toContain("2,432.80");
    expect(is).toContain("2,413.80");
    expect(is).toContain("-1,127.80".replace("-", "−")); // recomputed net income, minus sign
    expect(bs).toContain("1,611.29");
    expect(bs).toContain("981.29");
    expect(cf).toContain("1,611.29");
    // Net change: the journal says -706.21, the workbook and bank say -76.21.
    expect(s.recomputed.cashFlow.netChangeCents).toBe(-70_621);
    expect(cf).toContain("\u2212706.21");
    expect(cf).toContain("\u221276.21");
  });

  it("highlights only nonzero differences, and nine of them are lines", () => {
    const flags = count(bs, "books-diff-flag") + count(is, "books-diff-flag") + count(cf, "books-diff-flag");
    expect(flags).toBe(18);
  });

  it("labels derived retained earnings as derived, and quotes the workbook's note", () => {
    expect(bs).toMatch(/Retained Earnings<span[^>]*>\(derived\)<\/span>/);
    expect(bs).toContain("Retained Earnings is a plug");
  });

  it("carries the beginning cash correction note on Cash Flow", () => {
    expect(cf).toContain("beginning cash label says May 1, 2026");
  });

  it("explains a difference in plain words, from the engine's own variance", () => {
    const row = line("incomeStatement", "expense.software_subscriptions");
    expect(row.differenceCents).toBe(1_900);
    expect(explainDifference(row)).toContain("Your journal is higher than the workbook");
    expect(explainDifference(line("balanceSheet", "equity.retained_earnings"))).toContain("derived");
  });
});

describe("Checks", () => {
  const out = html(<ChecksPanel checks={s.checks} bank={fx.bank} />);

  it("shows each check's status and its next step", () => {
    expect(out).toContain("Fail");
    expect(out).toContain("Warn");
    expect(out).toContain("Pass");
    expect(out).toContain("Compare each cash entry with the bank statement");
  });

  it("shows the bank reconciliation from the engine", () => {
    expect(out).toContain(formatAmount(168_750));
    expect(out).toContain(formatAmount(161_129));
    expect(out).toContain("−76.21");
    expect(out).toContain("−630.00");
    expect(out).toContain("Deposits In Transit");
    expect(out).toContain("705.00");
  });
});

describe("Brand and print frame", () => {
  const brand = { name: "Sample Studio", logoUrl: "/preview/books-sample-logo.svg", accentColor: "#fdb913" };
  const out = html(
    <PrintFrame brand={brand} entityName={s.entityName} period="2026-07" section="Balance Sheet">
      <p>body</p>
    </PrintFrame>,
  );

  it("repeats the logo, the legal entity and the period in the print header", () => {
    expect(out).toContain('src="/preview/books-sample-logo.svg"');
    expect(out).toContain(s.entityName!);
    expect(out).toContain("July 2026");
    expect(out).toContain("Prepared in Pulse");
  });

  it("uses one money formatter", () => {
    expect(formatAmount(-112_780)).toBe("−" + "1,127.80");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatAmount(7)).toBe("0.07");
  });

  it("builds a statement CSV with plain decimals", () => {
    const csv = statementCsv("incomeStatement", s);
    expect(csv).toContain("Total Revenue,1305.00,1305.00,");
    expect(checksCsv(s.checks).split("\r\n")[0]).toBe("Check,Status,Result,Amount");
  });

  it("builds attention items from the checks and variances", () => {
    const items = needsAttention(s, fx.bank);
    expect(items[0].tone).toBe("critical");
    expect(items.some((i) => i.id === "check:cash_vs_bank")).toBe(true);
    // Nine line variances; the cash line is covered by the bank check instead.
    expect(items.filter((i) => i.id.startsWith("variance:")).length).toBe(8);
  });

  it("uses the brand bar without a logo fallback when there is none", () => {
    const bar = html(<BrandBar brand={{ ...brand, logoUrl: null }} entityName={null} period="2026-07" />);
    expect(bar).toContain(">S<");
  });
});

describe("Summary, collapsed: four cards, everything else behind Show all", () => {
  const cards = attentionCards(s, fx.bank);
  const out = html(<SummaryPanel statements={s} bank={fx.bank} onGo={() => {}} />);

  it("shows at most four cards in the owner's order: cash, statements, receipts, clearing", () => {
    expect(cards.map((c) => c.id)).toEqual(["cash", "statements", "receipts", "clearing"]);
    expect(cards.length).toBeLessThanOrEqual(4);
  });

  it("writes the statement card from the engine's variances, with signs", () => {
    const statementsCard = cards.find((c) => c.id === "statements")!;
    const lines = lineDifferences(s);
    expect(lines).toHaveLength(9);
    expect(statementsCard.text).toBe(
      "9 lines in your statements differ from your journal, net income by \u2212$19.00, cash by \u2212$630.00.",
    );
    expect(out).toContain("net income by \u2212$19.00, cash by \u2212$630.00.");
  });

  it("writes the cash and clearing cards from the bank and clearing figures", () => {
    expect(cards.find((c) => c.id === "cash")!.text).toBe("Cash is $630.00 below the bank statement.");
    expect(cards.find((c) => c.id === "clearing")!.text).toBe("$705.00 is still in clearing accounts at month end.");
    expect(cards.find((c) => c.id === "receipts")!.text).toContain("2 entries have no receipt.");
  });

  it("collapses every other item behind Show all (N), and every item is in the list", () => {
    const all = needsAttention(s, fx.bank);
    expect(all).toHaveLength(11);
    expect(out).toContain("Show all (11)");
    // Each item renders once in the disclosure: its title appears in the markup.
    for (const a of all) expect(out).toContain(a.title.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"));
  });

  it("moves workbook remarks to About these books, not attention", () => {
    const notes = aboutNotes(s);
    expect(notes.map((n) => n.code)).toEqual(
      expect.arrayContaining(["beginning_cash_label_date", "retained_earnings_plug", "hardcoded_statement_values"]),
    );
    expect(needsAttention(s, fx.bank).some((a) => a.id === "check:reported_statement_warnings")).toBe(false);
    expect(out).toContain(`About these books (${notes.length})`);
  });
});

describe("Full book print", () => {
  const brand = { name: "Sample Studio", logoUrl: "/preview/books-sample-logo.svg", accentColor: "#fdb913" };
  const book = html(
    <FullBook brand={brand} statements={s} bank={fx.bank} accounts={fx.accounts} entries={fx.entries} totals={s.journalTotals} />,
  );
  const order = ["Summary", "Journal", "Balance Sheet", "Income Statement", "Cash Flow", "Checks"];

  it("has a cover with logo, entity and period, and a contents line", () => {
    expect(book).toContain('class="books-cover"');
    expect(book).toContain(s.entityName!);
    expect(book).toContain("Contents");
  });

  it("prints the six sections in the tab order, each on its own page", () => {
    const positions = order.map((t) => book.indexOf(`</span> ${t}</h2>`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(count(book, 'class="books-section')).toBe(6);
  });

  it("repeats the brand header and the running footer on every page", () => {
    expect(book).toContain("<thead");
    expect(book).toContain('class="books-frame-head');
    expect(book).toContain("Prepared in Pulse");
    expect(book).toContain("July 2026");
  });

  it("carries every journal entry, the posted totals, and the 18 highlighted differences", () => {
    expect(count(book, "books-avoid-break align-top")).toBe(48);
    expect(book).toContain("5,880.80");
    expect(count(book, "books-diff-flag")).toBe(18);
    expect(book).toContain("981.29");
    expect(book).toContain("1,611.29");
  });
});
