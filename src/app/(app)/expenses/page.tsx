"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Wallet, TrendingDown, TrendingUp, Percent, RefreshCw, Plus, Pencil, Landmark, History, Paperclip, ExternalLink } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatTile } from "@/components/ui/stat-tile";
import { CountUp } from "@/components/shell/app-motion";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { money, percent, shortDate, longDate, timeOfDay } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { ReceiptsPanel, useReceiptUpload } from "@/components/finance/receipts-panel";
import { FinanceHistorySheet } from "@/components/finance/finance-history-sheet";
import { meta, PAYMENT_METHOD } from "@/lib/labels";
import {
  ExpenseDialog,
  EXPENSE_CATEGORIES,
  type EditableExpense,
} from "@/components/expenses/expense-dialog";

type Range = "month" | "last" | "year" | "all";

const CATEGORY_LABEL = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));

function rangeFor(r: Range): { start: number; end: number; bankStart: number; bankEnd: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const farEnd = new Date(year, month, now.getDate() + 1).getTime();
  // Plaid and receipt dates represent calendar days at UTC midnight; revenue,
  // payroll and other collected-at timestamps use the viewer's local period.
  const bankTodayEnd = Date.UTC(year, month, now.getDate() + 1);
  if (r === "all") return { start: 1, end: farEnd, bankStart: 1, bankEnd: bankTodayEnd };
  if (r === "year") return { start: new Date(year, 0, 1).getTime(), end: farEnd, bankStart: Date.UTC(year, 0, 1), bankEnd: bankTodayEnd };
  if (r === "last") {
    return {
      start: new Date(year, month - 1, 1).getTime(),
      end: new Date(year, month, 1).getTime(),
      bankStart: Date.UTC(year, month - 1, 1),
      bankEnd: Date.UTC(year, month, 1),
    };
  }
  return {
    start: new Date(year, month, 1).getTime(),
    end: new Date(year, month + 1, 1).getTime(),
    bankStart: Date.UTC(year, month, 1),
    bankEnd: Date.UTC(year, month + 1, 1),
  };
}

type ExpenseRow = EditableExpense & {
  memberName: string | null;
  receiptUrl: string | null;
  source?: "manual" | "receipt" | "bank";
  receiptDocId?: Id<"receipts">;
  bankTransactionId?: Id<"bankTransactions">;
};

