/* ============================================================
   Books import: an owner's monthly workbook into the ledger.

   Pure: no Convex imports and no spreadsheet library. The input is a
   neutral grid (see GridWorkbook); the CLI and the tests turn an .xlsx
   into one with `gridFromSheetJs`, passing the `xlsx` module in.

   Two tabs:
     journal      Date | Description | Account | Category | Payment Type |
                  Debit | Credit | Receipt. A dated row starts an entry;
                  the undated rows after it are its other lines.
     statements   Balance Sheet, Income Statement and Cash Flow side by side,
                  each a label column with the value in the next column.

   Nothing is fixed silently. Every normalization and every anomaly is a
   warning with its sheet and row, so the owner can see what changed.

   openspec/changes/ledger-books-statements
   ============================================================ */

import {
  type AccountSubtype,
  type AccountType,
  type EntryLine,
  type LedgerAccount,
  type LedgerEntry,
  type NormalBalance,
  type Period,
  type ReceiptStatus,
  LedgerValidationError,
  assertBalancedLines,
  dayFromParts,
  entryContentHash,
  formatCents,
  isoDay,
  parsePeriod,
  stableHash,
  toCents,
  DAY_MS,
} from "./ledgerMath";
import {
  type BankStatementBalance,
  type ImportWarning,
  type LineKind,
  type ReportedLine,
  type ReportedStatements,
  buildStatements,
  impliedOpeningBalances,
} from "./statements";

// ── Grid ────────────────────────────────────────────────────

/** One cell. `v` is the value (the cached result for a formula), `f` the
 *  formula without its leading "=", `date` an ISO day when the cell is a date. */
export type GridCell = { v: string | number | boolean | null; f?: string; date?: string };
export type GridSheet = { name: string; rows: GridCell[][] };
export type GridWorkbook = { sheets: GridSheet[] };

/** Minimal structural types for the parts of SheetJS we use. */
type SheetJsCell = { t?: string; v?: unknown; f?: string; z?: string; w?: string };
type SheetJsSheet = Record<string, unknown> & { "!ref"?: string };
type SheetJsModule = {
  utils: { decode_range: (r: string) => { s: { r: number; c: number }; e: { r: number; c: number } }; encode_cell: (c: { r: number; c: number }) => string };
  SSF: { is_date: (fmt: string) => boolean; parse_date_code: (v: number) => { y: number; m: number; d: number } };
};

/** SheetJS workbook (read with { cellFormula: true, cellDates: false }) to a grid. */
export function gridFromSheetJs(
  wb: { SheetNames: string[]; Sheets: Record<string, SheetJsSheet> },
  XLSX: SheetJsModule,
): GridWorkbook {
  return {
    sheets: wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name];
      const ref = ws["!ref"];
      if (!ref) return { name, rows: [] };
      const range = XLSX.utils.decode_range(ref);
      const rows: GridCell[][] = [];
      for (let r = 0; r <= range.e.r; r++) {
        const row: GridCell[] = [];
        for (let c = 0; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })] as SheetJsCell | undefined;
          if (!cell || (cell.v === undefined && !cell.f)) {
            row.push({ v: null });
            continue;
          }
          const out: GridCell = { v: (cell.v as GridCell["v"]) ?? null };
          if (cell.f) out.f = cell.f;
          if (cell.t === "d" && cell.v instanceof Date) {
            out.date = cell.v.toISOString().slice(0, 10);
          } else if (cell.t === "n" && typeof cell.v === "number" && cell.z && XLSX.SSF.is_date(cell.z)) {
            const p = XLSX.SSF.parse_date_code(cell.v);
            out.date = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
          }
          row.push(out);
        }
        rows.push(row);
      }
      return { name, rows };
    }),
  };
}

// ── Default studio chart of accounts ────────────────────────

export type ChartAccount = {
  key: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  statementLine: string;
  sortOrder: number;
  normalBalance: NormalBalance;
  isCash?: boolean;
  isClearing?: boolean;
  cashFlowLine?: string;
  cashFlowLineInflow?: string;
  /** Other spellings seen in owners' books. Matched after normalization. */
  aliases?: string[];
};

const A = (
  key: string, name: string, type: AccountType, subtype: AccountSubtype, statementLine: string,
  sortOrder: number, extra: Partial<ChartAccount> = {},
): ChartAccount => ({
  key, name, type, subtype, statementLine, sortOrder,
  normalBalance: type === "asset" || type === "expense" ? "debit" : "credit",
  ...extra,
});

/** A recording studio's chart, seeded from a real studio's books. The names
 *  are the studio's own; a studio can rename any of them. */
