# Second Stripe account per team member (design only)

Feature G of `hardcover-booking.md`. Status: DESIGN, nothing built. The only code is the
off switch `MEMBER_STRIPE_ENABLED = false` in `convex/lib/payoutMath.ts`.
Written 2026-10-14. Not legal or tax advice: the tax and money-movement questions below need
a tax advisor and a `compliance-ops` pass before anyone builds this.

## What is being asked

Each team member (engineer, producer) can connect their own Stripe account, separate from the
studio's, so the money they earn reaches them through Stripe instead of a manual transfer the
owner makes outside Pulse.

Two jobs hide inside that sentence:

1. **The studio pays the member.** Payouts already queue in Pulse (`convex/payouts.ts`), are
   approved by a human, and are marked paid by hand. The member's Stripe account becomes where
   "paid" actually sends money.
2. **The member collects from the client.** A client pays the engineer's fee straight to the
   engineer at checkout. This changes every checkout path and who owns refunds and disputes.

This note recommends doing job 1 and not doing job 2 (see Options).

## How money moves today

- One Stripe Connect **Express** account per studio: `orgs.stripeAccountId`,
  `stripeChargesEnabled`, `stripeDetailsSubmitted` (`convex/stripeConnect.ts`).
- Every client payment is a **direct charge** on the studio's account (`{ stripeAccount }` header
  in `booking.ts`, `invoicePay.ts`, `packages.ts`, `memberships.ts`, `cardOnFile.ts`,
  `stripeConnect.createDepositCheckout`). Pulse takes no application fee today
  (`applicationFeeCents: 0`).
- Engineer pay: `queuePayoutForSession` queues a `payouts` row when a session completes
  (commission, points or hourly, with the arithmetic in `explanation`). `approve` and `markPaid`
  are separate human steps gated on `insights.read`. `markPaid` posts a `payroll` expense. No
  money moves through Stripe for staff.

## Options

| Option | How | Verdict |
|---|---|---|
| A. Member Express account, studio-funded transfer | Member onboards an Express account (transfers only). On "Pay with Stripe", Pulse moves the payout amount from the studio's connected account to the platform (an account debit), then transfers it to the member's account. Same `transfer_group` on both. | **Recommended.** Charges, refunds and disputes stay exactly where they are today. Only the payout step changes. |
| B. Switch to destination charges or separate charges and transfers | Pulse (the platform) charges the client and splits the funds to the studio and the engineer at booking time. | Not now. Pulse becomes the settlement merchant, so refunds, disputes and negative balances land on the platform. Rewrites every checkout path listed above. |
| C. Two direct charges at checkout | The client pays the studio and the engineer separately. | No. Two card authorizations for one booking, two receipts, partial failure states. |
| D. Store the member's account, keep paying by hand | Record the account for reference only. | No value on its own. |

**Account debit caveat (verify before build):** moving funds from a connected account back to the
platform (a transfer created with the studio's `Stripe-Account` header and the platform as
destination) is only allowed for some account types and countries, and Stripe can require the
platform to be responsible for that account's losses. Confirm with current Stripe Connect docs
and our account settings that this works for our US Express accounts. If it does not, the
fallback is that the studio funds a platform balance (top-up) that payouts draw from, which is
more friction for the owner.

## Data model (proposal; the orchestrator owns `convex/schema.ts`)

New table, not fields on `members`:

```
memberStripeAccounts: {
  orgId: string,
  memberId: Id<"members">,
  clerkUserId?: string,          // lets one freelancer reuse an account across studios (open question)
  stripeAccountId: string,       // acct_..., Express, transfers capability only
  payoutsEnabled: boolean,       // from account.updated
  detailsSubmitted: boolean,
  requirementsDue?: string[],    // currently_due, for the "finish setup" nudge
  bankLast4?: string,
  bankChangedAt?: number,        // drives the cool-down below
  createdAt: number,
  disconnectedAt?: number,
}
index by_org_member, by_stripe_account
```

Why a table: `members` is mirrored to the iOS app, which only tolerates optional additions and
should never carry Stripe ids; a table also keeps account history when a member disconnects and
reconnects.

Optional fields on `payouts`: `paidVia` ("manual" | "stripe"), `stripeDebitId` (studio to
platform), `stripeTransferId` (platform to member), `transferError`, `transferStartedAt`. The
status union stays `queued | approved | paid | void`, so nothing that reads payouts today changes.

Per studio opt-in: `orgs.memberStripePayouts?: boolean`, default off, owner only.

## Connect setup per member

- Express account, `capabilities: { transfers: { requested: true } }`. No `card_payments`: the
  member never charges a client in option A.
- Onboarding from the member's own profile page through Account Links (or embedded onboarding,
  same as `createAccountSession` for studios). Only the member can start it for themselves; an
  owner can see status, never the member's details.
- Status arrives through the existing Connect webhook (`account.updated`) and is matched by
  `by_stripe_account`. `payoutsEnabled` false means the "Pay with Stripe" button is disabled with
  the reason.

## How payouts.ts would use it

