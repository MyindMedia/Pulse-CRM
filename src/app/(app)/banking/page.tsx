"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react";
import { useSearchParams } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  Landmark, CreditCard, AlertTriangle, RefreshCw, Plus, Link2, History, BookPlus, Ban, Undo2, ChevronDown, ChevronUp, Search, Tags,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import { Input, Field } from "@/components/ui/field";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money, relativeTime } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { EXPENSE_CATEGORIES } from "@/components/expenses/expense-dialog";
import { INCOME_CATEGORIES, MONEY_IN_KINDS, INCOME_CATEGORY_LABEL, MONEY_IN_KIND_LABEL } from "@convex/lib/financeCategories";
import { usePlaidLink } from "@/components/finance/use-plaid-link";
import { FinanceHistorySheet } from "@/components/finance/finance-history-sheet";
import { MatchSuggestions } from "@/components/finance/match-suggestions";
import { CONNECTION_STATUS, EXCLUDE_REASON_LABEL, bankDay } from "@/components/finance/finance-labels";

/* Banking - the studio's bank feed (openspec add-bank-sync-receipts).
   Owners connect banks through Plaid Link; owners, managers and accountants
   see balances and every transaction, sort out what is spending, and put it in
   the books. Everything here reads from and writes to the server, which
   enforces who may do what. */

type Range = "30" | "90" | "month" | "last" | "year" | "all" | "custom";
type Filter = "attention" | "matched" | "excluded" | "in" | "all";

const DAY = 86_400_000;
const CATEGORY_LABEL = new Map<string, string>(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));

function utcMidnight(d: Date) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function rangeFor(r: Exclude<Range, "custom">): { start: number; end: number } {
  const now = new Date();
  const end = utcMidnight(now) + DAY;
  if (r === "all") return { start: 0, end };
  if (r === "30") return { start: end - 30 * DAY, end };
  if (r === "90") return { start: end - 90 * DAY, end };
  if (r === "year") return { start: Date.UTC(now.getFullYear(), 0, 1), end };
  if (r === "last") return { start: Date.UTC(now.getFullYear(), now.getMonth() - 1, 1), end: Date.UTC(now.getFullYear(), now.getMonth(), 1) };
  return { start: Date.UTC(now.getFullYear(), now.getMonth(), 1), end };
}

export default function BankingPage() {
  return <React.Suspense fallback={<LoadingPanel label="Loading banking" />}><BankingRoute /></React.Suspense>;
}

function BankingRoute() {
  const params = useSearchParams();
  const from = Number(params.get("start") ?? NaN);
  const to = Number(params.get("end") ?? NaN);
  const reportRange = Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && from < to && to <= 8.64e15
    ? { start: from, end: to } : null;
  const requestedFilter = params.get("filter");
  const initialFilter = (["attention", "matched", "excluded", "in", "all"] as const).find((value) => value === requestedFilter) ?? "attention";
  return <BankingView key={params.toString()} reportRange={reportRange} initialFilter={initialFilter} />;
}

