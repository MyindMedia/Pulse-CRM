"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/errors";
import { amount, amounts, period, SOURCE_LABEL } from "./format";

type StatementRow = {
  _id: Id<"royaltyStatements">;
  periodStart: number | null;
  periodEnd: number | null;
  source: string;
};

/** One contributor's shares, grouped by statement, with mark-paid per statement. */
export function ContributorSheet({
  contributorKey,
  name,
  statements,
  onClose,
}: {
  contributorKey: string | null;
  name: string;
  statements: StatementRow[];
  onClose: () => void;
}) {
  const shares = useQuery(
    api.royalties.contributorShares,
    contributorKey ? { contributorKey } : "skip",
  );
  const markPaid = useMutation(api.royalties.markPaid);
  const sendStatement = useAction(api.royaltyStatements.send);
  const revokeLink = useMutation(api.royaltyStatements.revoke);
  const hasEmail = Boolean(
    contributorKey && !contributorKey.startsWith("name:"),
  );
  const [method, setMethod] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const groups = React.useMemo(() => {
    const by = new Map<string, NonNullable<typeof shares>>();
    for (const s of shares ?? [])
      by.set(s.statementId, [...(by.get(s.statementId) ?? []), s]);
    return [...by.entries()].map(([statementId, rows]) => {
      const st = statements.find((x) => x._id === statementId);
      const owed: Record<string, number> = {};
      for (const r of rows)
        if (!r.paidAt)
          owed[r.currency] = (owed[r.currency] ?? 0) + r.amountCents;
      return {
        statementId: statementId as Id<"royaltyStatements">,
        label: st
          ? `${period(st.periodStart, st.periodEnd)} · ${SOURCE_LABEL[st.source] ?? st.source}`
          : "Statement",
        rows,
        owed: Object.entries(owed).map(([currency, cents]) => ({
          currency,
          cents,
        })),
        paid: rows.every((r) => r.paidAt),
      };
    });
  }, [shares, statements]);

  async function setPaid(statementId: Id<"royaltyStatements">, paid: boolean) {
    if (!contributorKey) return;
    setBusy(statementId);
    try {
      const r = await markPaid({
        contributor: { key: contributorKey, statementId },
        paid,
        method: method.trim() || undefined,
      });
      toast.success(
        paid
          ? `Marked ${r.changed} ${r.changed === 1 ? "share" : "shares"} paid.`
          : "Marked unpaid.",
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not update."));
    } finally {
      setBusy(null);
    }
  }

  async function send(statementId: Id<"royaltyStatements">) {
    if (!contributorKey) return;
    setBusy(`send:${statementId}`);
    try {
      const r = await sendStatement({ statementId, contributorKey });
      if (r.sent) toast.success(`Statement emailed to ${contributorKey}.`);
      else toast.error("The email did not go out. Try again in a minute.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not send the statement."));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!contributorKey) return;
    setBusy("revoke");
    try {
      const r = await revokeLink({ contributorKey });
      toast.success(
        r.revoked
          ? "Their statement link no longer works."
          : "They had no live link.",
      );
    } catch (err) {
      toast.error(errorMessage(err, "Could not revoke the link."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={contributorKey !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent placement="side" width="lg">
        <SheetHeader>
          <SheetTitle>{name || "Contributor"}</SheetTitle>
          <SheetDescription>
            {contributorKey && !contributorKey.startsWith("name:")
              ? contributorKey
              : "No email on the split sheet"}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          {hasEmail && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-graphite/50 bg-coal px-3 py-2">
              <p className="text-xs text-steel">
                Send a statement to email them their shares with a private link
                to their history.
              </p>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === "revoke"}
                onClick={() => void revoke()}
              >
                Revoke link
              </Button>
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-steel">
              Paid by (shown on the record)
            </span>
            <Input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="Zelle, check, bank transfer…"
            />
          </label>
          {shares === undefined ? (
            <Spinner />
          ) : (
            groups.map((g) => (
              <section
                key={g.statementId}
                className="space-y-2 rounded-lg border border-graphite/50 bg-coal p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-bone">{g.label}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasEmail && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy === `send:${g.statementId}`}
                        onClick={() => void send(g.statementId)}
                      >
                        Send statement
                      </Button>
                    )}
                    {g.paid ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === g.statementId}
                        onClick={() => void setPaid(g.statementId, false)}
                      >
                        Mark unpaid
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={busy === g.statementId}
                        onClick={() => void setPaid(g.statementId, true)}
                      >
                        Mark {amounts(g.owed)} paid
                      </Button>
                    )}
                  </div>
                </div>
                <ul className="divide-y divide-graphite/40">
                  {g.rows.map((r) => (
                    <li
                      key={r._id}
                      className="flex items-center gap-2 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-mist">
                        {r.songTitle}
                      </span>
                      <span className="font-meta text-xs text-steel">
                        {r.pct}%
                      </span>
                      <span className="w-24 text-right font-meta text-bone">
                        {amount(r.amountCents, r.currency)}
                      </span>
                      {r.paidAt ? (
                        <Badge tone="positive">
                          Paid {new Date(r.paidAt).toLocaleDateString()}
                          {r.paidMethod ? ` · ${r.paidMethod}` : ""}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Owed</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
