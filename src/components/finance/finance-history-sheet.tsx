"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Bot, Cpu, User } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LoadingPanel } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import { actionLabel, actorLabel } from "./finance-labels";

/* The paper trail for one receipt, expense or bank line, and whatever it is
   linked to: who uploaded it, what the AI read, how it was matched and why,
   and every change since. Read-only; the log is append-only on the server. */

function describe(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (k.toLowerCase().endsWith("cents") && typeof v === "number") parts.push(`${k.replace(/Cents$/, "")} ${money(v)}`);
    else if (k === "date" && typeof v === "number") parts.push(`date ${new Date(v).toISOString().slice(0, 10)}`);
    else parts.push(`${k} ${String(v)}`);
  }
  return parts.length ? parts.join(", ") : null;
}

export function FinanceHistorySheet({
  open,
  onOpenChange,
  title,
  receiptId,
  expenseId,
  bankTransactionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  receiptId?: Id<"receipts">;
  expenseId?: Id<"expenses">;
  bankTransactionId?: Id<"bankTransactions">;
}) {
  const rows = useQuery(
    api.reconcile.history,
    open ? { receiptId, expenseId, bankTransactionId } : "skip",
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
          <SheetDescription>{title}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {rows === undefined ? (
            <LoadingPanel label="Loading history" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-steel">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-4">
              {rows.map((r) => {
                const Icon = r.actorType === "ai" ? Bot : r.actorType === "system" ? Cpu : User;
                const before = describe(r.before);
                const after = describe(r.after);
                return (
                  <li key={r._id} className="flex gap-3">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-graphite/60 bg-coal-2">
                      <Icon className="size-3.5 text-steel" />
                    </span>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm text-bone">{actionLabel(r.action)}</p>
                      <p className="font-meta text-[0.6875rem] text-steel/80">
                        {actorLabel(r.actorType, r.actorName)} · {new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {r.model ? ` · ${r.model}` : ""}
                        {r.score !== null ? ` · score ${r.score}` : ""}
                      </p>
                      {r.reasons.length > 0 && <p className="text-xs text-steel">{r.reasons.join(", ")}</p>}
                      {before && <p className="text-xs text-steel/80">Before: {before}</p>}
                      {after && <p className="text-xs text-steel/80">After: {after}</p>}
                      {r.detail && <p className="text-xs text-steel/70">{r.detail}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