Today: `queued -> approve -> markPaid` (manual).

With the flag on and the studio opted in:

1. `queued -> approve`: unchanged.
2. New action `payViaStripe(id)`:
   - Gate: same as `markPaid` (`insights.read`), plus `MEMBER_STRIPE_ENABLED`, plus
     `orgs.memberStripePayouts`, plus the member has an account with `payoutsEnabled`.
   - Internal mutation stamps `transferStartedAt` (refuses if already set, so a double click
     cannot pay twice).
   - Stripe calls with idempotency keys derived from the payout id: debit from the studio
     account, then transfer to the member account, both with `transfer_group = payout id`.
   - Internal mutation marks the payout `paid` with `paidVia: "stripe"`, the two ids, and posts
     the same `payroll` expense `markPaid` posts today. One code path for the expense.
   - On failure: payout stays `approved`, `transferError` holds the plain reason
     ("Studio Stripe balance too low", "Engineer has not finished Stripe setup"), and the owner
     can retry or mark it paid by hand.
3. `markPaid` keeps working for anyone paid outside Stripe.

Automatic sending stays off: money leaving the building is always one person's click, as the
`payouts.ts` header says.

## KYC

Stripe's hosted Express onboarding collects identity, SSN or EIN, and bank details. Pulse stores
only the account id, status flags and bank last four. No tax ids or bank numbers ever touch Convex.

## Fees

- Express accounts carry a platform fee per active account per month plus a per-payout fee
  (check Stripe's current Connect pricing before quoting numbers to studios).
- Transfers between the platform and connected accounts are free; confirm the account debit is too.
- Decision needed: Pulse absorbs these, or shows them as a line on the payout. Recommended:
  absorb at first, measure, then decide. Pulse still takes no cut of the payout itself.

## Refunds and disputes

- Client refunds and disputes stay on the studio's account, exactly as today (direct charges).
- An engineer payout already sent is **not** clawed back automatically. Stripe can reverse a
  transfer only while the member's balance still holds it, which is unreliable after their payout.
- Instead: a refunded or disputed session with a `paid` payout shows a flag on the payouts screen;
  the owner decides, and any correction is a negative manual payout (`createManual`) so the record
  stays honest.

## 1099s and tax (needs an advisor)

- The studio is the payer to its contractor engineers, so the 1099-NEC is the studio's obligation.
- If Pulse moves the money through platform transfers, Stripe's Connect tax reporting may treat
  Pulse as the filer for those accounts (1099-K or 1099-NEC depending on configuration). Risk:
  the same dollars reported twice, once by the studio and once through Stripe.
- Decide before build: who files, which form, and whether Stripe tax reporting is turned on for
  member accounts. Export a per-member yearly total from `payouts` either way.
- **Employees must never be paid this way.** W-2 pay goes through payroll. Only members marked as
  contractors are eligible, and salaried or hourly employees (`payType` salary or hourly on
  payroll) are refused by the gate.

## Risks

- **Wrong person paid.** A compromised member login changes the bank account and collects the next
  payout. Mitigations: owner sees "bank changed" on the payout, 72-hour cool-down after
  `bankChangedAt`, email to the member and owner on every change.
- **Platform liability.** Account debits and Express accounts can leave Pulse responsible for
  negative balances. Confirm the loss-liability settings on the platform before enabling.
- **Money transmission.** Pulse moves funds between two third parties. Stripe Connect is designed
  for this, but confirm the account debit flow stays inside Stripe's covered use.
- **Insufficient studio balance.** The debit fails; handled as a plain retryable error.
- **Scope creep into option B.** Any request to "split at checkout" reopens refunds and disputes
  for the platform. Treat as a separate project.
- **Testing.** All tests stub `stripeClient()`; nothing calls Stripe live. Pentest the onboarding
  and pay endpoints before ship (security gate).

## The disabled flag

`MEMBER_STRIPE_ENABLED = false` in `convex/lib/payoutMath.ts`.

While false:

- No "Connect your Stripe" control on member profiles and no "Pay with Stripe" button.
- Every new endpoint (onboarding link, status, `payViaStripe`) throws a `FEATURE_DISABLED`
  ConvexError as its first line, before auth or any Stripe call.
- The webhook ignores member accounts.
- Payouts behave exactly as today: queue, approve, mark paid by hand.

Turning it on takes two steps on purpose: flip the constant in a reviewed deploy, then each owner
opts their studio in (`orgs.memberStripePayouts`).

## Open questions

1. One Stripe account per person across studios (keyed by `clerkUserId`) or one per membership?
2. Does the account debit work on our Express accounts (see caveat)? If not, is a studio-funded
   platform balance acceptable?
3. Who files the 1099 and on which form?
4. Who pays the Express account and payout fees?
5. Contractor flag: new field on `members`, or derive it from `payType`?

## Rough size once decided

About 2 days: schema (orchestrator), onboarding + webhook status (half day), `payViaStripe` with
idempotency and tests (1 day), profile and payouts UI (half day). Plus compliance and pentest
passes.