export const DEFAULT_STUDIO_CHART: readonly ChartAccount[] = [
  A("bank_cash", "Bank / Cash", "asset", "current_asset", "asset.cash", 100, { isCash: true, aliases: ["Cash", "Bank", "Checking"] }),
  A("accounts_receivable", "Accounts Receivable", "asset", "current_asset", "asset.accounts_receivable", 110, { cashFlowLine: "operating.customer_receipts" }),
  A("deposits_in_transit", "Deposits In Transit", "asset", "current_asset", "asset.deposits_in_transit", 120, { isClearing: true, cashFlowLine: "operating.customer_receipts" }),
  A("business_funds_held_by_owner", "Business Funds Held by Owner", "asset", "current_asset", "asset.business_funds_held_by_owner", 130, { isClearing: true, cashFlowLine: "financing.owner_held_funds" }),
  A("security_deposit", "Security Deposit", "asset", "current_asset", "asset.security_deposit", 140, { cashFlowLine: "investing.security_deposit" }),
  A("prepaid_professional_services", "Prepaid Professional Services", "asset", "current_asset", "asset.prepaid_professional_services", 150, { cashFlowLine: "operating.prepaid_services" }),
  A("studio_equipment", "Studio Equipment (Capitalized)", "asset", "noncurrent_asset", "asset.studio_equipment", 200, { cashFlowLine: "investing.equipment", aliases: ["Studio Equipment"] }),
  A("furniture_fixtures", "Furniture & Fixtures", "asset", "noncurrent_asset", "asset.furniture_fixtures", 210, { cashFlowLine: "investing.equipment", aliases: ["Furniture & Fixturees", "Furniture and Fixtures"] }),
  A("security_equipment", "Security Equipment", "asset", "noncurrent_asset", "asset.security_equipment", 220, { cashFlowLine: "investing.equipment" }),
  A("accounts_payable", "Account's Payable / Accrued Expenses", "liability", "current_liability", "liability.accounts_payable", 300, { cashFlowLine: "operating.professional_services", aliases: ["Accounts Payable / Accrued Expenses", "Accounts Payable", "Accrued Expenses"] }),
  A("credit_card_payable", "Credit Card Payable", "liability", "current_liability", "liability.credit_card_payable", 310, { cashFlowLine: "financing.credit_card_payments" }),
  A("partner_investment_deposits", "Partner Investment Deposits", "liability", "current_liability", "liability.partner_investment_deposits", 320, { cashFlowLine: "financing.partner_deposits" }),
  A("installment_payable", "Installment Payable", "liability", "current_liability", "liability.installment_payable", 330, { cashFlowLine: "financing.installment_payments" }),
  A("unearned_revenue", "Unearned Revenue", "liability", "current_liability", "liability.unearned_revenue", 340, { cashFlowLine: "operating.customer_receipts", aliases: ["Customer Deposits"] }),
  A("owner_equity_capital", "Owner's Equity / Capital", "equity", "owner_equity", "equity.owner_contributions", 400, { cashFlowLine: "financing.owner_contributions", aliases: ["Owner's Equity", "Owner Contributions", "Owners Equity / Capital"] }),
  A("owner_draw", "Owner Draw / Distribution", "equity", "owner_draw", "equity.owner_draws", 410, { normalBalance: "debit", cashFlowLine: "financing.owner_draws", cashFlowLineInflow: "financing.owner_reimbursement", aliases: ["Owner Draw", "Owner Distribution"] }),
  A("retained_earnings", "Retained Earnings", "equity", "retained_earnings", "equity.retained_earnings", 420),
  A("revenue_recording", "Recording Session Revenue", "revenue", "operating_revenue", "revenue.recording_session", 500, { cashFlowLine: "operating.customer_receipts" }),
  A("revenue_podcast", "Podcast Studio Revenue", "revenue", "operating_revenue", "revenue.podcast_studio", 510, { cashFlowLine: "operating.customer_receipts" }),
  A("revenue_other_audio", "Other Audio Services Revenue", "revenue", "operating_revenue", "revenue.other_audio_services", 520, { cashFlowLine: "operating.customer_receipts" }),
  A("revenue_consultation", "Consultation Revenue", "revenue", "operating_revenue", "revenue.consultation", 530, { cashFlowLine: "operating.customer_receipts" }),
  A("other_income", "Other Income", "revenue", "other_income", "revenue.other_income", 540, { cashFlowLine: "operating.other" }),
  A("rent", "Rent Expense", "expense", "operating_expense", "expense.rent", 600, { cashFlowLine: "operating.rent" }),
  A("cc_interest_fees", "Credit Card Interest & Fees Expense", "expense", "operating_expense", "expense.credit_card_interest_fees", 610, { cashFlowLine: "operating.interest_and_card_fees" }),
  A("advertising", "Advertising and Promotion Expense", "expense", "operating_expense", "expense.advertising_promotion", 620, { cashFlowLine: "operating.advertising" }),
  A("insurance", "Insurance Expenses", "expense", "operating_expense", "expense.insurance", 630, { cashFlowLine: "operating.insurance", aliases: ["Insurance Expense"] }),
  A("internet", "Internet Expense", "expense", "operating_expense", "expense.internet", 640, { cashFlowLine: "operating.internet" }),
  A("merchant_processing", "Merchant/Processing Expense", "expense", "operating_expense", "expense.merchant_processing", 650, { cashFlowLine: "operating.processing_fees", aliases: ["Merchant / Processing Fees", "Processing Fees"] }),
  A("software", "Software & Subscriptions Expense", "expense", "operating_expense", "expense.software_subscriptions", 660, { cashFlowLine: "operating.software" }),
  A("bank_service", "Bank Service Charges & Fees Expense", "expense", "operating_expense", "expense.bank_service_charges", 670, { cashFlowLine: "operating.bank_fees" }),
];

/** The single "Revenue" account many owners use, split into the chart's
 *  revenue lines by what the description says. */
const GENERIC_REVENUE = "revenue";