function BankingView({ reportRange, initialFilter }: { reportRange: { start: number; end: number } | null; initialFilter: Filter }) {
  const overview = useQuery(api.banking.overview, {});
  const [range, setRange] = React.useState<Range>(reportRange ? "custom" : "90");
  const [filter, setFilter] = React.useState<Filter>(initialFilter);
  const [search, setSearch] = React.useState("");
  const { start, end } = range === "custom" && reportRange ? reportRange : rangeFor(range === "custom" ? "90" : range);
  const { results: transactions, status: transactionStatus, loadMore } = usePaginatedQuery(
    api.banking.transactionsPage, { start, end, filter, search: search.trim() || undefined }, { initialNumItems: 50 },
  );
  React.useEffect(() => {
    // Sparse filters can exhaust a scan budget before finding any rows. Keep
    // searching so an empty intermediate page is never presented as no results.
    if (transactionStatus === "CanLoadMore" && transactions.length === 0) loadMore(50);
  }, [transactionStatus, transactions.length, loadMore]);

  const createLinkToken = useAction(api.banking.createLinkToken);
  const createUpdateLinkToken = useAction(api.banking.createUpdateLinkToken);
  const exchange = useAction(api.banking.exchangePublicToken);
  const refresh = useMutation(api.banking.refresh);
  const [connecting, setConnecting] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState<{ id: Id<"bankConnections">; name: string } | null>(null);

  const repairing = React.useRef<Id<"bankConnections"> | null>(null);
  const openLink = usePlaidLink({
    onSuccess: async (publicToken) => {
      try {
        if (repairing.current) {
          await refresh({ connectionId: repairing.current, linkCompleted: true });
          toast.success("Bank reconnected. Syncing now.");
        } else {
          const res = await exchange({ publicToken });
          toast.success(`${res.institutionName} connected. Importing transactions.`);
        }
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        repairing.current = null;
        setConnecting(false);
      }
    },
    onExit: (message) => {
      repairing.current = null;
      setConnecting(false);
      if (message && message !== "Closed.") toast.error(message);
    },
  });

  async function connect() {
    setConnecting(true);
    try {
      const { linkToken } = await createLinkToken({});
      await openLink(linkToken);
    } catch (err) {
      setConnecting(false);
      toast.error(errorMessage(err));
    }
  }

  async function reconnect(connectionId: Id<"bankConnections">) {
    setConnecting(true);
    try {
      repairing.current = connectionId;
      const { linkToken } = await createUpdateLinkToken({ connectionId });
      await openLink(linkToken);
    } catch (err) {
      repairing.current = null;
      setConnecting(false);
      toast.error(errorMessage(err));
    }
  }

  if (overview === undefined) return <LoadingPanel label="Loading banking" />;

  const live = overview.connections.filter((c) => c.status !== "revoked");

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Finance"
        title="Banking"
        description="Your bank and card accounts, synced through Plaid. Sort out what is spending and put it in the books; receipts match on their own."
        actions={
          overview.canManage && overview.configured ? (
            <Button onClick={connect} disabled={connecting}>
              <Plus className="size-4" />
              {connecting ? "Opening…" : "Connect a bank"}
            </Button>
          ) : undefined
        }
      />

      {overview.environment === "sandbox" && overview.configured && (
        <p className="rounded-md border border-caution/30 bg-caution/10 px-3 py-2 text-xs text-caution">
          Test mode: bank connections use Plaid&apos;s sandbox banks, not real accounts.
        </p>
      )}

      {!overview.configured ? (
        <EmptyState icon={Landmark} title="Bank connections aren't set up yet" description="Pulse needs its Plaid keys before a bank can be connected." />
      ) : (
        <>
          <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Cash on hand" value={money(overview.cashOnHandCents, { compact: true })} icon={Landmark} accent hint="checking and savings" />
            <StatTile label="Owed on cards" value={money(overview.cardOwedCents, { compact: true })} icon={CreditCard} hint="card balances" />
            <StatTile label="To reconcile" value={String(overview.unmatchedOutflows + overview.unmatchedInflows)} icon={AlertTriangle} hint={`${overview.unmatchedOutflows} spending · ${overview.unmatchedInflows} deposits, 90 days`} />
            <StatTile label="Connected" value={String(live.length)} icon={Link2} hint={live.length === 1 ? "bank" : "banks"} />
          </div>

          {overview.connections.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No bank connected"
              description={overview.canManage ? "Connect the studio's business bank or card to import balances and two years of transactions." : "Ask the studio owner to connect the business bank."}
              action={overview.canManage ? <Button onClick={connect} disabled={connecting}><Plus className="size-4" /> Connect a bank</Button> : undefined}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {overview.connections.map((c) => {
                const st = CONNECTION_STATUS[c.status] ?? CONNECTION_STATUS.error;
                return (
                  <div key={c._id} className="space-y-3 rounded-lg border border-graphite/50 bg-coal/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-bone">{c.institutionName}</p>
                        <p className="font-meta text-[0.6875rem] text-steel/80">
                          {c.lastSyncedAt ? `Synced ${relativeTime(c.lastSyncedAt)}` : "Not synced yet"}
                          {c.connectedBy ? ` · connected by ${c.connectedBy}` : ""}
                        </p>
                      </div>
                      <Badge tone={st.tone} dot>{st.label}</Badge>
                    </div>
                    {c.lastSyncError && <p className="text-xs text-caution">{c.lastSyncError}</p>}
                    {c.newAccountsAvailable && <p className="text-xs text-caution">Your bank account access has changed. Review which accounts you share with Pulse.</p>}
                    <ul className="divide-y divide-graphite/40">
                      {c.accounts.filter((a) => !a.hidden).map((a) => (
                        <li key={a._id} className="flex items-center justify-between py-2 text-sm">
                          <span className="text-steel">
                            {a.name}{a.mask ? ` ••${a.mask}` : ""}
                            <span className="ml-2 text-xs text-steel/60">{a.subtype ?? a.type}</span>
                          </span>
                          <span className="font-meta text-bone">{a.currentCents !== null ? money(a.currentCents) : "-"}</span>
                        </li>
                      ))}
                    </ul>
                    {overview.canManage && c.status !== "revoked" && (
                      <div className="flex flex-wrap gap-2">
                        {(c.status === "login_required" || c.status === "expiring" || c.newAccountsAvailable) ? (
                          <Button size="sm" onClick={() => reconnect(c._id)} disabled={connecting}>{c.newAccountsAvailable && c.status === "active" ? "Review accounts" : "Reconnect"}</Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={async () => {
                            try { await refresh({ connectionId: c._id }); toast.success("Syncing now."); } catch (err) { toast.error(errorMessage(err)); }
                          }}>
                            <RefreshCw className="size-3.5" /> Sync now
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setDisconnecting({ id: c._id, name: c.institutionName })}>Disconnect</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {([
                ["attention", "Needs attention"],
                ["matched", "Matched"],
                ["excluded", "Not spending"],
                ["in", "Money in"],
                ["all", "All"],
              ] as const).map(([value, label]) => (
                <Button key={value} size="sm" variant={filter === value ? "primary" : "ghost"} onClick={() => setFilter(value)}>{label}</Button>
              ))}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-steel/60" />
                  <Input aria-label="Search transactions" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-44 pl-8" />
                </div>
                <div className="w-40">
                  <Select value={range} onValueChange={(v) => setRange(v as Range)}>
                    <SelectTrigger aria-label="Period"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="90">Last 90 days</SelectItem>
                      <SelectItem value="month">This month</SelectItem>
                      <SelectItem value="last">Last month</SelectItem>
                      <SelectItem value="year">This year</SelectItem>
                      <SelectItem value="all">All history</SelectItem>
                      {reportRange && <SelectItem value="custom">Report period</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {range === "custom" && <p className="text-xs text-steel">Report period: {bankDay(start, true)} to {bankDay(end - 1, true)}</p>}
            <TransactionsTable rows={transactionStatus !== "Exhausted" && transactions.length === 0 ? undefined : transactions} canEdit={overview.canEdit} />
            {transactions.length > 0 && transactionStatus !== "Exhausted" && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-steel">{transactions.length.toLocaleString()} transactions loaded</p>
                <Button size="sm" variant="secondary" disabled={transactionStatus !== "CanLoadMore"} onClick={() => loadMore(50)}>
                  {transactionStatus === "LoadingMore" ? "Loading…" : "Load more transactions"}
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      <DisconnectDialog target={disconnecting} onClose={() => setDisconnecting(null)} />
    </div>
  );
}

type TxnRow = FunctionReturnType<typeof api.banking.transactionsPage>["page"][number];

function TransactionsTable({ rows, canEdit }: { rows: TxnRow[] | undefined; canEdit: boolean }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<TxnRow | null>(null);
  const [classifying, setClassifying] = React.useState<TxnRow | null>(null);
  const [history, setHistory] = React.useState<TxnRow | null>(null);
  const setExcluded = useMutation(api.banking.setExcluded);
  const setCategory = useMutation(api.banking.setCategory);
  const unmatch = useMutation(api.reconcile.unmatch);

  if (rows === undefined) return <LoadingPanel label="Loading transactions" />;
  if (rows.length === 0) return <p className="rounded-md border border-dashed border-graphite/60 px-4 py-8 text-center text-sm text-steel/70">Nothing here for this period.</p>;

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); toast.success(ok); } catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Description</TH>
            <TH>Category</TH>
            <TH>Books</TH>
            <TH className="text-right">Amount</TH>
            <TH className="w-10" />
          </TR>
        </THead>
        <TBody>
          {rows.map((t) => {
            const expanded = open === t._id;
            const out = t.direction === "out";
            return (
              <React.Fragment key={t._id}>
                <TR>
                  <TD className="whitespace-nowrap font-meta text-steel">{bankDay(t.date)}</TD>
                  <TD>
                    <p className="text-bone">{t.merchantName ?? t.name}</p>
                    <p className="font-meta text-[0.6875rem] text-steel/70">
                      {t.account ? `${t.account.name}${t.account.mask ? ` ••${t.account.mask}` : ""}` : ""}
                      {t.pending ? " · pending" : ""}
                    </p>
                  </TD>
                  <TD>
                    {out && !t.excluded && canEdit ? (
                      <Select value={t.category ?? ""} onValueChange={(v) => run(() => setCategory({ id: t._id, category: v as never }), "Category saved.")}>
                        <SelectTrigger aria-label="Category" className="h-8 w-36"><SelectValue placeholder="Choose" /></SelectTrigger>
                        <SelectContent>
                          {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-steel">{out
                        ? t.excluded ? "-" : t.category ? CATEGORY_LABEL.get(t.category) ?? t.category : "-"
                        : t.incomeCategory ? INCOME_CATEGORY_LABEL.get(t.incomeCategory) ?? t.incomeCategory
                          : t.moneyInKind ? MONEY_IN_KIND_LABEL.get(t.moneyInKind) ?? t.moneyInKind : "Needs review"}</span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {t.expense && <Badge tone="positive">In books</Badge>}
                      {t.receipt && <Badge tone="info">Receipt</Badge>}
                      {t.excluded && <Badge>{EXCLUDE_REASON_LABEL[t.excludeReason ?? "other"]}</Badge>}
                      {out && !t.expense && !t.excluded && <Badge tone="caution">Not in books</Badge>}
                      {!out && t.moneyInKind && <Badge tone={t.moneyInKind === "income" ? "positive" : "info"}>{MONEY_IN_KIND_LABEL.get(t.moneyInKind) ?? t.moneyInKind}</Badge>}
                      {!out && !t.moneyInKind && !t.pending && <Badge tone="caution">Needs review</Badge>}
                    </div>
                  </TD>
                  <TD className={`text-right font-meta ${out ? "text-bone" : "text-positive"}`}>{out ? "-" : "+"}{money(t.amountCents)}</TD>
                  <TD>
                    <Button size="icon" variant="ghost" aria-label={expanded ? "Hide details" : "Show details"} onClick={() => setOpen(expanded ? null : t._id)}>
                      {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </Button>
                  </TD>
                </TR>
                {expanded && (
                  <TR>
                    <TD colSpan={6} className="bg-coal-2/40">
                      <div className="space-y-3 py-1">
                        <div className="flex flex-wrap gap-2">
                          {canEdit && out && !t.expense && !t.excluded && !t.pending && (
                            <Button size="sm" onClick={() => setAdding(t)}><BookPlus className="size-3.5" /> Add to books</Button>
                          )}
                          {canEdit && !out && !t.pending && (
                            <Button size="sm" onClick={() => setClassifying(t)}><Tags className="size-3.5" /> {t.moneyInKind ? "Change classification" : "Classify money in"}</Button>
                          )}
                          {canEdit && out && !t.expense && (
                            t.excluded ? (
                              <Button size="sm" variant="secondary" onClick={() => run(() => setExcluded({ id: t._id, excluded: false }), "Counted as spending again.")}><Undo2 className="size-3.5" /> Count as spending</Button>
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => run(() => setExcluded({ id: t._id, excluded: true, reason: "other" }), "Marked as not spending.")}><Ban className="size-3.5" /> Not a business cost</Button>
                            )
                          )}
                          {canEdit && t.expense && (
                            <Button size="sm" variant="ghost" onClick={() => run(() => unmatch({ a: { kind: "transaction", id: t._id }, b: { kind: "expense", id: t.expense!._id } }), "Removed from the books match.")}>Undo books match</Button>
                          )}
                          {canEdit && t.receipt && (
                            <Button size="sm" variant="ghost" onClick={() => run(() => unmatch({ a: { kind: "transaction", id: t._id }, b: { kind: "receipt", id: t.receipt!._id } }), "Receipt unmatched.")}>Undo receipt match</Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setHistory(t)}><History className="size-3.5" /> History</Button>
                        </div>
                        {out && (!t.expense || !t.receipt) && !t.excluded && <MatchSuggestions kind="transaction" id={t._id} canEdit={canEdit} />}
                      </div>
                    </TD>
                  </TR>
                )}
              </React.Fragment>
            );
          })}
        </TBody>
      </Table>
      <AddToBooksDialog row={adding} onClose={() => setAdding(null)} />
      <MoneyInDialog row={classifying} onClose={() => setClassifying(null)} />
      <FinanceHistorySheet
        open={history !== null}
        onOpenChange={(o) => { if (!o) setHistory(null); }}
        title={history ? `${history.merchantName ?? history.name} · ${money(history.amountCents)}` : ""}
        bankTransactionId={history?._id}
      />
    </>
  );
}

function MoneyInDialog({ row, onClose }: { row: TxnRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        {row && <MoneyInForm key={row._id} row={row} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function MoneyInForm({ row, onClose }: { row: TxnRow; onClose: () => void }) {
  const classify = useMutation(api.banking.classifyMoneyIn);
  const candidates = useQuery(api.banking.moneyInCandidates, { id: row._id });
  const [kind, setKind] = React.useState(row.moneyInKind ?? "income");
  const [incomeCategory, setIncomeCategory] = React.useState(row.incomeCategory ?? "recording_sessions");
  const [note, setNote] = React.useState(row.moneyInNote ?? "");
  const [recordedMatch, setRecordedMatch] = React.useState(
    row.linkedRevenueType && row.linkedRevenueId ? `${row.linkedRevenueType}:${row.linkedRevenueId}` : "",
  );
  const [saving, setSaving] = React.useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Classify money in</DialogTitle>
        <DialogDescription>
          {`${row.merchantName ?? row.name}, ${money(row.amountCents)} on ${bankDay(row.date, true)}. Choose what this deposit represents so it is counted once.`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field label="What is it?" htmlFor="money-in-kind">
          <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
            <SelectTrigger id="money-in-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONEY_IN_KINDS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {kind === "income" && (
          <Field label="Income category" htmlFor="income-category">
            <Select value={incomeCategory} onValueChange={(value) => setIncomeCategory(value as typeof incomeCategory)}>
              <SelectTrigger id="income-category"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCOME_CATEGORIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        {kind === "recorded_payment" && (
          <Field label="Recorded payment" htmlFor="recorded-payment">
            <Select value={recordedMatch || (candidates?.length === 1 ? `${candidates[0].sourceType}:${candidates[0].sourceId}` : "")} onValueChange={setRecordedMatch}>
              <SelectTrigger id="recorded-payment"><SelectValue placeholder={candidates === undefined ? "Finding matches…" : "Choose a match"} /></SelectTrigger>
              <SelectContent>
                {(candidates ?? []).map((candidate) => (
                  <SelectItem key={`${candidate.sourceType}:${candidate.sourceId}`} value={`${candidate.sourceType}:${candidate.sourceId}`}>
                    {candidate.label} · {bankDay(candidate.collectedAt, true)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {candidates?.length === 0 && <p className="mt-1.5 text-xs text-caution">No same-amount payment was found within seven days. Choose another classification or check the recorded payment date.</p>}
          </Field>
        )}
        <Field label="Note or reference (optional)" htmlFor="money-in-note">
          <Input id="money-in-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Invoice, transfer, or payout reference" />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={saving} onClick={async () => {
          setSaving(true);
          try {
            const matchValue = recordedMatch || (candidates?.length === 1 ? `${candidates[0].sourceType}:${candidates[0].sourceId}` : "");
            const separator = matchValue.indexOf(":");
            const linkedRevenueType = separator > 0 ? matchValue.slice(0, separator) as "payment" | "invoice" : undefined;
            const linkedRevenueId = separator > 0 ? matchValue.slice(separator + 1) : undefined;
            await classify({
              id: row._id,
              kind: kind as never,
              incomeCategory: kind === "income" ? incomeCategory as never : undefined,
              note: note.trim() || undefined,
              linkedRevenueType: kind === "recorded_payment" ? linkedRevenueType : undefined,
              linkedRevenueId: kind === "recorded_payment" ? linkedRevenueId : undefined,
            });
            toast.success("Money in classified.");
            onClose();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setSaving(false);
          }
        }}>Save classification</Button>
      </DialogFooter>
    </>
  );
}

function AddToBooksDialog({ row, onClose }: { row: TxnRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        {row && <AddToBooksForm key={row._id} row={row} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function AddToBooksForm({ row, onClose }: { row: TxnRow; onClose: () => void }) {
  const addToBooks = useMutation(api.banking.addToBooks);
  const [category, setCategory] = React.useState<string>(row.category ?? "other");
  const [description, setDescription] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add to the books</DialogTitle>
        <DialogDescription>
          {`${row.merchantName ?? row.name}, ${money(row.amountCents)} on ${bankDay(row.date, true)}. It becomes an expense linked to this bank line.`}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <Field label="Category" htmlFor="atb-category">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="atb-category"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor="atb-note">
          <Input id="atb-note" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await addToBooks({ id: row._id, category: category as never, description: description.trim() || undefined });
              toast.success("Added to the books.");
              onClose();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          Add expense
        </Button>
      </DialogFooter>
    </>
  );
}

function DisconnectDialog({ target, onClose }: { target: { id: Id<"bankConnections">; name: string } | null; onClose: () => void }) {
  const disconnect = useAction(api.banking.disconnect);
  const [keepHistory, setKeepHistory] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Disconnect {target?.name}?</DialogTitle>
          <DialogDescription>Pulse stops syncing and Plaid&apos;s access to this bank is removed.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <label className="flex items-start gap-2 text-sm text-steel">
            <input type="radio" name="history" checked={keepHistory} onChange={() => setKeepHistory(true)} className="mt-1" />
            <span><span className="text-bone">Keep imported transactions</span><br />Past lines and their matches stay in the books.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-steel">
            <input type="radio" name="history" checked={!keepHistory} onChange={() => setKeepHistory(false)} className="mt-1" />
            <span><span className="text-bone">Delete imported transactions</span><br />Expenses already added stay; the bank lines go.</span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy || !target}
            onClick={async () => {
              if (!target) return;
              setBusy(true);
              try {
                await disconnect({ connectionId: target.id, keepHistory });
                toast.success(`${target.name} disconnected.`);
                onClose();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
