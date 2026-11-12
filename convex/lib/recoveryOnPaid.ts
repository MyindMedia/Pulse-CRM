import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/* ============================================================
   "Money Pulse won back" counts a fee or a chased invoice when the money
   is actually in, not when the bill is written. Every path that moves an
   invoice INTO paid calls this once: staff marking it paid
   (invoices.setStatus), the client paying online (invoicePay.settleInvoice)
   and a fee charged to a saved card (cardOnFile._markFeePaid).

   - A No-Show Shield fee invoice (sessions.createCancellationFeeInvoice)
     records no_show_fee / cancellation_fee.
   - Any other invoice paid after a reminder went out records
     reminder_collected.
   One event per invoice: an invoice that already has one (including fee
   events recorded at billing time before this change) is never counted
   again.
   ============================================================ */

const FEE_LABELS: { suffix: string; kind: "no_show_fee" | "cancellation_fee" }[] = [
  { suffix: "- no-show fee", kind: "no_show_fee" },
  { suffix: "- late cancellation fee", kind: "cancellation_fee" },
];

/** The fee kind when this is a No-Show Shield fee invoice, else null. */
export function feeKindOf(inv: Pick<Doc<"invoices">, "sessionId" | "lineItems">): "no_show_fee" | "cancellation_fee" | null {
  if (!inv.sessionId || inv.lineItems.length !== 1) return null;
  const label = inv.lineItems[0].label.toLowerCase();
  return FEE_LABELS.find((f) => label.endsWith(f.suffix))?.kind ?? null;
}

/** Call right after `inv` (the row as it was BEFORE the update) moved into paid. */
export async function recordRecoveryOnPaid(ctx: MutationCtx, inv: Doc<"invoices">): Promise<void> {
  if (inv.status === "paid" || inv.amountCents <= 0) return;
  const already = await ctx.db
    .query("recoveryEvents")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", inv._id))
    .first();
  if (already) return;

  const feeKind = feeKindOf(inv);
  if (feeKind) {
    await ctx.db.insert("recoveryEvents", {
      orgId: inv.orgId,
      kind: feeKind,
      amountCents: inv.amountCents,
      at: Date.now(),
      sessionId: inv.sessionId,
      invoiceId: inv._id,
      note: `${inv.lineItems[0].label} - paid`,
    });
    return;
  }
  if ((inv.reminderStage ?? 0) > 0) {
    await ctx.db.insert("recoveryEvents", {
      orgId: inv.orgId,
      kind: "reminder_collected",
      amountCents: inv.amountCents,
      at: Date.now(),
      invoiceId: inv._id,
      note: `Invoice ${inv.number} paid after reminder stage ${inv.reminderStage}`,
    });
  }
}
