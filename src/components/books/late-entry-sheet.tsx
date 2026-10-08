"use client";

import * as React from "react";
import { AlertTriangle, Plus, Upload01 } from "@untitledui/icons";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import {
  dayLabel,
  formatAmount,
  formatUsd,
  periodLabel,
} from "@/lib/books/money";
import {
  DEFAULT_LATE_REASON,
  LATE_KINDS,
  PAID_FROM_LABEL,
  categoryOptions,
  moneyDirection,
  paidFromHeading,
  paidFromOptions,
  type LateEntryKind,
  type PaidFrom,
} from "@convex/lib/lateEntries";
import { parsePeriod } from "@convex/lib/ledgerMath";
import {
  dayInput,
  defaultLateDay,
  parseAmount,
  parseDayInput,
  type LateEntryApi,
  type LateFormInput,
  type LatePreviewResult,
  type LateReversalPreview,
  type LateSuggestion,
} from "@/lib/books/late";
import type { AccountRow, LateSummary } from "@/lib/books/types";

const SELECT =
  "h-10 w-full rounded-md border border-graphite/60 bg-obsidian px-3 text-sm text-bone outline-none focus-visible:border-gold-dim focus-visible:ring-2 focus-visible:ring-gold/20";

const RECEIPT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf";

type Draft = {
  kind: LateEntryKind;
  date: string;
  counterparty: string;
  amount: string;
  accountId: string;
  paidFrom: PaidFrom | "";
  memo: string;
  reason: string;
};

function emptyDraft(period: string, now: number): Draft {
  return {
    kind: "expense",
    date: dayInput(defaultLateDay(parsePeriod(period), now)),
    counterparty: "",
    amount: "",
    accountId: "",
    paidFrom: "",
    memo: "",
    reason: DEFAULT_LATE_REASON,
  };
}

function fromSuggestion(s: LateSuggestion, accounts: AccountRow[]): Draft {
  const p = s.payload;
  return {
    kind: p.lateKind,
    date: dayInput(p.entryDate),
    counterparty: p.counterparty,
    amount: formatAmount(p.amountCents).replace(/,/g, ""),
    accountId:
      (p.accountKey && accounts.find((a) => a.key === p.accountKey)?._id) || "",
    paidFrom: p.paidFrom ?? "",
    memo: p.memo ?? "",
    reason: p.reason,
  };
}

/** "Add missed item": a short form for a missed invoice or receipt in a month
 *  that has ended, then a confirm step that shows what changes. Full height
 *  on a phone, a side sheet on a desktop. */
export function LateEntrySheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  period: string;
  accounts: AccountRow[];
  api: LateEntryApi;
  brandStyle?: React.CSSProperties;
  onDone: (message: string) => void;
}) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        width="md"
        style={props.brandStyle}
        aria-describedby="late-sheet-desc"
        data-testid="late-entry-sheet"
      >
        {/* Mounted only while open, so every opening starts a fresh form. */}
        {props.open && <LateEntryForm {...props} />}
      </SheetContent>
    </Sheet>
  );
}

