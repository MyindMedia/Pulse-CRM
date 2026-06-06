# Per-user "acting-as" sub-account (global `activeOrgId` fix)

**Date:** 2026-06-05
**Status:** Approved (design)
**Area:** Access engine (`convex/lib/access.ts`, `convex/agency.ts`)

## Problem

An agency member "acts as" a studio sub-account by setting
`appState{key:"demo"}.activeOrgId`. That is a **single global row** shared by
every caller:

- `resolveViewer` reads it for all three `agency_member` paths
  (`access.ts` table path, legacy JWT fast-path, and the email-allowlist path)
  to populate `viewer.orgId` (the sub-account they're acting as).
- `enterAs` (`agency.ts`) writes it.
- Demo mode (no Clerk identity) also reads it as its active org.

Because the row is global, two agency staff cannot act-as different
sub-accounts at the same time — whoever calls `enterAs` last wins for
everyone. Agency activity also mutates what the unauthenticated demo surface
shows, and vice versa.

(There is a related but **separate** defect — an authenticated identity that
resolves to nothing falls through to demo mode and becomes owner of whatever
org is globally active. That is **explicitly out of scope** for this change per
owner decision; demo-mode behavior stays byte-for-byte as-is.)

## Decision

Make "acting-as" **per-user** for authenticated agency members, keyed by
`clerkUserId`, while leaving the demo path on the existing global row.

### Storage (Approach A — chosen)

Reuse the existing `appState` table (`{ key, activeOrgId? }`, indexed
`by_key`). No schema change.

- **Demo** (unchanged): `key = "demo"`.
- **Per agency user:** `key = "active:<clerkUserId>"`.

A single helper centralizes the key format:

```ts
// convex/lib/access.ts (or a small shared spot)
export const activeOrgKey = (clerkUserId: string) => `active:${clerkUserId}`;
```

Rejected alternatives: a dedicated `agencyActiveOrg` table (adds a migration
for no benefit over A); a field on `agencyMembers` (does not cover
allowlist-resolved viewers, which have no member row, and couples ephemeral
state into membership records).

## Behavior

### `enterAs(orgId?)` (`convex/agency.ts`)

- Resolve the caller.
- **Authenticated agency member:** keep the existing agency-scope guard (may
  only enter a sub-account whose `org.agencyId === viewer.agencyId`); then
  patch/insert the `appState` row keyed `active:<clerkUserId>` with
  `activeOrgId = orgId` (omitted `orgId` = exit back to console = clear it).
- **Not an agency member (demo / unauthenticated):** write the global
  `key:"demo"` row exactly as today.

### `resolveViewer` (`convex/lib/access.ts`)

- The three `agency_member` return paths set
  `orgId: <appState[active:<clerkUserId>]>?.activeOrgId` instead of the global
  `key:"demo"` row.
- **Demo mode path is untouched:** still
  `state(key:"demo")?.activeOrgId ?? "pulse-demo"`.

### Net effect

- Two agency staff act-as different sub-accounts concurrently without
  collision.
- Agency acting-as no longer changes the demo surface's org (and vice versa).
- `currentOrg` and every downstream consumer inherit the fix unchanged — they
  read `viewer.orgId`, whose source is now per-user.

## Isolation / correctness

- Acting-as remains **server-side state**, never trusted from client args
  (consistent with the `currentOrg` "orgId is never trusted from client"
  principle).
- The agency-scope guard in `enterAs` is preserved, so a user still cannot
  enter a sub-account outside their agency.
- Allowlist-resolved agency owners (no `agencyMembers` row) get per-user
  acting-as too, because the key is `clerkUserId`-based.

## Testing (TDD, `convex/lib/access.test.ts` + `convex/agency.test.ts`)

1. Two distinct agency identities enter different sub-accounts → each
   `resolveViewer` returns its own `orgId` (no cross-contamination).
2. An agency member entering a sub-account does **not** change the org that
   demo mode (no identity) resolves to.
3. Single agency member enter → `orgId` set; exit (`enterAs({})`) → `orgId`
   cleared (back to console).
4. Allowlist-resolved viewer's acting-as is per-user (enter a sub → that
   viewer's `orgId` is the sub; a different identity is unaffected).
5. `enterAs` writes the `active:<clerkUserId>` row when authenticated and the
   `key:"demo"` row when not.

## Out of scope

- Demo fallback / authenticated-→-demo-owner hole (owner decision: keep as-is).
- Broader `org.agencyId` integrity sweep.

## Deploy notes

Backend-only change to the access engine; takes effect on prod only after a
keyed `npx convex deploy` to `pastel-corgi-340` (agent env cannot reach cloud
Convex). No data migration required — old global-row state simply stops being
read by agency members; existing `key:"demo"` row continues serving demo.
