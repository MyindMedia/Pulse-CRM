/* ============================================================
   Anonymized books workbook for tests (openspec ledger-books-statements).

   Built from code, never from a real file. The shape, row numbers, dates,
   amounts, accounts, categories, payment types and every data-quality quirk
   (trailing spaces, slash spacing, an en dash, a text date "7//27/26" on row
   77, receipts "No" on rows 3 and 67, a credit line whose payment type
   differs from its debit line on rows 65-66) match a real studio's July 2026
   books. Every person and business is a neutral label (Client A, Vendor S1,
   Card B) and no account number appears anywhere.

   The double dot in the file name keeps Convex from deploying it.
   ============================================================ */

import type { GridCell, GridWorkbook } from "./lib/booksImport";

export type FixtureCell = string | number | { date: string } | { f: string; v: number } | null;
export type FixtureSheet = { name: string; rows: FixtureCell[][] };

export const JOURNAL_SHEET = "July Journal";
export const STATEMENTS_SHEET = "July Financial Statements";

/** Rows 3 to 98: Date | Description | Account | Category | Payment Type | Debit | Credit | Receipt. */
const JOURNAL_ROWS: FixtureCell[][] = [
  /* 3 */ [{ date: "2026-07-01" }, "Processor A monthly processing fee", "Merchant/Processing Expense", "Operating Expenses", "Bank Transfer", 51.4, null, "No"],
  /* 4 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 51.4, null],
  /* 5 */ [{ date: "2026-07-01" }, "Vendor S1 scheduling subscription - July 2026", "Software & Subscriptions Expense", "Operating Expenses", "Owner Personal Funds", 12, null, "Yes"],
  /* 6 */ [null, "Vendor S1 scheduling subscription - July 2026", "Owner's Equity / Capital ", "Equity", "Owner Personal Funds", null, 12, null],
  /* 7 */ [{ date: "2026-07-01" }, "Checking account monthly maintenance fee", "Bank Service Charges & Fees Expense", "Operating Expenses", "Bank Charge", 16, null, "Yes"],
  /* 8 */ [null, "Checking account monthly maintenance fee", "Bank / Cash", "Asset", "Bank Charge", null, 16, null],
  /* 9 */ [{ date: "2026-07-02" }, "Vendor S2 workspace subscription", "Software & Subscriptions Expense", "Operating Expenses", "Credit Card - [Card A]", 22, null, "Yes"],
  /* 10 */ [null, "Vendor S2 workspace subscription", "Credit Card Payable", "Credit Card Liability", "Credit Card - [Card A]", null, 22, null],
  /* 11 */ [{ date: "2026-07-02" }, "July rent and CAM - Landlord A", "Rent Expense", "Operating Expenses", "Bank Transfer", 1500, null, "Yes"],
  /* 12 */ [null, "Payment for rent and CAM - Landlord A", "Bank / Cash", "Asset", "Bank Transfer", null, 1500, null],
  /* 13 */ [{ date: "2026-07-02" }, "Landlord A online payment service fee", "Merchant/Processing Expense", "Operating Expenses", "Bank Transfer", 0.95, null, "Yes"],
  /* 14 */ [null, "Landlord A online payment service fee", "Bank / Cash", "Asset", "Bank Transfer", null, 0.95, null],
  /* 15 */ [{ date: "2026-07-03" }, "Contractor A - payment of June consultation payable", "Account's Payable / Accrued Expenses", "Liability ", "Zelle", 50, null, "Yes"],
  /* 16 */ [null, "Contractor A - payment from checking account", "Bank / Cash", "Asset", "Zelle", null, 50, null],
  /* 17 */ [{ date: "2026-07-03" }, "Client A - payment received, June studio time", "Bank / Cash", "Asset", "Zelle", 300, null, "Yes"],
  /* 18 */ [null, "Client A - June studio time balance", "Accounts Receivable", "Asset", "Zelle", null, 300, null],
  /* 19 */ [{ date: "2026-07-07" }, "Client B - Audio Stem Export & Delivery", "Bank / Cash", "Asset", "Zelle", 50, null, "Yes"],
  /* 20 */ [null, "Client B - Audio Stem Export & Delivery", "Revenue", "Revenue", "Zelle", null, 50, null],
  /* 21 */ [{ date: "2026-07-07" }, "Processor A monthly processing fee", "Merchant/Processing Expense", "Operating Expenses", "Bank Transfer", 2.5, null, "Yes"],
  /* 22 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 2.5, null],
  /* 23 */ [{ date: "2026-07-08" }, "Payment to Card B", "Credit Card Payable", "Credit Card Liability", "Bank Transfer", 140, null, "Yes"],
  /* 24 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 140, null],
  /* 25 */ [{ date: "2026-07-08" }, "Client C - Recording Studio Rental ", "Deposits In Transit", "Asset", "CashApp / Cash", 100, null, "Yes"],
  /* 26 */ [null, "Client C - Recording Studio Rental ", "Revenue", "Revenue", "CashApp / Cash", null, 100, null],
  /* 27 */ [{ date: "2026-07-10" }, "Card B interest charge", "Credit card Interest & Fees Expense", "Operating Expenses", "Credit Card - [Card B]", 12.83, null, "Yes"],
  /* 28 */ [null, "Card B interest charge", "Credit Card Payable", "Credit Card Liability", "Credit Card - [Card B]", null, 12.83, null],
  /* 29 */ [{ date: "2026-07-10" }, "Card B interest charge", "Credit card Interest & Fees Expense", "Operating Expenses", "Credit Card - [Card B]", 156.91, null, "Yes"],
  /* 30 */ [null, "Card B interest charge", "Credit Card Payable", "Credit Card Liability", "Credit Card - [Card B]", null, 156.91, null],
  /* 31 */ [{ date: "2026-07-14" }, "Owner funds contributed to checking account", "Bank / Cash ", "Asset", "Zelle", 568, null, "Yes"],
  /* 32 */ [null, "Owner's Contribution ", "Owner's Equity/Capital", "Equity", "Zelle", null, 568, null],
  /* 33 */ [{ date: "2026-07-14" }, "Payment to Card C", "Credit Card Payable", "Credit Card Liability", "Bank Transfer", 228, null, "Yes"],
  /* 34 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 228, null],
  /* 35 */ [{ date: "2026-07-14" }, "Payment to Card D", "Credit Card Payable", "Credit Card Liability", "Bank Transfer", 135, null, "Yes"],
  /* 36 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 135, null],
  /* 37 */ [{ date: "2026-07-15" }, "General liability insurance - Insurer A (monthly premium)", "Insurance Expenses", "Operating Expenses", "Bank Transfer", 92.36, null, "Yes"],
  /* 38 */ [null, "Payment from checking account", "Bank / Cash", "Asset", "Bank Transfer", null, 92.36, null],
  /* 39 */ [{ date: "2026-07-15" }, "Payment to Card A", "Credit Card Payable", "Credit Card Liability", "Bank Transfer", 78, null, "Yes"],
  /* 40 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 78, null],
  /* 41 */ [{ date: "2026-07-15" }, "Payment to Card F", "Credit Card Payable", "Credit Card Liability", "Bank Transfer", 69, null, "Yes"],
  /* 42 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 69, null],
  /* 43 */ [{ date: "2026-07-15" }, "Payment to Card E", "Credit Card Payable", "Credit Card Liability", "Bank Transfer", 58, null, "Yes"],
  /* 44 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 58, null],
  /* 45 */ [{ date: "2026-07-15" }, "Client C - Podcast Studio Rental ", "Deposits In Transit", "Asset", "CashApp/Cash", 80, null, "Yes"],
  /* 46 */ [null, "Client C - Podcast Studio Rental Revenue", "Revenue", "Revenue", "CashApp/Cash", null, 80, null],
  /* 47 */ [{ date: "2026-07-16" }, "Partner A investment deposit - ownership interest", "Business Funds Held by Owner", "Asset", "Apple Pay", 250, null, "Yes"],
  /* 48 */ [null, "Partner A investment deposit   ", "Partner Investment Deposits", "Current Liability", "Apple Pay", null, 250, null],
  /* 49 */ [{ date: "2026-07-17" }, "Client C - Recording Studio Rental ", "Deposits In Transit", "Asset", "CashApp / Cash", 100, null, "Yes"],
  /* 50 */ [null, "Client C - Recording Studio Rental ", "Revenue", "Revenue", "CashApp / Cash", null, 100, null],
  /* 51 */ [{ date: "2026-07-17" }, "Vendor S3 software subscription", "Software & Subscriptions Expense", "Equipment Expense", "Owner Personal Funds", 19.99, null, "Yes"],
  /* 52 */ [null, "Owner paid software subscription - Vendor S3", "Owner's Equity / Capital ", "Equity", "Owner Personal Funds", null, 19.99, null],
  /* 53 */ [{ date: "2026-07-20" }, "Vendor M1 - logo remake", "Advertising and Promotion Expense", "Operating Expenses", "Zelle", 25, null, "Yes"],
  /* 54 */ [null, "Payment to Vendor M1 from checking", "Bank / Cash", "Asset", "Zelle", null, 25, null],
  /* 55 */ [{ date: "2026-07-21" }, "Client D - July 29th Session Deposit", "Bank / Cash", "Asset", "Processor A", 25, null, "Yes"],
  /* 56 */ [null, "Client D - Unearned Session Deposit", "Unearned Revenue", "Liability ", "Processor A", null, 25, null],
  /* 57 */ [{ date: "2026-07-21" }, "Processing fee - Client D deposit", "Merchant/Processing Expense", "Operating Expenses", "Processor A", 1, null, "Yes"],
  /* 58 */ [null, "Processing fee - Client D deposit", "Bank / Cash", "Asset", "Processor A", null, 1, null],
  /* 59 */ [{ date: "2026-07-21" }, "Card C interest charge", "Credit card Interest & Fees Expense", "Operating Expenses", "Credit Card - [Card C]", 173.17, null, "Yes"],
  /* 60 */ [null, "Card C interest charge", "Credit Card Payable", "Credit Card Liability", "Credit Card - [Card C]", null, 173.17, null],
  /* 61 */ [{ date: "2026-07-21" }, "Card D interest charge", "Credit card Interest & Fees Expense", "Operating Expenses", "Credit Card - [Card D]", 102.53, null, "Yes"],
  /* 62 */ [null, "Card D interest charge", "Credit Card Payable", "Credit Card Liability", "Credit Card - [Card D]", null, 102.53, null],
  /* 63 */ [{ date: "2026-07-21" }, "Contractor B - credit toward future mastering services", "Prepaid Professional Services", "Asset", "Owner Personal Funds", 35, null, "Yes"],
  /* 64 */ [null, "Owner paid prepaid mastering services - Contractor B", "Owner's Equity / Capital", "Equity", "Owner Personal Funds", null, 35, null],
  /* 65 */ [{ date: "2026-07-21" }, "Client A - Recording Session", "Bank / Cash", "Asset", "Cash", 200, null, "Yes"],
  /* 66 */ [null, "Client A - Recording Studio Revenue", "Revenue", "Revenue", "Zelle", null, 200, null],
  /* 67 */ [{ date: "2026-07-21" }, "Personal expenditure by Owner", "Owner Draw / Distribution", "Equity", "Cash", 41, null, "No"],
  /* 68 */ [null, "Business funds used by Owner", "Bank / Cash", "Asset", "Cash", null, 41, null],
  /* 69 */ [{ date: "2026-07-24" }, "Vendor S4 podcast distribution subscription", "Software & Subscriptions Expense", "Operating Expenses", "Credit Card \u2013 [Card E]", 19, null, "Yes"],
  /* 70 */ [null, "Vendor S4 podcast distribution subscription", "Credit Card Payable", "Liability ", "Credit Card \u2013 [Card E]", null, 19, null],
  /* 71 */ [{ date: "2026-07-25" }, "Client C - Recording Studio Rental ", "Deposits In Transit", "Asset", "Cash", 100, null, "Yes"],
  /* 72 */ [null, "Client C - Recording Studio Rental ", "Revenue", "Revenue", "Cash", null, 100, null],
  /* 73 */ [{ date: "2026-07-26" }, "Client E - July 31st Session Deposit", "Bank / Cash", "Asset", "Processor A", 25, null, "Yes"],
  /* 74 */ [null, "Client E - Unearned Session Deposit", "Unearned Revenue", "Liability ", "Processor A", null, 25, null],
  /* 75 */ [{ date: "2026-07-26" }, "Processing fee - Client E deposit", "Merchant/Processing Expense", "Operating Expenses", "Processor A", 1, null, "Yes"],
  /* 76 */ [null, "Processing fee - Client E deposit", "Bank / Cash", "Asset", "Processor A", null, 1, null],
  /* 77 */ ["7//27/26", "Reimbursement of personal expenditure", "Bank / Cash", "Asset", "Zelle", 41, null, "Yes"],
  /* 78 */ [null, "Reversal of Owner Draw / Distribution", "Owner Draw / Distribution", "Equity", "Zelle", null, 41, null],
  /* 79 */ [{ date: "2026-07-27" }, "Client F - July 31st Session Deposit", "Bank / Cash", "Asset", "Processor A", 25, null, "Yes"],
  /* 80 */ [null, "Client F - Unearned Session Deposit", "Unearned Revenue", "Liability ", "Processor A", null, 25, null],
  /* 81 */ [{ date: "2026-07-27" }, "Processing fee - Client F deposit", "Merchant/Processing Expense", "Operating Expenses", "Processor A", 1, null, "Yes"],
  /* 82 */ [null, "Processing fee - Client F deposit", "Bank / Cash", "Asset", "Processor A", null, 1, null],
  /* 83 */ [{ date: "2026-07-27" }, "Internet service - Vendor U1", "Internet Expense", "Operating Expenses", "Bank Transfer", 75, null, "Yes"],
  /* 84 */ [null, "Payment from checking account", "Bank / Cash ", "Asset", "Bank Transfer", null, 75, null],
  /* 85 */ [{ date: "2026-07-29" }, "Client G - 50% upfront payment for mix and master of 2 songs", "Bank / Cash ", "Asset", "Zelle", 75, null, "Yes"],
  /* 86 */ [null, "Client G - mix and master advance", "Unearned Revenue", "liability", "Zelle", null, 75, null],
  /* 87 */ [{ date: "2026-07-29" }, "Client D - Recording Session (remaining balance received)", "Bank / Cash", "Asset", "Cash", 175, null, "Yes"],
  /* 88 */ [null, "Client D - Recording Session Revenue", "Revenue", "Revenue", "Cash", null, 175, null],
  /* 89 */ [{ date: "2026-07-30" }, "Client A - Recording Session", "Bank / Cash", "Asset", "Cash", 200, null, "Yes"],
  /* 90 */ [null, "Client A - Recording Studio Revenue", "Revenue", "Revenue", "Cash", null, 200, null],
  /* 91 */ [{ date: "2026-07-30" }, "Client E - Recording Session (remaining balance received)", "Bank / Cash", "Asset", "Cash", 175, null, "Yes"],
  /* 92 */ [null, "Client E - Recording Session Revenue", "Revenue", "Revenue", "Cash", null, 175, null],
  /* 93 */ [{ date: "2026-07-31" }, "Client F - Recording Session (remaining balance received)", "Deposits In Transit", "Asset", "Zelle", 75, null, "Yes"],
  /* 94 */ [null, "Client F - Recording Session Revenue", "Revenue", "Revenue", "Zelle", null, 75, null],
  /* 95 */ [{ date: "2026-07-31" }, "Vendor M2 ads - July 2026 (monthly total)", "Advertising and Promotion Expense", "Marketing / Advertising ", "Owner Personal Funds", 148.16, null, "Yes"],
  /* 96 */ [null, "Owner paid Vendor M2 ads - July", "Owner's Equity / Capital ", "-", "Owner Personal Funds", null, 148.16, null],
  /* 97 */ [{ date: "2026-07-31" }, "Month-end adjustment - apply completed July session deposits: Client D and Client F", "Unearned Revenue", "Liability ", "Non-Cash Adjustment", 50, null, "Yes"],
  /* 98 */ [null, "Recognition of completed July session deposits", "Revenue", "Revenue", "Non-Cash Adjustment", null, 50, null],
];

