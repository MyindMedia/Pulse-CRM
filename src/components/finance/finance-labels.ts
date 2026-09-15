/* Shared words and dates for the finance screens. */

export const EXCLUDE_REASON_LABEL: Record<string, string> = {
  transfer: "Transfer",
  card_payment: "Card payment",
  loan: "Loan payment",
  personal: "Personal",
  other: "Not a business cost",
};

export const CONNECTION_STATUS: Record<string, { label: string; tone: "positive" | "caution" | "critical" | "info" | "neutral" }> = {
  active: { label: "Connected", tone: "positive" },
  syncing: { label: "Syncing", tone: "info" },
  login_required: { label: "Needs sign-in", tone: "caution" },
  expiring: { label: "Access expiring", tone: "caution" },
  error: { label: "Sync problem", tone: "critical" },
  revoked: { label: "Disconnected", tone: "neutral" },
};

export const RECEIPT_STATUS: Record<string, { label: string; tone: "positive" | "caution" | "critical" | "info" | "neutral" }> = {
  reading: { label: "Reading", tone: "info" },
  ready: { label: "Read", tone: "positive" },
  needs_review: { label: "Check details", tone: "caution" },
  failed: { label: "Not readable", tone: "critical" },
};

/** Bank and receipt days are stored as UTC midnight; show that day everywhere. */
export function bankDay(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

export function dayInputValue(ms: number | null | undefined): string {
  return ms ? new Date(ms).toISOString().slice(0, 10) : "";
}

export function dayFromInput(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

const ACTION_LABEL: Record<string, string> = {
  "receipt.uploaded": "Receipt uploaded",
  "receipt.read": "AI read the receipt",
  "receipt.read_failed": "Receipt could not be read",
  "receipt.corrected": "Receipt details corrected",
  "receipt.deleted": "Receipt deleted",
  "match.auto": "Matched automatically",
  "match.confirmed": "Match confirmed",
  "match.chained": "Linked to complete the match",
  "match.undone": "Match undone",
  "match.moved_to_posted": "Pending charge posted",
  "suggestion.rejected": "Suggestion rejected",
  "suggestion.shown": "Match suggested for confirmation",
  "expense.created_from_receipt": "Expense created from receipt",
  "expense.created_from_transaction": "Added to the books from the bank",
  "expense.deleted": "Expense deleted",
  "transaction.categorized": "Category changed",
  "transaction.excluded": "Marked as not spending",
  "transaction.included": "Counted as spending again",
  "bank.connected": "Bank connected",
  "bank.reconnected": "Bank reconnected",
  "bank.synced": "Bank synced",
  "bank.sync_failed": "Bank sync failed",
  "bank.login_required": "Bank needs sign-in",
  "bank.expiring": "Bank access expiring",
  "bank.revoked_at_bank": "Access revoked at the bank",
  "bank.disconnected": "Bank disconnected",
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function actorLabel(actorType: string, actorName: string | null): string {
  if (actorType === "ai") return "AI";
  if (actorType === "system") return "Pulse";
  return actorName ?? "Someone";
}
