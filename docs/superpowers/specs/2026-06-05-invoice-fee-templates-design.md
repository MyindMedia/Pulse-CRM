# Invoice fee templates + one-off line items

**Date:** 2026-06-05
**Status:** Approved (design)
**Area:** Invoicing (`convex/feeTemplates.ts` new, `convex/invoices.ts`,
`src/components/payments/create-invoice-dialog.tsx`,
`src/components/settings/pricing-panel.tsx`)

## Problem

Pulse's structured pricing is hourly-only, so per-song and flat fees (e.g.
Slang City's Mixing & Mastering $100/song, member rate $65/song, $79 annual
maintenance) can't be represented as products. They have to be retyped as
one-off invoice line items every time. The New Invoice dialog already supports
free-form one-off lines (`{label, amountCents}`); what's missing is a **reusable
saved-fee library** so a studio can one-click add common charges and turn any
one-off into a template.

## Decision

Add a per-studio **fee template** library. At invoice time the user can either
add a one-off line (existing behavior) or pull from saved fees; any one-off line
can be saved as a template for reuse. Flat amounts only (no quantity multiplier,
per owner decision) — adjust the amount inline if needed.

## Backend

New table (no change to `invoices.lineItems`, which stays `{label, amountCents}`):

```ts
feeTemplates: defineTable({
  orgId: v.string(),
  label: v.string(),
  amountCents: v.number(),
  description: v.optional(v.string()),
  active: v.boolean(),
  createdAt: v.number(),
}).index("by_org", ["orgId"]),
```

New `convex/feeTemplates.ts` (all tenant-scoped via `currentOrg`):
- `list({ activeOnly? })` — `requireCapability("invoices.read")`, sorted by label.
- `create({ label, amountCents, description? })` — `requireCapability("invoices.send")`; rejects empty label / non-positive amount; `active: true`.
- `update({ id, label?, amountCents?, description?, active? })` — `invoices.send`; org-guard on the row.
- `remove({ id })` — `invoices.send`; org-guard.

(`setActive` folded into `update`. Capability choice mirrors invoice writes:
owner/manager/accountant carry `invoices.send`; `invoices.read` is broad enough
for the picker.)

## Frontend

**`create-invoice-dialog.tsx`:**
- "Add saved fee" control (dropdown/menu) listing active templates; selecting one
  appends a line prefilled with `label` + dollar amount, still editable.
- "Save as fee" affordance on each custom line with a non-empty label + positive
  amount → calls `feeTemplates.create`, toasts confirmation. Idempotency is not
  enforced (a studio may intentionally keep similar fees); duplicates are fine.

**`pricing-panel.tsx`** (extend, don't add a new tab):
- "Saved fees" section: list templates with inline edit (label + amount),
  activate/deactivate toggle, delete; an "Add fee" row. Reuses the existing
  panel's card/list styling.

## Testing (TDD, `convex/feeTemplates.test.ts`)

1. create → list returns it; amount + label persisted; `active` defaults true.
2. create rejects empty label and amount <= 0.
3. update changes fields; `active:false` hides it from `list({activeOnly:true})`.
4. remove deletes it.
5. tenant isolation: org A cannot read/update/remove org B's templates.

## Out of scope

- Quantity multipliers (flat amounts only).
- Auto-applying templates (e.g. annual fee) to invoices automatically.
- Linking fees to Stripe products (invoice lines are plain `{label, amount}`).

## Deploy

Adds a table + functions → needs `CONVEX_DEPLOY_KEY` deploy to
`pastel-corgi-340` and a Netlify build (git push) for the UI. Deploy-key access:
`export CONVEX_DEPLOY_KEY="$(op read 'op://Security/Convex PULSE CRM/deploy key')"`.
