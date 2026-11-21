# RD: A cancelled invoice can still be paid (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `client-messages-void-invoice-payable`.
Code read on `develop` (2026-11-12).

## What Pulse says
The public pay page (`/pay/invoice/<id>`) shows "Amount due" (`src/app/pay/invoice/[invoiceId]/page.tsx:81`) and a "Pay $X" button (`:107`).

## What actually happens today
- The page decides "paid" only from `status === "paid"` (`src/app/pay/invoice/[invoiceId]/page.tsx:38`). A `void` (cancelled) or `draft` invoice is shown as owed with a Pay button. The query already returns `void` and `draft` correctly (`convex/invoicePay.ts:18-21`, `effectiveStatus`); the page ignores it.
- `invoicePay.payViaStripe` refuses only `paid` (`convex/invoicePay.ts:72`), so it opens a real Stripe Checkout for a void or draft invoice.
- `settleInvoice` skips only `paid` (`convex/invoicePay.ts:104`), so the webhook (`convex/billingWebhooks.ts:202-216`) flips the void invoice to `paid`, and the client gets "this invoice is settled in full" and the team "Invoice paid online".

## Who is hurt and how
- **The client** pays an invoice the studio cancelled (for example a duplicate the studio voided and re-issued, so the client pays twice, or a fee the studio waived).
- **The studio** sees a cancelled invoice turn into "paid", and has to refund by hand.
- A pay link is only ever sent when an invoice is sent (`convex/invoices.ts:304`, `:352`) and by the overdue reminder (`convex/automation.ts:453`), so the client needs an old link to a since-voided invoice. That is exactly the duplicate-invoice case.

**Can it be happening in production now?** Yes. Pulse does not keep a status history for invoices, so a void invoice that was later paid simply looks `paid` now. How the owner can check: in each studio's Stripe dashboard, payments whose metadata has an `invoiceId`; ask the studio whether any of those invoices had been cancelled. In production Convex, `invoices` rows with `status: "paid"`, `paymentMethod: "card"` where a second invoice for the same client and amount also exists (the void-and-reissue pattern) are the likely cases.

## Cause (verified on develop)
`convex/invoicePay.ts:72`, `convex/invoicePay.ts:104`, `src/app/pay/invoice/[invoiceId]/page.tsx:38`. The audit description is correct. The audit's second reviewer is also right that `draft` invoices are equally payable by link.

## Proposed fix (smallest correct change)
1. `invoicePay.payViaStripe`: return `{ url: null }` (and the page shows the right state) unless status is `sent`, `viewed` or `overdue`.
2. `settleInvoice`: if the invoice is `void` (or `draft`, per decision), do not mark it paid. Record the payment against it as "paid while cancelled", alert the team, and refund (same refund helper as `truth-paid-after-release`; build that one first and reuse it).
3. Pay page: render "This invoice was cancelled. You do not owe anything on it." for `void`, and "This invoice is not ready yet" for `draft`; no Pay button.
Files: `convex/invoicePay.ts`, `src/app/pay/invoice/[invoiceId]/page.tsx`, `convex/billingWebhooks.ts` (only if the refund is scheduled there), tests in a new `convex/invoicePay.test.ts`.
**Schema:** none.
**One-time correction:** owner reviews any void-then-paid invoices found by the check above.

## Decisions for the owner
1. **Draft invoices.** No-show and late-cancel fee invoices are created as `draft` (`convex/sessions.ts:536`) and the client is emailed that an invoice was sent. Options: (a) block payment of drafts by link (recommended; drafts are not sent, and `chargeFee` settles drafts through its own path, `convex/cardOnFile.ts:153-230`, which this does not touch); (b) allow drafts to be paid. If (a), the fee email wording is fixed in `truth-saved-card-no-show`.
2. **Payment that still lands on a void invoice:** (a) refund automatically and tell the client (recommended); (b) keep it and alert the studio.

## Interim step (no money logic)
Page-only change: show "This invoice was cancelled" and hide the Pay button when `inv.status === "void"`. The query already returns that status, so this is a display change, low risk, and stops most clients from paying. It does not stop a Checkout tab opened before the void.

## Risk
- Refusing `draft` could block a studio that sends draft links by hand outside Pulse. Check with a quick look at whether any studio copies pay links from the app (the owner knows the studios).
- **Rollback:** revert the status checks; behaviour returns to today. No data changes.
