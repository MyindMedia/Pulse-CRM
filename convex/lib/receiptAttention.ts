import type { Doc } from "../_generated/dataModel";

type ReceiptState = Pick<Doc<"receipts">, "status" | "matchingPending" | "expenseId" | "bankTransactionId">;

/** Reading confidence and reconciliation are separate: a readable receipt can still need a match. */
export function receiptAttention(receipt: ReceiptState) {
  const fullyMatched = receipt.status === "ready" && Boolean(receipt.expenseId && receipt.bankTransactionId);
  const matchingPending = receipt.status === "ready" && receipt.matchingPending === true && !fullyMatched;
  const processing = receipt.status === "reading" || matchingPending;
  let attentionReason: string | null = null;
  if (receipt.status === "failed") attentionReason = "This receipt could not be read. Check the original file.";
  else if (receipt.status === "needs_review") attentionReason = "Check the receipt details before matching.";
  else if (!processing && !fullyMatched) {
    attentionReason = receipt.expenseId
      ? "Expense matched; bank transaction still needs a match."
      : receipt.bankTransactionId
        ? "Bank transaction matched; an expense still needs a match."
        : "No confident expense or bank match. Review the suggestions.";
  }
  return { matchingPending, processing, fullyMatched, needsAttention: attentionReason !== null, attentionReason };
}