export default function ExpensesPage() {
  const [range, setRange] = React.useState<Range>("month");
  const [addOpen, setAddOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<EditableExpense | undefined>(undefined);
  const [editOpen, setEditOpen] = React.useState(false);

  const { start, end, bankStart, bankEnd } = rangeFor(range);
  const reconcileHref = `/banking?start=${bankStart}&end=${bankEnd}&filter=attention`;
  const pl = useQuery(api.expenses.plReport, { start, end, bankStart, bankEnd });
  const rows = useQuery(api.expenses.list, { start, end }) as ExpenseRow[] | undefined;

  const banking = useQuery(api.banking.overview, {});
  const canEdit = banking?.canEdit ?? false;
  const upload = useReceiptUpload();
  const [historyFor, setHistoryFor] = React.useState<ExpenseRow | null>(null);
  const attachFor = React.useRef<ExpenseRow | null>(null);
  const attachInput = React.useRef<HTMLInputElement>(null);

  const loading = rows === undefined;
  const profitable = (pl?.netCents ?? 0) >= 0;

  function openEdit(r: ExpenseRow) {
    setEditItem({
      _id: r._id, category: r.category, amountCents: r.amountCents, date: r.date,
      vendor: r.vendor, description: r.description, recurring: r.recurring, notes: r.notes,
    });
    setEditOpen(true);
  }

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Finance"
        title="Expenses & P&L"
        description="The money-out half of the books. Log costs and see true profit - collected revenue minus expenses, by period."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Log expense
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-44">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger aria-label="Period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="last">Last month</SelectItem>
              <SelectItem value="year">This year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Revenue collected" value={pl ? <CountUp to={pl.revenueCents} format={(n) => money(n, { compact: true })} /> : "-"} icon={TrendingUp} accent hint={pl ? `${money(pl.revenueFromPaymentsCents, { compact: true })} sessions · ${money(pl.revenueFromInvoicesCents, { compact: true })} invoices` : ""} />
        <StatTile label="Expenses" value={pl ? <CountUp to={pl.expensesCents} format={(n) => money(n, { compact: true })} /> : "-"} icon={TrendingDown} hint={pl ? `${pl.expenseCount} entries` : ""} />
        <StatTile label="Net profit" value={pl ? <CountUp to={pl.netCents} format={(n) => money(n, { compact: true })} /> : "-"} icon={Wallet} accent={profitable} hint={profitable ? "in the black" : "in the red"} />
        <StatTile label="Margin" value={pl ? percent(pl.marginPct, 0) : "-"} icon={Percent} hint="net / revenue" />
        <StatTile label="Recurring / mo" value={pl ? <CountUp to={pl.monthlyRecurringCents} format={(n) => money(n, { compact: true })} /> : "-"} icon={RefreshCw} hint="fixed cost run-rate" />
      </div>

      {pl && (
        pl.bank.connected ? (
          <section className="space-y-3" aria-labelledby="bank-view-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="bank-view-heading" className="font-grotesk text-sm font-semibold text-bone">Bank activity</h2>
              <p className="text-xs text-steel">
                {pl.bank.balanceAsOf === null
                  ? "Balances are waiting for the first sync."
                  : `Balances as of ${longDate(pl.bank.balanceAsOf)}, ${timeOfDay(pl.bank.balanceAsOf)}`}
              </p>
            </div>
            <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <StatTile label="Bank money in" value={money(pl.bank.inCents, { compact: true })} icon={TrendingUp} hint="this period, transfers excluded" />
              <StatTile label="Bank money out" value={money(pl.bank.outCents, { compact: true })} icon={TrendingDown} hint="this period, transfers excluded" />
              <StatTile label="Net cash flow" value={money(pl.bank.netCents, { compact: true })} icon={Wallet} hint="bank money in minus money out" />
              <StatTile label="Cash on hand" value={money(pl.bank.cashOnHandCents, { compact: true })} icon={Landmark} hint="current checking and savings" />
              <StatTile label="Owed on cards" value={money(pl.bank.cardOwedCents, { compact: true })} icon={Landmark} hint="current credit card balances" />
            </div>
            {pl.bank.outByCategory.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">Bank spending by category</span>
                {pl.bank.outByCategory.map((category) => (
                  <span key={category.category} className="inline-flex items-center gap-2 rounded-full border border-graphite/50 bg-coal-2 px-3 py-1 text-xs text-bone">
                    <span className="text-steel/80">{category.category === "uncategorized" ? "Uncategorized" : CATEGORY_LABEL.get(category.category) ?? category.category}</span>
                    <span className="font-meta text-gold">{money(category.amountCents)}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-graphite/50 bg-coal/40 px-4 py-3 text-sm">
            <span className="text-steel">Connect the studio bank to see cash in, cash out and balances here, and to match receipts automatically.</span>
            <Button asChild size="sm" variant="secondary"><Link href="/banking"><Landmark className="size-3.5" /> Banking</Link></Button>
          </div>
        )
      )}

      {pl && (
        <section className="space-y-3" aria-labelledby="reconciliation-heading">
          <h2 id="reconciliation-heading" className="font-grotesk text-sm font-semibold text-bone">Reconciliation this period</h2>
          <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Bank charges to reconcile" value={String(pl.reconciliation.unmatchedOutflows)} icon={Landmark} hint="posted spending not in the books" />
            <StatTile label="Unmatched receipts" value={String(pl.reconciliation.receiptsUnmatched)} icon={Paperclip} hint={`${pl.reconciliation.receiptsToBook} ready receipts still need an expense`} />
            <StatTile label="Receipts needing review" value={String(pl.reconciliation.receiptsNeedingReview)} icon={Pencil} hint="check the receipt details" />
            <StatTile label="Expenses without receipts" value={String(pl.reconciliation.expensesWithoutReceipt)} icon={Paperclip} hint="excluding payroll and adjustments" />
          </div>
          {pl.reconciliation.unmatchedOutflows > 0 && (
            <p className="text-xs text-caution">
              {pl.reconciliation.unmatchedOutflows} bank {pl.reconciliation.unmatchedOutflows === 1 ? "charge isn't" : "charges aren't"} in the books yet. <Link href={reconcileHref} className="underline">Reconcile in Banking</Link>.
            </p>
          )}
        </section>
      )}

      {pl && pl.paymentsByMethod.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
            Payments by type
          </span>
          {pl.paymentsByMethod.map((m) => (
            <span key={m.method} className="inline-flex items-center gap-2 rounded-full border border-graphite/50 bg-coal-2 px-3 py-1 text-xs text-bone">
              <span className="text-steel/80">{meta(PAYMENT_METHOD, m.method).label}</span>
              <span className="font-meta text-gold">{money(m.amountCents)}</span>
            </span>
          ))}
        </div>
      )}

      {pl && pl.byCategory.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
            Expenses by category
          </span>
          {pl.byCategory.map((c) => (
            <span key={c.category} className="inline-flex items-center gap-2 rounded-full border border-graphite/50 bg-coal-2 px-3 py-1 text-xs text-bone">
              <span className="text-steel/80">{CATEGORY_LABEL.get(c.category) ?? c.category}</span>
              <span className="font-meta text-gold">{money(c.amountCents)}</span>
            </span>
          ))}
        </div>
      )}

      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Category</TH>
            <TH>Vendor</TH>
            <TH>Description</TH>
            <TH>Receipt</TH>
            <TH className="text-right">Amount</TH>
            <TH className="w-20" />
          </TR>
        </THead>
        <TBody>
          {loading ? (
            <TR><TD colSpan={7} className="py-8 text-center text-steel/70">Loading…</TD></TR>
          ) : rows.length === 0 ? (
            <TR><TD colSpan={7} className="py-8 text-center text-steel/70">No expenses logged for this period. Click “Log expense” to add your first cost.</TD></TR>
          ) : (
            rows.map((r) => (
              <TR key={r._id}>
                <TD className="whitespace-nowrap font-meta text-steel">{shortDate(r.date)}</TD>
                <TD>
                  {CATEGORY_LABEL.get(r.category) ?? r.category}
                  {r.recurring && <span className="ml-2 rounded-full border border-graphite/50 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-steel/70">{r.recurring}</span>}
                </TD>
                <TD className="text-steel">{r.vendor ?? "-"}</TD>
                <TD className="text-steel">
                  {r.description ?? "-"}
                  {r.source === "bank" && <Badge tone="info" className="ml-2">Bank</Badge>}
                  {r.source === "receipt" && <Badge tone="info" className="ml-2">Receipt</Badge>}
                </TD>
                <TD>
                  {r.receiptUrl ? (
                    <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gold hover:underline">
                      <ExternalLink className="size-3" /> View
                    </a>
                  ) : canEdit ? (
                    <Button size="sm" variant="ghost" onClick={() => { attachFor.current = r; attachInput.current?.click(); }}>
                      <Paperclip className="size-3.5" /> Attach
                    </Button>
                  ) : (
                    <span className="text-xs text-steel/60">None</span>
                  )}
                </TD>
                <TD className="text-right font-meta text-bone">{money(r.amountCents)}</TD>
                <TD>
                  <div className="flex justify-end">
                    <IconButton variant="ghost" size="icon" label="History for this expense" onClick={() => setHistoryFor(r)}>
                      <History className="size-4" />
                    </IconButton>
                    <IconButton variant="ghost" size="icon" label="Edit this expense" onClick={() => openEdit(r)}>
                      <Pencil className="size-4" />
                    </IconButton>
                  </div>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      <input
        ref={attachInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          const target = attachFor.current;
          e.target.value = "";
          if (!file || !target) return;
          try {
            await upload(file, target._id as Id<"expenses">);
            toast.success("Receipt attached. Reading it now.");
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            attachFor.current = null;
          }
        }}
      />

      <ReceiptsPanel canEdit={canEdit} />

      <FinanceHistorySheet
        open={historyFor !== null}
        onOpenChange={(o) => { if (!o) setHistoryFor(null); }}
        title={historyFor ? `${historyFor.vendor ?? CATEGORY_LABEL.get(historyFor.category) ?? "Expense"} · ${money(historyFor.amountCents)}` : ""}
        expenseId={historyFor?._id as Id<"expenses"> | undefined}
      />

      <ExpenseDialog open={addOpen} onOpenChange={setAddOpen} />
      <ExpenseDialog item={editItem} open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditItem(undefined); }} />
    </div>
  );
}
