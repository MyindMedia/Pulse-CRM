"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Wallet, TrendingDown, TrendingUp, Percent, RefreshCw, Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
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
import { money, percent, shortDate } from "@/lib/format";
import { meta, PAYMENT_METHOD } from "@/lib/labels";
import {
  ExpenseDialog,
  EXPENSE_CATEGORIES,
  type EditableExpense,
} from "@/components/expenses/expense-dialog";

type Range = "month" | "last" | "year" | "all";

const CATEGORY_LABEL = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));

function rangeFor(r: Range): { start: number; end: number } {
  const now = new Date();
  const farEnd = Date.now() + 86_400_000;
  if (r === "all") return { start: 1, end: farEnd };
  if (r === "year") return { start: new Date(now.getFullYear(), 0, 1).getTime(), end: farEnd };
  if (r === "last") {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      end: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    };
  }
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
  };
}

type ExpenseRow = EditableExpense & { memberName: string | null; receiptUrl: string | null };

export default function ExpensesPage() {
  const [range, setRange] = React.useState<Range>("month");
  const [addOpen, setAddOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<EditableExpense | undefined>(undefined);
  const [editOpen, setEditOpen] = React.useState(false);

  const { start, end } = rangeFor(range);
  const pl = useQuery(api.expenses.plReport, { start, end });
  const rows = useQuery(api.expenses.list, { start, end }) as ExpenseRow[] | undefined;

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
            <TH className="text-right">Amount</TH>
            <TH className="w-10" />
          </TR>
        </THead>
        <TBody>
          {loading ? (
            <TR><TD colSpan={6} className="py-8 text-center text-steel/70">Loading…</TD></TR>
          ) : rows.length === 0 ? (
            <TR><TD colSpan={6} className="py-8 text-center text-steel/70">No expenses logged for this period. Click “Log expense” to add your first cost.</TD></TR>
          ) : (
            rows.map((r) => (
              <TR key={r._id}>
                <TD className="whitespace-nowrap font-meta text-steel">{shortDate(r.date)}</TD>
                <TD>
                  {CATEGORY_LABEL.get(r.category) ?? r.category}
                  {r.recurring && <span className="ml-2 rounded-full border border-graphite/50 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-steel/70">{r.recurring}</span>}
                </TD>
                <TD className="text-steel">{r.vendor ?? "-"}</TD>
                <TD className="text-steel">{r.description ?? "-"}</TD>
                <TD className="text-right font-meta text-bone">{money(r.amountCents)}</TD>
                <TD>
                  <Button variant="ghost" size="icon" aria-label="Edit expense" onClick={() => openEdit(r)}>
                    <Pencil className="size-4" />
                  </Button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      <ExpenseDialog open={addOpen} onOpenChange={setAddOpen} />
      <ExpenseDialog item={editItem} open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditItem(undefined); }} />
    </div>
  );
}