const F = (f: string, v: number) => ({ f, v });

/** The statements tab: Balance Sheet in A:B, Income Statement in D:E, Cash
 *  Flow in G:H, typed-in numbers and the same formulas as the original. */
function statementsRows(): FixtureCell[][] {
  const rows: FixtureCell[][] = Array.from({ length: 41 }, () => Array<FixtureCell>(8).fill(null));
  const put = (cell: string, value: FixtureCell) => {
    const m = /^([A-H])(\d+)$/.exec(cell)!;
    rows[Number(m[2]) - 1][m[1].charCodeAt(0) - 65] = value;
  };
  for (const c of ["A1", "D1", "G1"]) put(c, "Studio Entity LLC");
  put("A2", "Balance Sheet"); put("D2", "Income Statement"); put("G2", "Cash Flow Statement ");
  put("A3", "As of July 31, 2026"); put("D3", "For The Month Ended July 31, 2026"); put("G3", "For The Month Ended July 31, 2026");
  // Balance sheet
  put("A5", "ASSETS"); put("A6", "Current Assets");
  put("A7", "Cash"); put("B7", 1611.29);
  put("A8", "Business Funds Held by Owner"); put("B8", 0);
  put("A9", "Deposits in Transit"); put("B9", 0);
  put("A10", "Security Deposit"); put("B10", 1500);
  put("A11", "Non-Current Assets");
  put("A12", "Studio Equipment (Capitalized) "); put("B12", 23809.53);
  put("A13", "Furniture & Fixturees "); put("B13", 1349.68);
  put("A14", "Security Equipment"); put("B14", 803.06);
  put("A15", "Prepaid Professional Services"); put("B15", 35);
  put("A16", "TOTAL ASSETS"); put("B16", F("SUM(B7:B15)", 29108.56));
  put("A18", "LIABILITIES"); put("A19", "Current Liabilities");
  put("A20", "Credit Card Payable"); put("B20", 35005.81);
  put("A21", "Partner Investment Deposits"); put("B21", 750);
  put("A22", "Installment Payable"); put("B22", 737.79);
  put("A23", "Unearned Revenue "); put("B23", 200);
  put("A25", "TOTAL LIABILITIES"); put("B25", F("SUM(B20:B24)", 36693.6));
  put("A27", "EQUITY");
  put("A28", "Owner Contributions"); put("B28", 28177.55);
  put("A29", "Retained Earnings"); put("B29", F("B16-B25-B28", -35762.59));
  put("A30", "Total Equity"); put("B30", F("B16-B25", -7585.039999999997));
  put("A32", "TOTAL LIABILITIES + EQUITY"); put("B32", F("B25+B30", 29108.56));
  // Income statement
  put("D5", "Revenue");
  put("D6", "Recording Session Revenue"); put("E6", 1175);
  put("D7", "Podcast Studio Revenue"); put("E7", 80);
  put("D8", "Other Audio Audio Services"); put("E8", 50);
  put("D9", "Consultation Revenue"); put("E9", 0);
  put("D10", "Other Income (card cash back reward)"); put("E10", 0);
  put("D11", "Total Revenue"); put("E11", F("SUM(E6:E10)", 1305));
  put("D13", "Expenses");
  put("D14", "Rent Expense"); put("E14", 1500);
  put("D15", "Credit Card Interest and Fees"); put("E15", 445.44);
  put("D16", "Advertising & Promotion"); put("E16", 173.16);
  put("D17", "Insurance Expense"); put("E17", 92.36);
  put("D18", "Internet Expense"); put("E18", 75);
  put("D19", "Merchant / Processing Fees"); put("E19", 57.85);
  put("D20", "Software & Subscriptions"); put("E20", 53.99);
  put("D21", "Bank Service Charges & Fees"); put("E21", 16);
  put("D26", "Total Expenses"); put("E26", F("SUM(E14:E25)", 2413.7999999999997));
  put("D27", "Net Income (Loss)"); put("E27", F("E11-E26", -1108.7999999999997));
  // Cash flow
  put("G5", "Cash Flows from Operating Activities"); put("G6", "Description");
  put("G7", "Cash received from customers"); put("H7", 1586);
  put("G8", "Rent payments"); put("H8", -1500);
  put("G9", "Merchant processing fees"); put("H9", -54.85);
  put("G10", "Professional services"); put("H10", -50);
  put("G11", "Insurance"); put("H11", -92.36);
  put("G12", "Internet"); put("H12", -75);
  put("G13", "Advertisting / Promotion"); put("H13", -25);
  put("G14", "Bank service fees"); put("H14", -16);
  put("G15", "Net Cash from Operating Activities"); put("H15", F("SUM(H7:H14)", -227.21));
  put("G17", "Cash Flows for Financing Activites"); put("G18", "Description");
  put("G19", "Owner contributions deposited"); put("H19", 568);
  put("G20", "Partner investment deposit"); put("H20", 250);
  put("G21", "Owner reimbusement of prior personal expenditure"); put("H21", 41);
  put("G22", "Credit card payments"); put("H22", -708);
  put("G24", "Net cash provided by Financing Acitvities "); put("H24", F("SUM(H19:H23)", 151));
  put("G26", "Cash Flows from Investing Activities");
  put("G27", "None"); put("H27", 0);
  put("G28", "Net Cash Used in Investing Activities "); put("H28", F("H27", 0));
  put("G30", "Net Change in Cash"); put("G31", "Description");
  put("G32", "Operating Activities"); put("H32", F("H15", -227.21));
  put("G33", "Financing Activities"); put("H33", F("H24", 151));
  put("G34", "Investing Activities"); put("H34", F("H28", 0));
  put("G35", "Net Change in Cash"); put("H35", F("SUM(H32:H34)", -76.21000000000001));
  put("G37", "Cash Reconciliation"); put("G38", "Description");
  put("G39", "Beginning Cash Balance May 1, 2026)"); put("H39", 1687.5);
  put("G40", "Net Change in Cash"); put("H40", F("H35", -76.21000000000001));
  put("G41", "Ending Cash Balance (July 31, 2026)"); put("H41", F("H39+H40", 1611.29));
  return rows;
}