function LateEntryForm({
  onOpenChange,
  period,
  accounts,
  api,
  onDone,
}: {
  onOpenChange: (open: boolean) => void;
  period: string;
  accounts: AccountRow[];
  api: LateEntryApi;
  onDone: (message: string) => void;
}) {
  const [draft, setDraft] = React.useState<Draft>(() =>
    emptyDraft(period, api.now),
  );
  const [file, setFile] = React.useState<File | null>(null);
  const [step, setStep] = React.useState<"form" | "confirm">("form");
  const [preview, setPreview] = React.useState<Extract<
    LatePreviewResult,
    { ok: true }
  > | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notDuplicate, setNotDuplicate] = React.useState(false);
  const [suggestion, setSuggestion] = React.useState<LateSuggestion | null>(
    null,
  );
  const fileRef = React.useRef<HTMLInputElement>(null);

  const p = parsePeriod(period);
  const lastDay = Math.min(
    p.end - 86_400_000,
    Date.UTC(
      new Date(api.now).getUTCFullYear(),
      new Date(api.now).getUTCMonth(),
      new Date(api.now).getUTCDate(),
    ),
  );
  const options = categoryOptions(
    draft.kind,
    accounts.map((a) => ({ ...a, id: a._id })),
  );
  const category = accounts.find((a) => a._id === draft.accountId) ?? null;
  const heading = paidFromHeading(draft.kind, category);
  const dir = category
    ? moneyDirection(draft.kind, category)
    : draft.kind === "income"
      ? "in"
      : "out";
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const label = periodLabel(period);

  function toInput(): LateFormInput | string {
    const entryDate = parseDayInput(draft.date);
    if (entryDate === null) return "Choose a date.";
    if (entryDate < p.start || entryDate >= p.end)
      return `Choose a date in ${label}.`;
    if (entryDate > lastDay) return "That date is in the future.";
    if (!draft.counterparty.trim())
      return draft.kind === "income"
        ? "Add the customer."
        : "Add the vendor or customer.";
    const amountCents = parseAmount(draft.amount);
    if (amountCents === null)
      return "Enter an amount greater than zero, like 19.00.";
    if (!draft.accountId) return "Choose a category.";
    if (!draft.paidFrom) return `Choose ${heading.toLowerCase()}.`;
    return {
      kind: draft.kind,
      entryDate,
      counterparty: draft.counterparty.trim(),
      amountCents,
      accountId: draft.accountId,
      paidFrom: draft.paidFrom,
      ...(draft.memo.trim() ? { memo: draft.memo.trim() } : {}),
      reason: draft.reason.trim() || DEFAULT_LATE_REASON,
    };
  }

  async function review(e: React.FormEvent) {
    e.preventDefault();
    const input = toInput();
    if (typeof input === "string") {
      setError(input);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.preview(period, input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res);
      setNotDuplicate(false);
      setStep("confirm");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const input = toInput();
    if (typeof input === "string" || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.submit(period, input, {
        file,
        ...(suggestion?.payload.receiptId && !file
          ? { receiptId: suggestion.payload.receiptId }
          : {}),
        allowDuplicate: preview.duplicates.length > 0 && notDuplicate,
        ...(suggestion ? { proposalId: suggestion._id } : {}),
      });
      onOpenChange(false);
      onDone(
        `Added to ${label}. Net income ${formatUsd(out.before.netIncomeCents)} to ${formatUsd(out.after.netIncomeCents)}.`,
      );
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const dupBlocked =
    !!preview && preview.duplicates.length > 0 && !notDuplicate;

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {step === "form"
            ? `Add missed item to ${label}`
            : "You are changing a past month"}
        </SheetTitle>
        <SheetDescription id="late-sheet-desc">
          {step === "form"
            ? "A missed invoice or receipt. It goes in dated inside the month, marked late. The statements you checked stay as they were."
            : `${label} has ended and may already be reported. Check what changes before you add it.`}
        </SheetDescription>
      </SheetHeader>

      {step === "form" ? (
        <form
          onSubmit={review}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          <SheetBody className="space-y-4">
            {api.suggestions.length > 0 && !suggestion && (
              <div className="space-y-2 rounded-lg border border-gold-dim/40 bg-gold/5 p-3">
                <p className="text-xs font-medium text-bone">
                  Suggested by Accounting
                </p>
                <ul className="space-y-1.5">
                  {api.suggestions.map((s) => (
                    <li
                      key={s._id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 text-bone/90">{s.title}</span>
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-graphite/70 px-2.5 py-1 text-xs text-bone hover:bg-coal-3"
                        onClick={() => {
                          setSuggestion(s);
                          setDraft(fromSuggestion(s, accounts));
                        }}
                      >
                        Use
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {suggestion && (
              <p className="rounded-lg border border-gold-dim/40 bg-gold/5 px-3 py-2 text-xs text-steel">
                From an Accounting suggestion. Check each field; adding it
                completes the suggestion.
              </p>
            )}

            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-steel">
                Type
              </legend>
              <div
                role="radiogroup"
                aria-label="Type"
                className="grid grid-cols-3 gap-1 rounded-lg border border-graphite/60 bg-obsidian p-1"
              >
                {LATE_KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === k.id}
                    onClick={() =>
                      set({ kind: k.id, accountId: "", paidFrom: "" })
                    }
                    className={cn(
                      "h-9 rounded-md text-sm transition-colors focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none",
                      draft.kind === k.id
                        ? "bg-gold text-gold-ink font-semibold"
                        : "text-steel hover:text-bone",
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Date"
                htmlFor="late-date"
                hint={`${dayLabel(p.start)} to ${dayLabel(lastDay)}`}
              >
                <Input
                  id="late-date"
                  type="date"
                  value={draft.date}
                  min={dayInput(p.start)}
                  max={dayInput(lastDay)}
                  onChange={(e) => set({ date: e.target.value })}
                  required
                />
              </Field>
              <Field label="Amount" htmlFor="late-amount">
                <Input
                  id="late-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={draft.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  required
                />
              </Field>
            </div>

            <Field
              label={
                draft.kind === "income"
                  ? "Customer"
                  : draft.kind === "refund"
                    ? "Vendor or customer"
                    : "Vendor"
              }
              htmlFor="late-who"
            >
              <Input
                id="late-who"
                value={draft.counterparty}
                maxLength={120}
                onChange={(e) => set({ counterparty: e.target.value })}
                required
              />
            </Field>

            <Field label="Category" htmlFor="late-category">
              <select
                id="late-category"
                className={SELECT}
                value={draft.accountId}
                onChange={(e) =>
                  set({ accountId: e.target.value, paidFrom: "" })
                }
                required
              >
                <option value="">Choose a category</option>
                {options.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={heading} htmlFor="late-paid">
              <select
                id="late-paid"
                className={SELECT}
                value={draft.paidFrom}
                onChange={(e) => set({ paidFrom: e.target.value as PaidFrom })}
                required
              >
                <option value="">Choose</option>
                {paidFromOptions(draft.kind).map((o) => (
                  <option key={o} value={o}>
                    {PAID_FROM_LABEL[dir][o]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Memo (optional)" htmlFor="late-memo">
              <Input
                id="late-memo"
                value={draft.memo}
                maxLength={300}
                onChange={(e) => set({ memo: e.target.value })}
              />
            </Field>

            <Field label="Why it is late" htmlFor="late-reason">
              <Input
                id="late-reason"
                value={draft.reason}
                maxLength={200}
                onChange={(e) => set({ reason: e.target.value })}
              />
            </Field>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-steel">
                Receipt or invoice (optional)
              </span>
              <label
                htmlFor="late-receipt"
                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-graphite/70 px-3 py-3 text-sm text-steel hover:border-gold-dim hover:text-bone"
              >
                <Upload01 className="size-4" aria-hidden />
                <span
                  className="min-w-0 truncate"
                  data-testid="late-receipt-name"
                >
                  {file
                    ? file.name
                    : suggestion?.payload.receiptId
                      ? "The suggested receipt will be attached"
                      : "Photo or PDF, up to 10 MB"}
                </span>
              </label>
              <input
                ref={fileRef}
                id="late-receipt"
                type="file"
                accept={RECEIPT_ACCEPT}
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <p
              role="alert"
              aria-live="polite"
              className="min-h-5 text-sm text-critical"
            >
              {error ?? ""}
            </p>
          </SheetBody>
          <SheetFooter className="justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Checking" : "Review"}
            </Button>
          </SheetFooter>
        </form>
      ) : (
        preview && (
          <>
            <SheetBody className="space-y-4">
              <div className="flex gap-3 rounded-lg border border-caution/40 bg-caution/10 p-3 text-sm text-bone">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-caution"
                  aria-hidden
                />
                <p>
                  This adds {formatUsd(preview.totalCents)} to {label}, dated{" "}
                  {dayLabel(parseDayInput(draft.date) ?? p.start)}.
                  {preview.hasReported
                    ? " The workbook you checked is not changed; Books shows this as a late entry."
                    : ""}
                </p>
              </div>

              <table className="w-full text-sm" data-testid="late-before-after">
                <caption className="sr-only">{label} before and after</caption>
                <thead>
                  <tr className="text-xs text-steel">
                    <th scope="col" className="py-1.5 text-left font-medium">
                      {label}
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Before
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-graphite/40">
                    <th
                      scope="row"
                      className="py-2 text-left font-normal text-bone"
                    >
                      Net income
                    </th>
                    <td className="py-2 text-right tabular-nums text-steel">
                      {formatUsd(preview.before.netIncomeCents)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-bone">
                      {formatUsd(preview.after.netIncomeCents)}
                    </td>
                  </tr>
                  <tr className="border-t border-graphite/40">
                    <th
                      scope="row"
                      className="py-2 text-left font-normal text-bone"
                    >
                      Cash at month end
                    </th>
                    <td className="py-2 text-right tabular-nums text-steel">
                      {formatUsd(preview.before.endingCashCents)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-bone">
                      {formatUsd(preview.after.endingCashCents)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="rounded-lg border border-graphite/60 bg-coal-2 p-3 text-sm">
                <p className="text-bone">{preview.memo}</p>
                <ul className="mt-2 space-y-1 text-xs text-steel">
                  {preview.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>
                        {l.debitCents ? "Debit" : "Credit"} {l.accountName}
                      </span>
                      <span className="tabular-nums">
                        {formatAmount(l.debitCents || l.creditCents)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-steel">
                  Reason: {preview.reason}
                  {file ? ` · Receipt: ${file.name}` : ""}
                </p>
              </div>

              {preview.duplicates.length > 0 && (
                <div
                  className="space-y-2 rounded-lg border border-caution/40 bg-caution/5 p-3 text-sm"
                  data-testid="late-duplicates"
                >
                  <p className="font-medium text-bone">
                    This may already be in the books
                  </p>
                  <ul className="space-y-1 text-steel">
                    {preview.duplicates.map((d) => (
                      <li key={d.id}>
                        {d.memo}, {dayLabel(d.entryDate)},{" "}
                        {formatUsd(d.totalCents)} ({d.why})
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-start gap-2 text-bone">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={notDuplicate}
                      onChange={(e) => setNotDuplicate(e.target.checked)}
                    />
                    <span>It is a different charge. Add it anyway.</span>
                  </label>
                </div>
              )}

              <p
                role="alert"
                aria-live="polite"
                className="min-h-5 text-sm text-critical"
              >
                {error ?? ""}
              </p>
            </SheetBody>
            <SheetFooter className="justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("form")}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={confirm}
                disabled={busy || dupBlocked}
              >
                {busy ? "Adding" : `Add to ${label}`}
              </Button>
            </SheetFooter>
          </>
        )
      )}
    </>
  );
}

export type ReverseTarget = Pick<
  LateSummary,
  "id" | "memo" | "entryDate" | "totalCents"
>;

/** Cancel a late entry with a reversing entry: a reason, what changes, confirm. */
export function LateReverseSheet(props: {
  entry: ReverseTarget | null;
  onOpenChange: (open: boolean) => void;
  api: LateEntryApi;
  brandStyle?: React.CSSProperties;
  onDone: (message: string) => void;
}) {
  return (
    <Sheet open={!!props.entry} onOpenChange={props.onOpenChange}>
      <SheetContent
        width="sm"
        style={props.brandStyle}
        aria-describedby="late-rev-desc"
        data-testid="late-reverse-sheet"
      >
        {props.entry && (
          <LateReverseForm
            key={props.entry.id}
            {...props}
            entry={props.entry}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function LateReverseForm({
  entry,
  onOpenChange,
  api,
  onDone,
}: {
  entry: ReverseTarget;
  onOpenChange: (open: boolean) => void;
  api: LateEntryApi;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [preview, setPreview] = React.useState<LateReversalPreview | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    api
      .reversePreview(entry.id)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(messageOf(e)));
    return () => {
      live = false;
    };
    // Once per entry: the preview is what reversing does now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  async function confirm() {
    if (!reason.trim()) {
      setError("Say why it is being reversed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.reverse(entry.id, reason.trim());
      onOpenChange(false);
      onDone(
        `Reversed. Net income ${formatUsd(out.before.netIncomeCents)} to ${formatUsd(out.after.netIncomeCents)}.`,
      );
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Reverse late entry</SheetTitle>
        <SheetDescription id="late-rev-desc">
          You are changing a past month. A reversing entry on the same date
          cancels it. Both stay in the journal; nothing is deleted.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-4">
        <p className="rounded-lg border border-graphite/60 bg-coal-2 p-3 text-sm text-bone">
          {entry.memo}, {dayLabel(entry.entryDate)},{" "}
          {formatUsd(entry.totalCents)}
        </p>
        {preview?.ok && (
          <dl
            className="grid grid-cols-2 gap-3 text-sm"
            data-testid="late-reverse-before-after"
          >
            <div>
              <dt className="text-xs text-steel">Net income</dt>
              <dd className="tabular-nums text-bone">
                {formatUsd(preview.before.netIncomeCents)} to{" "}
                {formatUsd(preview.after.netIncomeCents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-steel">Cash at month end</dt>
              <dd className="tabular-nums text-bone">
                {formatUsd(preview.before.endingCashCents)} to{" "}
                {formatUsd(preview.after.endingCashCents)}
              </dd>
            </div>
          </dl>
        )}
        {preview && !preview.ok && (
          <p className="text-sm text-critical">{preview.error}</p>
        )}
        <Field label="Why" htmlFor="late-rev-reason">
          <Textarea
            id="late-rev-reason"
            rows={3}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Entered twice"
          />
        </Field>
        <p
          role="alert"
          aria-live="polite"
          className="min-h-5 text-sm text-critical"
        >
          {error ?? ""}
        </p>
      </SheetBody>
      <SheetFooter className="justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={confirm}
          disabled={busy || (preview !== null && !preview.ok)}
        >
          {busy ? "Reversing" : "Reverse it"}
        </Button>
      </SheetFooter>
    </>
  );
}

/** The "Add missed item" button. */
export function AddMissedItemButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" onClick={onClick} data-testid="add-missed-item">
      <Plus className="size-4" aria-hidden />
      Add missed item
    </Button>
  );
}

function messageOf(err: unknown): string {
  const data = (err as { data?: unknown })?.data;
  if (data && typeof data === "object" && "message" in data)
    return String((data as { message: unknown }).message);
  if (typeof data === "string") return data;
  return err instanceof Error
    ? err.message
        .replace(/^.*Uncaught (ConvexError|Error): /, "")
        .split("\n")[0]
    : "Something went wrong.";
}
