"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  AlertTriangle,
  CreditCard,
  Download,
  FileCheck2,
  Landmark,
  Printer,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { EXPENSE_CATEGORY_LABEL } from "@convex/lib/financeCategories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { money, percent } from "@/lib/format";
import {
  expenseDetailCsv,
  bankReconciliationCsv,
  stripeSettlementCsv,
  financialBounds,
  pnlSummaryCsv,
  type FinancialRange,
} from "@/lib/financial-report";
import { ReportCard, ReportStat } from "./report-shell";

function downloadCsv(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function FinancialReport() {
  const [range, setRange] = React.useState<FinancialRange>("month");
  const [anchor] = React.useState(() => new Date());
  const [customStart, setCustomStart] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [customEnd, setCustomEnd] = React.useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const bounds = React.useMemo(
    () => financialBounds(range, anchor, customStart, customEnd),
    [range, anchor, customStart, customEnd],
  );
  const report = useQuery(
    api.expenses.plReport,
    bounds
      ? { start: bounds.start, end: bounds.end, bankStart: bounds.bankStart, bankEnd: bounds.bankEnd }
      : "skip",
  );
  const expenses = useQuery(
    api.expenses.list,
    bounds ? { start: bounds.start, end: bounds.end } : "skip",
  );
  const bankRows = useQuery(
    api.banking.transactions,
    bounds ? { start: bounds.bankStart, end: bounds.bankEnd, filter: "all" } : "skip",
  );
  const stripeRows = useQuery(
    api.stripeLedger.report,
    bounds ? { start: bounds.start, end: bounds.end } : "skip",
  );

  const taxGroups = report?.byTaxCategory.map((group) => ({ label: group.taxCategory, amountCents: group.amountCents })) ?? [];

  const filenamePeriod = bounds ? `${bounds.startLabel}_${bounds.endLabel}` : "period";
  const valid = bounds !== null;

  return (
    <div id="pulse-financial-report" className="space-y-5 print:space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-44">
            <label className="mb-1.5 block text-xs font-medium text-steel" htmlFor="financial-period">Period</label>
            <Select value={range} onValueChange={(value) => setRange(value as FinancialRange)}>
              <SelectTrigger id="financial-period"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="last">Last month</SelectItem>
                <SelectItem value="quarter">This quarter</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="custom">Custom dates</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {range === "custom" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-steel" htmlFor="financial-start">From</label>
                <Input id="financial-start" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="w-40" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-steel" htmlFor="financial-end">Through</label>
                <Input id="financial-end" type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="w-40" />
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!report || !bounds}
            onClick={() => report && bounds && downloadCsv(`pulse-p-and-l_${filenamePeriod}.csv`, pnlSummaryCsv(report, bounds))}
          >
            <Download /> P&amp;L CSV
          </Button>
          <Button
            variant="secondary"
            disabled={!expenses || !bounds}
            onClick={() => expenses && downloadCsv(`pulse-expenses_${filenamePeriod}.csv`, expenseDetailCsv(expenses))}
          >
            <Download /> Expense CSV
          </Button>
          <Button
            variant="secondary"
            disabled={!bankRows || !bounds}
            onClick={() => bankRows && downloadCsv(`pulse-bank-reconciliation_${filenamePeriod}.csv`, bankReconciliationCsv(bankRows.rows, bankRows.truncated))}
          >
            <Download /> Bank CSV
          </Button>
          <Button
            variant="secondary"
            disabled={!stripeRows || !bounds}
            onClick={() => stripeRows && downloadCsv(`pulse-stripe-settlement_${filenamePeriod}.csv`, stripeSettlementCsv(stripeRows))}
          >
            <Download /> Stripe CSV
          </Button>
          <Button variant="secondary" disabled={!report} onClick={() => window.print()}>
            <Printer /> Print / Save PDF
          </Button>
        </div>
      </div>

      {!valid && (
        <div role="alert" className="rounded-lg border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical">
          The ending date must be on or after the starting date.
        </div>
      )}

      {bounds && (
        <div className="hidden print:block">
          <p className="overline">Pulse financial report</p>
          <h2 className="mt-1 font-grotesk text-2xl font-bold text-bone">Profit, cash, and reconciliation</h2>
          <p className="mt-1 text-sm text-steel">{bounds.startLabel} through {bounds.endLabel}</p>
        </div>
      )}

      {report && (report.bank.foreignCurrencyRows > 0 || report.bank.foreignCurrencyAccounts > 0) && (
        <div role="alert" className="rounded-lg border border-caution/30 bg-caution/10 px-4 py-3 text-sm text-caution">
          USD totals exclude {report.bank.foreignCurrencyRows} transaction{report.bank.foreignCurrencyRows === 1 ? "" : "s"} and {report.bank.foreignCurrencyAccounts} account{report.bank.foreignCurrencyAccounts === 1 ? "" : "s"} held in other currencies. Export the bank detail for the original amounts and currencies.
        </div>
      )}

      <ReportCard
        title="Profit and loss"
        description={bounds ? `${bounds.startLabel} through ${bounds.endLabel}. Cash-basis revenue collected, less recorded operating expenses.` : "Choose a valid period."}
        loading={valid && report === undefined}
      >
        {report && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <ReportStat label="Revenue collected" value={money(report.revenueCents)} tone="positive" />
              <ReportStat label="Operating expenses" value={money(report.expensesCents)} tone="caution" />
              <ReportStat label="Net profit" value={money(report.netCents)} tone={report.netCents >= 0 ? "gold" : "critical"} />
              <ReportStat label="Margin" value={percent(report.marginPct, 1)} tone={report.netCents >= 0 ? "positive" : "critical"} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <BreakdownTable
                title="Revenue sources"
                icon={TrendingUp}
                rows={[
                  { label: "Booking payments", amountCents: report.revenueFromPaymentsCents },
                  { label: "Paid invoices", amountCents: report.revenueFromInvoicesCents },
                  { label: "Prepaid packages", amountCents: report.revenueFromPackagesCents },
                  { label: "Memberships", amountCents: report.revenueFromMembershipsCents },
                  { label: "Classified bank income", amountCents: report.revenueFromBankCents },
                ]}
                total={report.revenueCents}
              />
              <BreakdownTable
                title="Expense categories"
                icon={TrendingDown}
                rows={report.byCategory.map((category) => ({
                  label: EXPENSE_CATEGORY_LABEL.get(category.category) ?? category.category,
                  amountCents: category.amountCents,
                }))}
                total={report.expensesCents}
                empty="No recorded expenses in this period."
              />
            </div>
          </div>
        )}
      </ReportCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <ReportCard
          title="Bank cash movement"
          description="Plaid bank activity is shown separately from revenue. Stripe payouts and other deposits do not create revenue here."
          loading={valid && report === undefined}
          empty={report !== undefined && !report.bank.connected}
          emptyIcon={Landmark}
          emptyTitle="No bank connected"
          emptyDescription="Connect a business bank to compare cash movement with the books."
        >
          {report?.bank.connected && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <ReportStat label="Money in" value={money(report.bank.cashInCents)} tone="positive" />
              <ReportStat label="Money out" value={money(report.bank.cashOutCents)} tone="caution" />
              <ReportStat label="Net movement" value={money(report.bank.cashNetCents)} tone="gold" />
              <ReportStat label="Cash on hand" value={money(report.bank.cashOnHandCents)} />
              <ReportStat label="Card balances" value={money(report.bank.cardOwedCents)} />
              <ReportStat label="Recurring / month" value={money(report.monthlyRecurringCents)} />
            </div>
          )}
        </ReportCard>

        <ReportCard
          title="Books health"
          description="Items that still need classification, matching, review, or supporting documentation."
          loading={valid && report === undefined}
        >
          {report && (
            <div className="grid grid-cols-2 gap-2.5">
              <AttentionStat icon={AlertTriangle} label="Bank charges to reconcile" value={report.reconciliation.unmatchedOutflows} />
              <AttentionStat icon={AlertTriangle} label="Deposits to classify" value={report.reconciliation.unmatchedInflows} />
              <AttentionStat icon={FileCheck2} label="Unmatched receipts" value={report.reconciliation.receiptsUnmatched} />
              <AttentionStat icon={AlertTriangle} label="Receipts needing review" value={report.reconciliation.receiptsNeedingReview} />
              <AttentionStat icon={FileCheck2} label="Expenses without receipts" value={report.reconciliation.expensesWithoutReceipt} />
            </div>
          )}
        </ReportCard>
      </div>

      <ReportCard
        title="Stripe clearing"
        description="Informational USD clearing activity for the connected Stripe account. It does not change Pulse P&L until individual balance rows are linked to Pulse sales. Payouts are settlement of earlier sales, not new revenue."
        loading={valid && report === undefined}
        empty={report !== undefined && report.stripe.grossSalesCents === 0 && report.stripe.payoutsCents === 0}
        emptyIcon={CreditCard}
        emptyTitle="No Stripe clearing activity"
        emptyDescription="Stripe payout details appear after an automatic payout is reconciled."
      >
        {report && (report.stripe.foreignCurrencyEntries > 0 || report.stripe.foreignCurrencyPayouts > 0) && (
          <div role="alert" className="mb-4 rounded-lg border border-caution/30 bg-caution/10 px-4 py-3 text-sm text-caution">
            The USD Stripe summary excludes {report.stripe.foreignCurrencyEntries} balance row{report.stripe.foreignCurrencyEntries === 1 ? "" : "s"} and {report.stripe.foreignCurrencyPayouts} payout{report.stripe.foreignCurrencyPayouts === 1 ? "" : "s"} in other currencies. The Stripe CSV keeps their original currency.
          </div>
        )}
        {report && (report.stripe.grossSalesCents > 0 || report.stripe.payoutsCents > 0) && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <ReportStat label="Gross card sales" value={money(report.stripe.grossSalesCents)} tone="positive" />
            <ReportStat label="Processing fees" value={money(report.stripe.feesCents)} tone="caution" />
            <ReportStat label="Refunds" value={money(report.stripe.refundsCents)} tone="critical" />
            <ReportStat label="Disputes" value={money(report.stripe.disputesCents)} tone="critical" />
            <ReportStat label="Clearing net" value={money(report.stripe.clearingNetCents)} tone="gold" />
            <ReportStat label="Bank payouts" value={money(report.stripe.payoutsCents)} />
            <ReportStat label="Adjustments" value={money(report.stripe.adjustmentsCents)} />
            <ReportStat label="Payouts to review" value={String(report.stripe.unmatchedPayouts)} tone={report.stripe.unmatchedPayouts > 0 ? "caution" : "positive"} />
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Tax report groups"
        description="Expense categories organized into common accountant reporting groups. These labels help organize records and are not tax advice."
        loading={valid && report === undefined}
        empty={report !== undefined && taxGroups.length === 0}
        emptyTitle="No tax groups for this period"
        emptyDescription="Tax report groups appear after expenses are recorded."
      >
        {taxGroups.length > 0 && (
          <Table>
            <THead><TR><TH>Reporting group</TH><TH className="text-right">Recorded expenses</TH></TR></THead>
            <TBody>
              {taxGroups.map((group) => (
                <TR key={group.label}>
                  <TD>{group.label}</TD>
                  <TD className="text-right font-meta tabular-nums text-gold">{money(group.amountCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </ReportCard>
    </div>
  );
}

function BreakdownTable({
  title,
  icon: Icon,
  rows,
  total,
  empty,
}: {
  title: string;
  icon: typeof TrendingUp;
  rows: Array<{ label: string; amountCents: number }>;
  total: number;
  empty?: string;
}) {
  return (
    <section aria-label={title} className="rounded-lg border border-graphite/50 bg-coal/40 p-4">
      <h3 className="flex items-center gap-2 font-grotesk text-sm font-semibold text-bone"><Icon className="size-4 text-gold" />{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-steel">{empty ?? "No activity in this period."}</p>
      ) : (
        <dl className="mt-3 space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
              <dt className="text-steel">{row.label}</dt>
              <dd className="font-meta tabular-nums text-bone">{money(row.amountCents)}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 border-t border-graphite/50 pt-2 text-sm font-semibold">
            <dt>Total</dt><dd className="font-meta tabular-nums text-gold">{money(total)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function AttentionStat({ icon: Icon, label, value }: { icon: typeof AlertTriangle; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-graphite/50 bg-coal-2 px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-steel">{label}</p>
        <Icon className={value > 0 ? "size-4 text-caution" : "size-4 text-positive"} aria-hidden="true" />
      </div>
      <p className="mt-2 font-grotesk text-xl font-bold tabular-nums text-bone">{value}</p>
    </div>
  );
}