export function normalizeName(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function slug(s: string): string {
  return normalizeName(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function chartLookup(chart: readonly ChartAccount[]): Map<string, ChartAccount> {
  const m = new Map<string, ChartAccount>();
  for (const a of chart) {
    m.set(normalizeName(a.name), a);
    for (const alias of a.aliases ?? []) if (!m.has(normalizeName(alias))) m.set(normalizeName(alias), a);
  }
  return m;
}

// ── Normalizers ─────────────────────────────────────────────

export type PaymentKind =
  | "bank_transfer" | "bank_charge" | "credit_card" | "owner_personal_funds" | "zelle"
  | "cashapp_or_cash" | "cash" | "apple_pay" | "non_cash_adjustment" | "other";

export const PAYMENT_KINDS: readonly PaymentKind[] = [
  "bank_transfer", "bank_charge", "credit_card", "owner_personal_funds", "zelle",
  "cashapp_or_cash", "cash", "apple_pay", "non_cash_adjustment", "other",
];

export type PaymentType = { kind: PaymentKind; raw?: string; card?: string };

/** Canonical display form: dashes plain, one space either side of a slash. */
function tidyLabel(s: string): string {
  return s.replace(/[–—]/g, "-").replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
}

export function normalizePaymentType(raw: string): PaymentType & { canonical: string } {
  const canonical = tidyLabel(raw);
  const t = canonical.toLowerCase();
  const card = /\[([^\]]+)\]/.exec(canonical)?.[1]?.trim();
  let kind: PaymentKind = "other";
  if (t.startsWith("credit card")) kind = "credit_card";
  else if (t.startsWith("bank transfer") || t === "ach" || t.startsWith("wire")) kind = "bank_transfer";
  else if (t.startsWith("bank charge")) kind = "bank_charge";
  else if (t.startsWith("owner personal funds") || t.startsWith("owner funds")) kind = "owner_personal_funds";
  else if (t.startsWith("zelle")) kind = "zelle";
  else if (/^cash ?app/.test(t)) kind = "cashapp_or_cash";
  else if (t === "cash") kind = "cash";
  else if (t.startsWith("apple pay")) kind = "apple_pay";
  else if (t.startsWith("non-cash") || t.startsWith("non cash")) kind = "non_cash_adjustment";
  return { kind, raw, canonical, ...(card ? { card } : {}) };
}

const STANDARD_CATEGORIES = [
  "Asset", "Liability", "Current Liability", "Credit Card Liability", "Equity", "Revenue", "Operating Expenses",
];

function categoryImpliedType(c: string): AccountType | null {
  const t = c.toLowerCase();
  if (t.includes("asset")) return "asset";
  if (t.includes("liabilit")) return "liability";
  if (t.includes("equity")) return "equity";
  if (t.includes("revenue") || t.includes("income")) return "revenue";
  if (t.includes("expense") || t.includes("marketing") || t.includes("advertising")) return "expense";
  return null;
}

/** Parse a journal date: a date cell, an ISO day, an Excel serial, or text
 *  such as "7/27/26" or the doubled slash "7//27/26". */
function parseDateCell(cell: GridCell): { ms: number; text: boolean; raw: string } | null {
  if (cell.date) {
    const [y, m, d] = cell.date.split("-").map(Number);
    return { ms: dayFromParts(y, m, d), text: false, raw: cell.date };
  }
  if (typeof cell.v === "number" && cell.v > 20000 && cell.v < 80000) {
    return { ms: Date.UTC(1899, 11, 30) + Math.round(cell.v) * DAY_MS, text: false, raw: String(cell.v) };
  }
  if (typeof cell.v === "string" && cell.v.trim()) {
    const raw = cell.v.trim();
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
    if (iso) return { ms: dayFromParts(+iso[1], +iso[2], +iso[3]), text: true, raw };
    const us = /^(\d{1,2})\s*\/+\s*(\d{1,2})\s*\/+\s*(\d{2,4})$/.exec(raw);
    if (us) {
      const y = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
      return { ms: dayFromParts(y, +us[1], +us[2]), text: true, raw };
    }
  }
  return null;
}

function cellText(cell: GridCell | undefined): string {
  if (!cell || cell.v === null || cell.v === undefined) return "";
  return String(cell.v);
}

function cellNumber(cell: GridCell | undefined): number | null {
  if (!cell || cell.v === null || cell.v === "") return null;
  if (typeof cell.v === "number") return cell.v;
  if (typeof cell.v === "string") {
    const s = cell.v.replace(/[$,\s]/g, "");
    if (!s) return null;
    const n = Number(s.replace(/^\((.*)\)$/, "-$1"));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── Journal ─────────────────────────────────────────────────

export type ParsedLine = {
  accountKey: string;
  debitCents: number;
  creditCents: number;
  memo?: string;
};

export type ParsedEntry = {
  entryDate: number;
  memo: string;
  paymentType: PaymentType;
  receiptStatus: ReceiptStatus;
  sourceRef: string;
  rowStart: number;
  rowEnd: number;
  contentHash: string;
  lines: ParsedLine[];
};

type RawRow = {
  row: number;
  date: GridCell;
  description: string;
  account: string;
  category: string;
  payment: string;
  debit: number | null;
  credit: number | null;
  receipt: string;
};

function findHeader(sheet: GridSheet): { row: number; cols: Record<string, number> } {
  for (let r = 0; r < Math.min(sheet.rows.length, 20); r++) {
    const texts = sheet.rows[r].map((c) => normalizeName(cellText(c)));
    const dateCol = texts.findIndex((t) => t === "date");
    const accountCol = texts.findIndex((t) => t.startsWith("account"));
    if (dateCol < 0 || accountCol < 0) continue;
    const find = (re: RegExp) => texts.findIndex((t) => re.test(t));
    const cols = {
      date: dateCol,
      description: find(/description|purpose|memo/),
      account: accountCol,
      category: find(/category/),
      payment: find(/payment/),
      debit: find(/^debit/),
      credit: find(/^credit/),
      receipt: find(/receipt/),
    };
    if (cols.debit < 0 || cols.credit < 0) continue;
    return { row: r, cols };
  }
  throw new LedgerValidationError(`No journal header row (Date, Account, Debit, Credit) found on "${sheet.name}".`);
}

function pickRevenueAccount(text: string): { key: string; matched: boolean } {
  const t = text.toLowerCase();
  if (/podcast/.test(t)) return { key: "revenue_podcast", matched: true };
  if (/record|session|studio time|studio rental|tracking/.test(t)) return { key: "revenue_recording", matched: true };
  if (/stem|export|mix|master|edit|deliver|audio/.test(t)) return { key: "revenue_other_audio", matched: true };
  if (/consult/.test(t)) return { key: "revenue_consultation", matched: true };
  return { key: "revenue_recording", matched: false };
}

export function parseJournal(
  sheet: GridSheet,
  period: Period,
  chartIn: readonly ChartAccount[] = DEFAULT_STUDIO_CHART,
): { entries: ParsedEntry[]; chart: ChartAccount[]; warnings: ImportWarning[]; stats: { lines: number; totalDebitCents: number; totalCreditCents: number } } {
  const chart = [...chartIn];
  const lookup = chartLookup(chart);
  const warnings: ImportWarning[] = [];
  const W = (w: Omit<ImportWarning, "sheet">) => warnings.push({ sheet: sheet.name, ...w });
  const { row: headerRow, cols } = findHeader(sheet);
  const at = (r: GridCell[], c: number) => (c >= 0 ? r[c] : undefined);

  // Collect raw rows, grouped into entries by the dated row that starts each.
  const groups: RawRow[][] = [];
  let lines = 0;
  let totalDebitCents = 0;
  let totalCreditCents = 0;
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r];
    const raw: RawRow = {
      row: r + 1,
      date: at(cells, cols.date) ?? { v: null },
      description: cellText(at(cells, cols.description)),
      account: cellText(at(cells, cols.account)),
      category: cellText(at(cells, cols.category)),
      payment: cellText(at(cells, cols.payment)),
      debit: cellNumber(at(cells, cols.debit)),
      credit: cellNumber(at(cells, cols.credit)),
      receipt: cellText(at(cells, cols.receipt)),
    };
    const hasDate = raw.date.v !== null && raw.date.v !== "" || !!raw.date.date;
    if (!raw.account.trim() && raw.debit === null && raw.credit === null && !hasDate) continue;
    lines++;
    if (raw.debit) totalDebitCents += toCents(raw.debit);
    if (raw.credit) totalCreditCents += toCents(raw.credit);
    if (hasDate || !groups.length) {
      if (!hasDate) W({ code: "line_without_entry", severity: "error", row: raw.row, message: `Row ${raw.row} has no date and no entry above it to belong to.` });
      groups.push([raw]);
    } else {
      groups[groups.length - 1].push(raw);
    }
  }

  const resolveAccount = (raw: RawRow, entryText: string): string => {
    const trimmed = raw.account.trim();
    const norm = normalizeName(trimmed);
    if (norm === GENERIC_REVENUE) {
      const pick = pickRevenueAccount(`${raw.description} ${entryText}`);
      const target = chart.find((a) => a.key === pick.key)!;
      W({
        code: pick.matched ? "revenue_line_inferred" : "revenue_line_default",
        severity: pick.matched ? "info" : "warn",
        row: raw.row, raw: raw.account, normalized: target.name,
        message: pick.matched
          ? `Row ${raw.row}: "Revenue" booked to ${target.name} from the description.`
          : `Row ${raw.row}: "Revenue" had no recognisable service in the description; booked to ${target.name}.`,
      });
      return target.key;
    }
    const hit = lookup.get(norm);
    if (hit) {
      if (raw.account !== hit.name) {
        W({ code: "account_name_variant", severity: "info", row: raw.row, raw: raw.account, normalized: hit.name, message: `Row ${raw.row}: account "${raw.account}" read as "${hit.name}".` });
      }
      return hit.key;
    }
    // Unknown account: keep it, unclassified, so the checks flag it.
    const key = `custom_${slug(trimmed)}`;
    if (!chart.some((a) => a.key === key)) {
      const type = categoryImpliedType(raw.category) ?? "expense";
      const added: ChartAccount = {
        key, name: tidyLabel(trimmed), type,
        subtype: type === "asset" ? "current_asset" : type === "liability" ? "current_liability" : type === "equity" ? "owner_equity" : type === "revenue" ? "operating_revenue" : "operating_expense",
        statementLine: `unmapped.${key}`, sortOrder: 900 + chart.length,
        normalBalance: type === "asset" || type === "expense" ? "debit" : "credit",
      };
      chart.push(added);
      lookup.set(norm, added);
      W({ code: "unknown_account", severity: "error", row: raw.row, raw: raw.account, normalized: added.name, message: `Row ${raw.row}: account "${trimmed}" is not in the chart. Added as an unclassified ${type} account.` });
    }
    return key;
  };

  const entries: ParsedEntry[] = [];
  const seen = new Map<string, number>();
  for (const g of groups) {
    const first = g[0];
    const rowStart = first.row;
    const rowEnd = g[g.length - 1].row;
    const date = parseDateCell(first.date);
    if (!date) {
      W({ code: "bad_date", severity: "error", row: rowStart, raw: cellText(first.date), message: `Row ${rowStart}: date "${cellText(first.date)}" cannot be read. Entry skipped.` });
      continue;
    }
    if (date.text) {
      W({ code: "text_date_normalized", severity: "warn", row: rowStart, raw: date.raw, normalized: isoDay(date.ms), message: `Row ${rowStart}: text date "${date.raw}" read as ${isoDay(date.ms)}.` });
    }
    if (date.ms < period.start || date.ms >= period.end) {
      W({ code: "entry_outside_period", severity: "warn", row: rowStart, normalized: isoDay(date.ms), message: `Row ${rowStart}: dated ${isoDay(date.ms)}, outside ${period.key}.` });
    }
    const entryText = g.map((r) => r.description).join(" ");
    const parsedLines: ParsedLine[] = [];
    let bad = false;
    for (const r of g) {
      if (r.debit !== null && r.credit !== null && r.debit !== 0 && r.credit !== 0) {
        W({ code: "line_both_sides", severity: "error", row: r.row, message: `Row ${r.row} has both a debit and a credit.` });
        bad = true;
      }
      if (!r.account.trim()) {
        W({ code: "line_without_account", severity: "error", row: r.row, message: `Row ${r.row} has an amount but no account.` });
        bad = true;
        continue;
      }
      // Category: informational, but variants and contradictions are worth a look.
      const cat = r.category;
      const catTidy = tidyLabel(cat);
      const std = STANDARD_CATEGORIES.find((c) => c.toLowerCase() === catTidy.toLowerCase());
      if (!catTidy || catTidy === "-") {
        W({ code: "category_missing", severity: "warn", row: r.row, raw: cat, message: `Row ${r.row}: category "${cat}" is blank or a dash.` });
      } else if (std && cat !== std) {
        W({ code: "category_variant", severity: "info", row: r.row, raw: cat, normalized: std, message: `Row ${r.row}: category "${cat}" read as "${std}".` });
      } else if (!std) {
        W({ code: "category_nonstandard", severity: "info", row: r.row, raw: cat, message: `Row ${r.row}: category "${cat}" is not one the books use elsewhere.` });
      }
      const accountKey = resolveAccount(r, entryText);
      const account = chart.find((a) => a.key === accountKey)!;
      const implied = catTidy && catTidy !== "-" ? categoryImpliedType(catTidy) : null;
      if (implied && implied !== account.type) {
        W({ code: "category_conflict", severity: "warn", row: r.row, raw: cat, normalized: account.type, message: `Row ${r.row}: category "${cat}" says ${implied}, but ${account.name} is ${account.type === "asset" ? "an asset" : `a ${account.type}`} account.` });
      }
      let debitCents = 0;
      let creditCents = 0;
      try {
        debitCents = r.debit ? toCents(r.debit) : 0;
        creditCents = r.credit ? toCents(r.credit) : 0;
      } catch (e) {
        W({ code: "bad_amount", severity: "error", row: r.row, message: `Row ${r.row}: ${(e as Error).message}` });
        bad = true;
      }
      if (debitCents < 0 || creditCents < 0) {
        W({ code: "negative_amount", severity: "error", row: r.row, message: `Row ${r.row}: negative amount.` });
        bad = true;
      }
      parsedLines.push({ accountKey, debitCents, creditCents, ...(r.description.trim() ? { memo: r.description.trim() } : {}) });
    }

    // Payment type: normalized per line; the entry takes the first line's.
    const pts = g.filter((r) => r.payment.trim()).map((r) => ({ r, pt: normalizePaymentType(r.payment) }));
    for (const { r, pt } of pts) {
      if (pt.canonical !== r.payment) {
        W({ code: "payment_type_variant", severity: "info", row: r.row, raw: r.payment, normalized: pt.canonical, message: `Row ${r.row}: payment type "${r.payment}" read as "${pt.canonical}".` });
      }
      if (pt.kind === "other") {
        W({ code: "payment_type_unrecognized", severity: "info", row: r.row, raw: r.payment, message: `Row ${r.row}: payment type "${r.payment}" kept as written (no standard kind).` });
      }
    }
    const kinds = new Set(pts.map((p) => `${p.pt.kind}|${p.pt.card ?? ""}`));
    if (kinds.size > 1) {
      W({ code: "payment_type_mismatch", severity: "warn", row: rowStart, raw: pts.map((p) => p.r.payment).join(" vs "), message: `Rows ${rowStart}-${rowEnd}: the lines of one entry name different payment types (${pts.map((p) => `"${p.r.payment}"`).join(" vs ")}). Kept the first.` });
    }
    const paymentType: PaymentType = pts.length
      ? { kind: pts[0].pt.kind, raw: pts[0].r.payment, ...(pts[0].pt.card ? { card: pts[0].pt.card } : {}) }
      : { kind: "other" };

    // Receipt: Yes / No on the first line; anything else is pending.
    const receiptRaw = g.map((r) => r.receipt.trim()).find(Boolean) ?? "";
    const receiptStatus: ReceiptStatus = /^y/i.test(receiptRaw) ? "yes" : /^n/i.test(receiptRaw) ? "no" : "pending";
    if (receiptStatus === "no") {
      W({ code: "receipt_no", severity: "warn", row: rowStart, raw: receiptRaw, message: `Row ${rowStart}: marked as having no receipt.` });
    } else if (receiptStatus === "pending") {
      W({ code: "receipt_blank", severity: "info", row: rowStart, raw: receiptRaw, message: `Row ${rowStart}: receipt column blank; treated as pending.` });
    }

    if (bad) {
      W({ code: "entry_skipped", severity: "error", row: rowStart, message: `Rows ${rowStart}-${rowEnd} were not imported.` });
      continue;
    }
    try {
      assertBalancedLines(parsedLines.map((l) => ({ ...l, accountId: l.accountKey })) as EntryLine[]);
    } catch (e) {
      W({ code: "unbalanced_entry", severity: "error", row: rowStart, message: `Rows ${rowStart}-${rowEnd}: ${(e as Error).message} Not imported.` });
      continue;
    }
    const memo = (first.description || g.find((r) => r.description)?.description || "").trim().replace(/\s+/g, " ");
    const base = entryContentHash({ entryDate: date.ms, memo, lines: parsedLines });
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    if (occurrence > 0) {
      W({ code: "identical_entry", severity: "warn", row: rowStart, message: `Rows ${rowStart}-${rowEnd} repeat an earlier entry exactly (same date, memo and lines).` });
    }
    entries.push({
      entryDate: date.ms,
      memo,
      paymentType,
      receiptStatus,
      sourceRef: `${sheet.name}!A${rowStart}:H${rowEnd}`,
      rowStart,
      rowEnd,
      contentHash: occurrence ? entryContentHash({ entryDate: date.ms, memo, lines: parsedLines, occurrence }) : base,
      lines: parsedLines,
    });
  }
  if (totalDebitCents !== totalCreditCents) {
    W({ code: "journal_unbalanced", severity: "error", message: `The journal's debits (${formatCents(totalDebitCents)}) and credits (${formatCents(totalCreditCents)}) differ.` });
  }
  return { entries, chart, warnings, stats: { lines, totalDebitCents, totalCreditCents } };
}

// ── Reported statements ─────────────────────────────────────

type LabelRule = { re: RegExp; key: string | null };

/** Statement label -> line key. `null` means a placeholder row to skip. */
const IS_RULES: LabelRule[] = [
  { re: /^total revenue/, key: "total_revenue" },
  { re: /^total expenses/, key: "total_expenses" },
  { re: /^net income|^net loss|^net profit/, key: "net_income" },
  { re: /^recording/, key: "revenue.recording_session" },
  { re: /podcast/, key: "revenue.podcast_studio" },
  { re: /^other audio/, key: "revenue.other_audio_services" },
  { re: /consult/, key: "revenue.consultation" },
  { re: /^other income/, key: "revenue.other_income" },
  { re: /^rent/, key: "expense.rent" },
  { re: /credit card interest|interest and fees|interest & fees/, key: "expense.credit_card_interest_fees" },
  { re: /advertis|promotion/, key: "expense.advertising_promotion" },
  { re: /insurance/, key: "expense.insurance" },
  { re: /internet/, key: "expense.internet" },
  { re: /merchant|processing/, key: "expense.merchant_processing" },
  { re: /software|subscription/, key: "expense.software_subscriptions" },
  { re: /bank service|bank charge|bank fee/, key: "expense.bank_service_charges" },
];

const BS_RULES: LabelRule[] = [
  { re: /^total assets/, key: "total_assets" },
  { re: /^total liabilities ?(\+|and|&) ?equity/, key: "total_liabilities_and_equity" },
  { re: /^total liabilities/, key: "total_liabilities" },
  { re: /^total equity/, key: "total_equity" },
  { re: /^cash$|^cash and cash equivalents/, key: "asset.cash" },
  { re: /funds held by owner/, key: "asset.business_funds_held_by_owner" },
  { re: /deposits? in transit/, key: "asset.deposits_in_transit" },
  { re: /^security deposit/, key: "asset.security_deposit" },
  { re: /studio equipment/, key: "asset.studio_equipment" },
  { re: /furniture/, key: "asset.furniture_fixtures" },
  { re: /security equipment/, key: "asset.security_equipment" },
  { re: /prepaid professional/, key: "asset.prepaid_professional_services" },
  { re: /accounts? receivable/, key: "asset.accounts_receivable" },
  { re: /credit card payable/, key: "liability.credit_card_payable" },
  { re: /partner investment/, key: "liability.partner_investment_deposits" },
  { re: /installment/, key: "liability.installment_payable" },
  { re: /unearned revenue|customer deposits/, key: "liability.unearned_revenue" },
  { re: /payable|accrued/, key: "liability.accounts_payable" },
  { re: /owner'?s? contribution|owner'?s? equity|owner'?s? capital/, key: "equity.owner_contributions" },
  { re: /draw|distribution/, key: "equity.owner_draws" },
  { re: /retained earnings/, key: "equity.retained_earnings" },
];

const CF_RULES: LabelRule[] = [
  { re: /^none$/, key: null },
  { re: /^net cash.*operating/, key: "net_operating" },
  { re: /^net cash.*financing/, key: "net_financing" },
  { re: /^net cash.*investing/, key: "net_investing" },
  { re: /^operating activities$/, key: "net_operating" },
  { re: /^financing activities$/, key: "net_financing" },
  { re: /^investing activities$/, key: "net_investing" },
  { re: /^net change in cash/, key: "net_change" },
  { re: /^beginning cash/, key: "beginning_cash" },
  { re: /^ending cash/, key: "ending_cash" },
  { re: /received from customers|customer receipts/, key: "operating.customer_receipts" },
  { re: /^rent/, key: "operating.rent" },
  { re: /merchant|processing/, key: "operating.processing_fees" },
  { re: /professional services/, key: "operating.professional_services" },
  { re: /^insurance/, key: "operating.insurance" },
  { re: /^internet/, key: "operating.internet" },
  { re: /advert|promotion/, key: "operating.advertising" },
  { re: /software|subscription/, key: "operating.software" },
  { re: /interest/, key: "operating.interest_and_card_fees" },
  { re: /bank service|bank fee/, key: "operating.bank_fees" },
  { re: /owner contribution/, key: "financing.owner_contributions" },
  { re: /partner investment|investment deposit/, key: "financing.partner_deposits" },
  { re: /reimburs|reimbus/, key: "financing.owner_reimbursement" },
  { re: /owner draw|distribution/, key: "financing.owner_draws" },
  { re: /credit card payment/, key: "financing.credit_card_payments" },
  { re: /installment/, key: "financing.installment_payments" },
  { re: /equipment|furniture|fixture/, key: "investing.equipment" },
];

function isTotalKey(key: string): boolean {
  return !key.includes(".");
}

/** A1 reference to zero-based { r, c }. */
function decodeA1(ref: string): { r: number; c: number } {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref.toUpperCase());
  if (!m) throw new Error(`Bad cell reference ${ref}`);
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

export function encodeA1(r: number, c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${r + 1}`;
}

/** Evaluate the small formula language statement tabs use: numbers, cell
 *  references, SUM(range), + - * / and parentheses. Returns null when the
 *  formula uses anything else. */
export function evaluateFormula(sheet: GridSheet, formula: string, depth = 0): number | null {
  if (depth > 50) return null;
  const src = formula.replace(/^=/, "").replace(/\s+/g, "");
  let i = 0;
  const value = (r: number, c: number): number => {
    const cell = sheet.rows[r]?.[c];
    if (!cell) return 0;
    if (cell.f) {
      const v = evaluateFormula(sheet, cell.f, depth + 1);
      if (v === null) throw new Error("unsupported");
      return v;
    }
    return typeof cell.v === "number" ? cell.v : cellNumber(cell) ?? 0;
  };
  const peek = () => src[i];
  const expr = (): number => {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const rhs = term();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = src[i++];
      const rhs = factor();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  };
  const factor = (): number => {
    if (peek() === "-") { i++; return -factor(); }
    if (peek() === "+") { i++; return factor(); }
    if (peek() === "(") {
      i++;
      const v = expr();
      if (src[i++] !== ")") throw new Error("paren");
      return v;
    }
    const rest = src.slice(i);
    const sum = /^SUM\((\$?[A-Z]+\$?\d+):(\$?[A-Z]+\$?\d+)\)/i.exec(rest);
    if (sum) {
      i += sum[0].length;
      const a = decodeA1(sum[1]);
      const b = decodeA1(sum[2]);
      let s = 0;
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) {
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) s += value(r, c);
      }
      return s;
    }
    const ref = /^\$?[A-Z]+\$?\d+/i.exec(rest);
    if (ref) {
      i += ref[0].length;
      const { r, c } = decodeA1(ref[0]);
      return value(r, c);
    }
    const num = /^\d+(\.\d+)?/.exec(rest);
    if (num) {
      i += num[0].length;
      return Number(num[0]);
    }
    throw new Error("unsupported");
  };
  try {
    const v = expr();
    return i === src.length ? v : null;
  } catch {
    return null;
  }
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "May 1, 2026" anywhere in a label -> UTC day. */
function dateInLabel(label: string): number | null {
  const m = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i.exec(label);
  if (!m) return null;
  try {
    return dayFromParts(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
  } catch {
    return null;
  }
}

function longDate(ms: number): string {
  const d = new Date(ms);
  const name = MONTHS[d.getUTCMonth()];
  return `${name[0].toUpperCase()}${name.slice(1)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function parseReportedStatements(sheet: GridSheet, period: Period): ReportedStatements {
  const warnings: ImportWarning[] = [];
  const W = (w: Omit<ImportWarning, "sheet">) => warnings.push({ sheet: sheet.name, ...w });
  type Block = { kind: "balanceSheet" | "incomeStatement" | "cashFlow"; titleRow: number; col: number };
  const blocks: Block[] = [];
  for (let r = 0; r < Math.min(sheet.rows.length, 8); r++) {
    sheet.rows[r].forEach((cell, c) => {
      const t = normalizeName(cellText(cell));
      // First title of each kind wins: "Cash Flows from Operating Activities"
      // further down is a section of the cash flow, not a second statement.
      const add = (kind: Block["kind"]) => {
        if (!blocks.some((b) => b.kind === kind)) blocks.push({ kind, titleRow: r, col: c });
      };
      if (/^balance sheet$/.test(t)) add("balanceSheet");
      else if (/^(income statement|profit and loss|profit & loss|p&l)( statement)?$/.test(t)) add("incomeStatement");
      else if (/^(statement of )?cash flows?( statement)?$/.test(t)) add("cashFlow");
    });
  }
  for (const k of ["balanceSheet", "incomeStatement", "cashFlow"] as const) {
    if (!blocks.some((b) => b.kind === k)) W({ code: "statement_missing", severity: "error", message: `No ${k} block found on "${sheet.name}".` });
  }
  const entityName = blocks.length ? cellText(sheet.rows[Math.max(0, blocks[0].titleRow - 1)]?.[blocks[0].col]).trim() : "";
  const rules = { balanceSheet: BS_RULES, incomeStatement: IS_RULES, cashFlow: CF_RULES };
  const out: Record<Block["kind"], ReportedLine[]> = { balanceSheet: [], incomeStatement: [], cashFlow: [] };
  let typed = 0;
  let computed = 0;

  for (const b of blocks) {
    // Heading date ("As of July 31, 2026", "For The Month Ended July 31, 2026").
    const heading = cellText(sheet.rows[b.titleRow + 1]?.[b.col]);
    const headingDate = dateInLabel(heading);
    const lastDay = period.end - DAY_MS;
    if (headingDate !== null && headingDate !== lastDay) {
      W({ code: "statement_heading_date", severity: "warn", cell: encodeA1(b.titleRow + 1, b.col), raw: heading, message: `The ${b.kind} heading says ${longDate(headingDate)}, but the period ends ${longDate(lastDay)}.` });
    }
    let section = "";
    const seen = new Map<string, number>();
    for (let r = b.titleRow + 2; r < sheet.rows.length; r++) {
      const labelCell = sheet.rows[r]?.[b.col];
      const valueCell = sheet.rows[r]?.[b.col + 1];
      const label = cellText(labelCell).trim();
      if (!label) continue;
      const norm = normalizeName(label);
      if (norm === "description") continue;
      const hasValue = valueCell && (valueCell.v !== null && valueCell.v !== "" || !!valueCell.f);
      if (!hasValue) {
        section = norm;
        continue;
      }
      const rule = rules[b.kind].find((x) => x.re.test(norm));
      if (rule && rule.key === null) continue;
      const cell = encodeA1(r, b.col + 1);
      let value = cellNumber(valueCell);
      const formula = valueCell!.f ? `=${valueCell!.f.replace(/^=/, "")}` : undefined;
      if (formula) {
        const evaluated = evaluateFormula(sheet, formula);
        if (value === null && evaluated !== null) value = evaluated;
        if (value !== null && evaluated !== null && toCents(value) !== toCents(evaluated)) {
          W({ code: "formula_cache_mismatch", severity: "warn", cell, message: `${label} (${cell}): saved value ${formatCents(toCents(value))} but ${formula} gives ${formatCents(toCents(evaluated))}.` });
        }
      }
      if (value === null) {
        W({ code: "statement_value_unreadable", severity: "error", cell, raw: cellText(valueCell), message: `${label} (${cell}): value cannot be read.` });
        continue;
      }
      const key = rule?.key ?? `unmapped.${slug(label)}`;
      if (!rule) {
        W({ code: "unmapped_statement_label", severity: "warn", cell, raw: label, message: `"${label}" (${cell}) on the ${b.kind} does not match a ledger line.` });
      }
      const cents = toCents(value);
      if (seen.has(key)) {
        // Summary rows repeat a total (the cash flow's "Net Change in Cash" block).
        if (seen.get(key) !== cents) {
          W({ code: "statement_repeat_differs", severity: "warn", cell, raw: label, message: `"${label}" (${cell}) repeats a line with a different value (${formatCents(cents)} vs ${formatCents(seen.get(key)!)}).` });
        }
        continue;
      }
      seen.set(key, cents);
      if (formula) computed++;
      else typed++;
      const kind: LineKind = isTotalKey(key) ? "total" : "line";
      out[b.kind].push({ key, label, cents, kind, section, cell, ...(formula ? { formula } : {}) });

      if (key === "beginning_cash") {
        const d = dateInLabel(label);
        if (d !== null && d !== period.start) {
          W({ code: "beginning_cash_label_date", severity: "warn", cell, raw: label, normalized: longDate(period.start), message: `The cash flow's beginning cash label says ${longDate(d)}, but the period starts ${longDate(period.start)}; the bank statement's beginning balance is dated ${longDate(period.start)}.` });
        }
      }
      if (key === "ending_cash") {
        const d = dateInLabel(label);
        if (d !== null && d !== period.end - DAY_MS) {
          W({ code: "statement_heading_date", severity: "warn", cell, raw: label, message: `The ending cash label says ${longDate(d)}, but the period ends ${longDate(period.end - DAY_MS)}.` });
        }
      }
    }
  }

  // Retained earnings computed from the balance sheet's own totals is a plug.
  const re = out.balanceSheet.find((l) => l.key === "equity.retained_earnings");
  const totalAssets = out.balanceSheet.find((l) => l.key === "total_assets");
  if (re?.formula) {
    const refsAssets = totalAssets?.cell ? new RegExp(`\\b\\$?${totalAssets.cell.replace(/(\d+)$/, "\\$?$1")}\\b`).test(re.formula) : false;
    W({
      code: "retained_earnings_plug",
      severity: "warn",
      cell: re.cell,
      raw: re.formula,
      message: refsAssets
        ? `Retained Earnings is a plug (${re.formula}): total assets less liabilities less owner contributions, so the reported balance sheet balances by construction.`
        : `Retained Earnings is computed by ${re.formula} rather than carried forward from prior periods.`,
    });
  }
  if (typed > 0) {
    W({ code: "hardcoded_statement_values", severity: "info", message: `${typed} of ${typed + computed} reported statement values are typed in; ${computed} are formulas.` });
  }
  return {
    entityName,
    periodStart: period.start,
    periodEnd: period.end,
    balanceSheet: out.balanceSheet,
    incomeStatement: out.incomeStatement,
    cashFlow: out.cashFlow,
    warnings,
  };
}

// ── The whole workbook ──────────────────────────────────────

export type BooksImportPlan = {
  period: Period;
  entityName: string;
  importBatchId: string;
  chart: ChartAccount[];
  entries: ParsedEntry[];
  reported: ReportedStatements;
  /** Journal and statement warnings together, journal first. */
  warnings: ImportWarning[];
  stats: { lines: number; entries: number; totalDebitCents: number; totalCreditCents: number };
};

export function parseBooksWorkbook(
  grid: GridWorkbook,
  opts: { period: string; journalSheet?: string; statementsSheet?: string; chart?: readonly ChartAccount[] },
): BooksImportPlan {
  const period = parsePeriod(opts.period);
  const findSheet = (name: string | undefined, re: RegExp, label: string) => {
    const s = name ? grid.sheets.find((x) => x.name === name) : grid.sheets.find((x) => re.test(x.name));
    if (!s) throw new LedgerValidationError(`No ${label} sheet found (looked for ${name ? `"${name}"` : re}).`);
    return s;
  };
  const journal = parseJournal(findSheet(opts.journalSheet, /journal/i, "journal"), period, opts.chart ?? DEFAULT_STUDIO_CHART);
  const reportedRaw = parseReportedStatements(findSheet(opts.statementsSheet, /statement/i, "financial statements"), period);
  const warnings = [...journal.warnings, ...reportedRaw.warnings];
  const importBatchId = `books-${period.key}-${stableHash(journal.entries.map((e) => e.contentHash).join(","))}`;
  return {
    period,
    entityName: reportedRaw.entityName,
    importBatchId,
    chart: journal.chart,
    entries: journal.entries,
    reported: { ...reportedRaw, warnings },
    warnings,
    stats: { lines: journal.stats.lines, entries: journal.entries.length, totalDebitCents: journal.stats.totalDebitCents, totalCreditCents: journal.stats.totalCreditCents },
  };
}

// ── Engine views of a plan (dry run, tests) ─────────────────

export function chartToLedgerAccounts(chart: readonly ChartAccount[]): LedgerAccount[] {
  return chart.map((a) => ({
    id: a.key, key: a.key, name: a.name, type: a.type, subtype: a.subtype, statementLine: a.statementLine,
    sortOrder: a.sortOrder, normalBalance: a.normalBalance, isCash: a.isCash, isClearing: a.isClearing,
    cashFlowLine: a.cashFlowLine, cashFlowLineInflow: a.cashFlowLineInflow, active: true,
  }));
}

export function planToLedgerEntries(plan: Pick<BooksImportPlan, "entries" | "period">): LedgerEntry[] {
  return plan.entries.map((e) => ({
    id: e.contentHash,
    entryDate: e.entryDate,
    memo: e.memo,
    status: "posted",
    receiptStatus: e.receiptStatus,
    paymentKind: e.paymentType.kind,
    bookPeriod: plan.period.key,
    sourceRef: e.sourceRef,
    lines: e.lines.map((l) => ({ accountId: l.accountKey, debitCents: l.debitCents, creditCents: l.creditCents, ...(l.memo ? { memo: l.memo } : {}) })),
  }));
}

/** A bank statement summary from JSON. Accepts cents fields or dollar fields
 *  (beginning, deposits, withdrawals, fees, ending). Withdrawals and fees are
 *  magnitudes; a negative number is read as its absolute value. */
export function bankBalanceFromJson(json: Record<string, unknown>, period: Period): BankStatementBalance {
  const pick = (name: string): number => {
    const signed = name === "beginning" || name === "ending";
    const c = json[`${name}Cents`];
    const d = json[name];
    let cents: number | null = null;
    if (typeof c === "number" && Number.isSafeInteger(c)) cents = c;
    else if (typeof d === "number" || typeof d === "string") cents = toCents(d);
    if (cents !== null) return signed ? cents : Math.abs(cents);
    throw new LedgerValidationError(`Bank statement JSON is missing "${name}".`);
  };
  const label = String(json.accountLabel ?? "Bank account");
  if (/\d{5,}/.test(label)) throw new LedgerValidationError("accountLabel must not contain a full account number; use the last four digits or a name.");
  return {
    accountLabel: label,
    periodStart: period.start,
    periodEnd: period.end,
    beginningCents: pick("beginning"),
    endingCents: pick("ending"),
    depositsCents: pick("deposits"),
    withdrawalsCents: pick("withdrawals"),
    feesCents: pick("fees"),
  };
}

/** The dry run: statements recomputed from the plan with implied opening
 *  balances (cash anchored to the bank when a statement is given), compared
 *  with what the workbook reported. */
export function reconcilePlan(plan: BooksImportPlan, bank: readonly BankStatementBalance[] = []) {
  const accounts = chartToLedgerAccounts(plan.chart);
  const entries = planToLedgerEntries(plan);
  const anchor = bank.find((b) => b.periodStart === plan.period.start && !b.ledgerAccountId);
  const implied = impliedOpeningBalances({
    accounts, entries, periodStart: plan.period.start, periodEnd: plan.period.end,
    reportedBalanceSheet: plan.reported.balanceSheet,
    cashAnchorCents: anchor?.beginningCents,
  });
  const result = buildStatements({ period: plan.period, accounts, opening: implied.opening, entries, bank, reported: plan.reported });
  return { ...result, accounts, entries, opening: implied.opening, openingWarnings: implied.warnings };
}

/** Drop undefined fields: Convex arguments may not carry them. */
function defined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** The plan as the import mutation's arguments (see convex/ledger.ts). */
export function planToImportArgs(plan: BooksImportPlan) {
  return {
    period: plan.period.key,
    entityName: plan.entityName,
    importBatchId: plan.importBatchId,
    chart: plan.chart.map((a) => defined({
      key: a.key, name: a.name, type: a.type, subtype: a.subtype, statementLine: a.statementLine,
      sortOrder: a.sortOrder, normalBalance: a.normalBalance, isCash: a.isCash, isClearing: a.isClearing,
      cashFlowLine: a.cashFlowLine, cashFlowLineInflow: a.cashFlowLineInflow,
    })),
    entries: plan.entries.map((e) => ({
      entryDate: e.entryDate,
      memo: e.memo,
      paymentType: defined({ kind: e.paymentType.kind, raw: e.paymentType.raw, card: e.paymentType.card }),
      receiptStatus: e.receiptStatus,
      sourceRef: e.sourceRef,
      contentHash: e.contentHash,
      lines: e.lines.map((l) => defined({ accountKey: l.accountKey, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo })),
    })),
    reported: {
      balanceSheet: plan.reported.balanceSheet.map((l) => defined({ ...l })),
      incomeStatement: plan.reported.incomeStatement.map((l) => defined({ ...l })),
      cashFlow: plan.reported.cashFlow.map((l) => defined({ ...l })),
      warnings: plan.reported.warnings.map((w) => defined({ ...w })),
    },
  };
}

export type ImportArgs = ReturnType<typeof planToImportArgs>;
