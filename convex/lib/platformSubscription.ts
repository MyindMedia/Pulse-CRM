/* ============================================================
   Platform subscription lifecycle (Core / Growth / Max bought on
   /pricing). Pure helpers, no DB, so the rules are unit-tested.

   Stripe statuses (docs.stripe.com/billing/subscriptions/overview):
   - trialing, active        -> access on
   - past_due                -> access on, owner warned, Stripe retries
   - unpaid, paused,
     incomplete_expired,
     canceled                -> access off (studios paused)
   - incomplete              -> first payment still being confirmed: no change
   ============================================================ */

export type AgencyStatus = "active" | "trial" | "past_due" | "paused";

export type AgencyBillingAction =
  | { kind: "set"; status: Exclude<AgencyStatus, "paused"> }
  | { kind: "lock" }
  | { kind: "ignore" };

export function agencyActionForStatus(stripeStatus: string): AgencyBillingAction {
  switch (stripeStatus) {
    case "active":
      return { kind: "set", status: "active" };
    case "trialing":
      return { kind: "set", status: "trial" };
    case "past_due":
      return { kind: "set", status: "past_due" };
    case "unpaid":
    case "paused":
    case "incomplete_expired":
    case "canceled":
    case "cancelled":
      return { kind: "lock" };
    default:
      return { kind: "ignore" };
  }
}

/** Email the owner on the first failed attempt and on the last one (when Stripe
 *  has no further retry scheduled). The attempts in between stay quiet.
 *  attempt_count 0 means the bank asked for confirmation (3D Secure) and no
 *  charge was declined: invoice.payment_action_required emails that instead,
 *  so this stays quiet rather than warning that the plan is about to end. */
export function shouldEmailPaymentFailed(invoice: { attempt_count?: unknown; next_payment_attempt?: unknown }): boolean {
  const attempt = typeof invoice.attempt_count === "number" ? invoice.attempt_count : 1;
  if (attempt === 0) return false;
  const final = invoice.next_payment_attempt === null || invoice.next_payment_attempt === undefined;
  return attempt === 1 || final;
}

/** The subscription id on an invoice, across API versions (top-level
 *  `subscription` before 2025-03-31, `parent.subscription_details` after). */
export function invoiceSubscriptionId(invoice: Record<string, unknown>): string | undefined {
  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const raw = invoice.subscription ?? parent?.subscription_details?.subscription;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") return (raw as { id: string }).id;
  return undefined;
}