export function booksFixture(): FixtureSheet[] {
  const header: FixtureCell[] = ["Date", "Description / Purpose", "Account", "Expense Category ", "Payment Type ", "Debit (-)", "Credit (+)", "Receipt (Yes/No)"];
  return [
    { name: JOURNAL_SHEET, rows: [["July", null, null, null, null, null, null, null], header, ...JOURNAL_ROWS] },
    { name: STATEMENTS_SHEET, rows: statementsRows() },
  ];
}

/** The fixture straight to the parser's grid, no spreadsheet library. */
export function booksFixtureGrid(): GridWorkbook {
  return {
    sheets: booksFixture().map((s) => ({
      name: s.name,
      rows: s.rows.map((r) => r.map((c): GridCell => {
        if (c === null) return { v: null };
        if (typeof c === "object" && "date" in c) return { v: c.date, date: c.date };
        if (typeof c === "object") return { v: c.v, f: c.f };
        return { v: c };
      })),
    })),
  };
}

type SheetJsLike = {
  utils: {
    book_new: () => unknown;
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    encode_cell: (c: { r: number; c: number }) => string;
    encode_range: (r: { s: { r: number; c: number }; e: { r: number; c: number } }) => string;
  };
};

/** The fixture as a SheetJS workbook (dates as serial numbers formatted
 *  m/d/yy, formulas with their saved values), ready for XLSX.write. */
export function booksFixtureWorkbook(XLSX: SheetJsLike): unknown {
  const wb = XLSX.utils.book_new();
  for (const s of booksFixture()) {
    const ws: Record<string, unknown> = {};
    let maxC = 0;
    s.rows.forEach((row, r) => row.forEach((c, col) => {
      if (c === null) return;
      maxC = Math.max(maxC, col);
      const addr = XLSX.utils.encode_cell({ r, c: col });
      if (typeof c === "number") ws[addr] = { t: "n", v: c };
      else if (typeof c === "string") ws[addr] = { t: "s", v: c };
      else if ("date" in c) {
        const [y, m, d] = c.date.split("-").map(Number);
        ws[addr] = { t: "n", v: (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000, z: "m/d/yy" };
      } else ws[addr] = { t: "n", v: c.v, f: c.f };
    }));
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length - 1, c: maxC } });
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return wb;
}
