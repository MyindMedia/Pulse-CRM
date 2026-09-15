"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { bankDay } from "./finance-labels";

/* What this item probably matches, best first, with the reasons the score was
   given. Confirm links them; Not this remembers the pair so it never comes
   back. Scoring is deterministic server code (lib/financeMatch). */

type Kind = "receipt" | "expense" | "transaction";

const KIND_LABEL: Record<Kind, string> = { receipt: "Receipt", expense: "Expense", transaction: "Bank line" };

export function MatchSuggestions({ kind, id, canEdit, compact }: { kind: Kind; id: string; canEdit: boolean; compact?: boolean }) {
  const suggestions = useQuery(api.reconcile.suggestions, { kind, id });
  const confirm = useMutation(api.reconcile.confirm);
  const reject = useMutation(api.reconcile.reject);
  const recordShown = useMutation(api.reconcile.recordSuggestionsShown);
  const [busy, setBusy] = React.useState<string | null>(null);
  const visible = React.useMemo(() => suggestions?.slice(0, compact ? 2 : 5), [suggestions, compact]);

  React.useEffect(() => {
    if (!visible?.length) return;
    // Server-side deduplication covers rerenders, remounts and multiple tabs.
    void recordShown({ kind, id, candidates: visible.map((candidate) => ({ kind: candidate.kind, id: candidate.id, displayVersion: candidate.displayVersion })) })
      .catch((error) => { console.error("Could not record displayed match suggestions", error); });
  }, [kind, id, visible, recordShown]);

  if (suggestions === undefined) return <p className="text-xs text-steel/70">Looking for matches…</p>;
  if (suggestions.length === 0) return compact ? null : <p className="text-xs text-steel/70">No likely matches yet.</p>;

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="space-y-2">
      {visible!.map((s) => {
        const key = `${s.kind}:${s.id}`;
        return (
          <li key={key} className="flex flex-wrap items-center gap-2 rounded-md border border-graphite/50 bg-coal-2/60 px-3 py-2">
            <Badge tone={s.score >= 85 ? "positive" : "gold"}>{s.score}</Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-bone">
                <span className="text-steel/80">{KIND_LABEL[s.kind]}:</span> {s.label}
                {s.alreadyMatched && <span className="ml-2 text-xs text-caution">already matched</span>}
              </p>
              <p className="font-meta text-[0.6875rem] text-steel/80">
                {money(s.amountCents)} · {bankDay(s.dateMs)} · {s.reasons.join(", ")}
              </p>
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy !== null || s.alreadyMatched}
                  onClick={() => run(key, () => confirm({ a: { kind, id }, b: { kind: s.kind, id: s.id }, score: s.score, reasons: s.reasons }), "Matched.")}
                >
                  <Check className="size-3.5" /> Match
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => run(key, () => reject({ a: { kind, id }, b: { kind: s.kind, id: s.id } }), "Won't suggest that again.")}
                >
                  <X className="size-3.5" /> Not this
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
