# Agency Mode Foundation — Implementation Plan (Cycle 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the schema additions, central Access Engine, capability policies, and capability checks across the existing Convex surface — every existing function keeps working via a compat shim; new tables and the Access Engine are tested green; UI surfaces and billing come in Cycles 2 & 3.

**Architecture:** One central `requireCapability(ctx, cap, resource?)` resolver lives at `convex/lib/access.ts`. It looks up a `Viewer` (agency_member | studio_member | guest) from Clerk identity or a magic-link token, checks the static capability map in `convex/lib/access-policies.ts`, audits sensitive actions to `auditEvents`, and either returns the viewer or throws. The existing `currentOrg(ctx)` helper becomes a thin wrapper around `resolveViewer().orgId` so all 25 existing Convex files keep working unchanged.

**Tech Stack:** Convex 1.39, Clerk Next, TypeScript 5, vitest + convex-test for unit & integration tests.

**Spec reference:** `docs/superpowers/specs/2026-05-19-agency-mode-rbac-design.md` (sections 4-7, 11-13)

---

## File map

| Path | Action | Purpose |
|---|---|---|
| `convex/schema.ts` | modify | Add 5 new tables + 2 field modifications |
| `convex/lib/access-types.ts` | create | Capability, GrantScope, Viewer type definitions |
| `convex/lib/plans.ts` | create | PLAN_LIMITS constant for tier caps |
| `convex/lib/access-policies.ts` | create | Static role → capability map |
| `convex/lib/access.ts` | create | resolveViewer + requireCapability + systemViewer + auditLog |
| `convex/lib/tenant.ts` | modify | Make `currentOrg()` a thin wrapper over the access engine |
| `convex/migrations.ts` | create | Idempotent backfill mutations |
| `convex/agency.ts` | modify | Use Access Engine for guard checks |
| `convex/lib/access.test.ts` | create | 80+ table-driven cases on the Access Engine |
| `convex/lib/access-policies.test.ts` | create | Cap-lookup + override merging tests |
| `convex/agency.test.ts` | create | Provisioning + cap enforcement integration tests |
| `convex/grants.ts` | create | Magic-link grant CRUD (issue/use/revoke) |
| `convex/grants.test.ts` | create | Grant lifecycle integration tests |
| `vitest.config.ts` | create | Test runner config (edge-runtime env) |
| `package.json` | modify | Add `test`, `test:watch`, `typecheck`, `prebuild` scripts |

---

## Task 1: Branch + install test infrastructure

**Files:**
- Modify: `/Users/myindsound/SaaS Build Pack/pulse/package.json`
- Create: `/Users/myindsound/SaaS Build Pack/pulse/vitest.config.ts`

- [ ] **Step 1: Verify the implementation branch**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
git branch --show-current
```

Expected: `feat/agency-mode-foundation` (already created during planning; spec + plan are first two commits).

- [ ] **Step 2: Install vitest + convex-test + edge-runtime**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm install -D vitest @edge-runtime/vm convex-test @types/node
```

Expected: no errors, lockfile updates.

- [ ] **Step 3: Create vitest config**

Create `/Users/myindsound/SaaS Build Pack/pulse/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Add scripts to package.json**

Modify `/Users/myindsound/SaaS Build Pack/pulse/package.json` `"scripts"` to:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "prebuild": "convex codegen --typecheck=disable"
}
```

(The `prebuild` line is the gotcha from cross-project memory `gotcha_convex_deploy_cmd_order` — Netlify builds need codegen before `next build`.)

- [ ] **Step 5: Smoke check**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
```

Expected: exit code 0 (no type errors in existing code).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(test): wire vitest + convex-test infrastructure

Adds test runner, types, and prebuild codegen script.
Follow-up tasks introduce real tests."
```

---

## Task 2: Schema — add `agencies` table

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the `agencies` table to schema**

In `convex/schema.ts`, after the closing brace of the `users` table and before `appState`, insert:

```ts
  // ── Agency — the SaaS tenant. Only exists for Pro/Agency tier customers.
  //    Base-tier studios have no agency row. orgs.agencyId is optional. ──
  agencies: defineTable({
    agencyId: v.string(),                 // Clerk org_xxx of agency-level Clerk org
    name: v.string(),
    slug: v.string(),                     // resolves /a/<slug>
    plan: v.union(
      v.literal("pro"),
      v.literal("agency"),
      v.literal("agency_plus"),           // RESELL HOOK
    ),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("trial")),
    // Branding (white-label)
    logoId: v.optional(v.id("_storage")),
    faviconId: v.optional(v.id("_storage")),
    accentColor: v.optional(v.string()),
    customDomain: v.optional(v.string()),
    appName: v.optional(v.string()),
    // Stripe
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    // Resell hook (Agency Plus / SaaS Mode)
    resellEnabled: v.optional(v.boolean()),
    markupCents: v.optional(v.number()),
    // Provisioning
    ownerClerkUserId: v.string(),
    ownerEmail: v.string(),
  })
    .index("by_agency", ["agencyId"])
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerClerkUserId"]),
```

- [ ] **Step 2: Run codegen to validate**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex codegen --typecheck=disable
```

Expected: succeeds, generates updated `convex/_generated/dataModel.d.ts` referencing `agencies`.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): add agencies table

Agency = the SaaS tenant for Pro/Agency tier customers. Base-tier
studios have no agency row; orgs.agencyId stays optional."
```

---

## Task 3: Schema — add `agencyMembers` + `agencyMemberScopes`

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add both tables**

After the `agencies` table block in `convex/schema.ts`, insert:

```ts
  // ── Agency members — humans with access to the agency console. The owner
  //    plus zero-or-more agency staff. NOT the same as members inside a sub-account. ──
  agencyMembers: defineTable({
    agencyId: v.string(),
    clerkUserId: v.string(),
    email: v.string(),
    name: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("staff"),
      v.literal("billing"),
    ),
    capabilityOverrides: v.optional(v.array(v.string())),
    status: v.union(v.literal("active"), v.literal("invited"), v.literal("suspended")),
    invitedAt: v.number(),
    lastActiveAt: v.optional(v.number()),
  })
    .index("by_agency", ["agencyId"])
    .index("by_clerk", ["clerkUserId"])
    .index("by_agency_clerk", ["agencyId", "clerkUserId"]),

  // ── Agency-member scopes — which sub-accounts a "staff" role can reach.
  //    Empty for owner/admin (they get all). One row per (agencyMember, subAccountOrgId). ──
  agencyMemberScopes: defineTable({
    agencyId: v.string(),
    agencyMemberId: v.id("agencyMembers"),
    subAccountOrgId: v.string(),
    capabilityOverrides: v.optional(v.array(v.string())),
  })
    .index("by_member", ["agencyMemberId"])
    .index("by_subaccount", ["subAccountOrgId"]),
```

- [ ] **Step 2: Codegen + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex codegen --typecheck=disable
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): add agencyMembers + agencyMemberScopes tables"
```

---

## Task 4: Schema — add `collaboratorGrants`

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the table**

After `agencyMemberScopes`, insert:

```ts
  // ── Magic-link collaborator grants — scoped pass for a non-account user.
  //    Token-backed, time-bounded. Music-industry-unique pattern. ──
  collaboratorGrants: defineTable({
    orgId: v.string(),                    // issuing studio
    agencyId: v.optional(v.string()),     // denormalized for audit
    email: v.string(),
    name: v.string(),
    scope: v.union(
      v.literal("session"),
      v.literal("song"),
      v.literal("deliverable"),
      v.literal("splitsheet"),
      v.literal("artist_portal"),
    ),
    entityId: v.string(),                 // sessions._id | songs._id | etc.
    capabilities: v.array(v.string()),
    token: v.string(),
    expiresAt: v.number(),
    revoked: v.optional(v.boolean()),
    invitedBy: v.string(),                // clerkUserId of issuer
    firstUsedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_token", ["token"])
    .index("by_entity", ["entityId"]),
```

- [ ] **Step 2: Codegen + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex codegen --typecheck=disable
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): add collaboratorGrants table"
```

---

## Task 5: Schema — add `auditEvents`

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the table**

After `collaboratorGrants`, insert:

```ts
  // ── Audit log — every Access Engine deny/grant for sensitive actions ──
  auditEvents: defineTable({
    agencyId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    viewerType: v.union(
      v.literal("agency_member"),
      v.literal("studio_member"),
      v.literal("guest"),
    ),
    viewerId: v.string(),
    action: v.string(),
    resource: v.optional(v.string()),
    result: v.union(v.literal("allow"), v.literal("deny")),
    reason: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_agency", ["agencyId"]),
```

- [ ] **Step 2: Codegen + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex codegen --typecheck=disable
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): add auditEvents table"
```

---

## Task 6: Schema — modify `orgs` (agencyId, tier, by_agency index)

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the two fields and the index**

In `convex/schema.ts` find the existing `orgs` table definition. Inside the `defineTable({...})` object, after the existing `createdByAgency` line, add:

```ts
    // NEW (cycle 1 — agency mode)
    agencyId: v.optional(v.string()),     // parent agency, null for base tier
    tier: v.optional(v.union(             // cached for cap-check perf
      v.literal("studio"),
      v.literal("pro"),
      v.literal("agency"),
    )),
```

Then add the index. After `.index("by_slug", ["slug"])`, insert:

```ts
    .index("by_agency", ["agencyId"])
```

- [ ] **Step 2: Codegen + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex codegen --typecheck=disable
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): add orgs.agencyId + orgs.tier + by_agency index"
```

---

## Task 7: Schema — extend `members.role` enum + add `capabilityOverrides`

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Widen the role enum + add overrides**

In `convex/schema.ts` find the `members` table. Replace the existing `role:` field with:

```ts
    role: v.union(
      v.literal("owner"),
      v.literal("manager"),
      v.literal("engineer"),
      v.literal("assistant_engineer"),    // NEW
      v.literal("artist_relations"),      // NEW
      v.literal("producer"),              // NEW
      v.literal("intern"),                // NEW
      v.literal("accountant"),            // NEW
    ),
    capabilityOverrides: v.optional(v.array(v.string())),  // NEW
```

(Note: list `capabilityOverrides` immediately after `role` for readability.)

- [ ] **Step 2: Codegen + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex codegen --typecheck=disable
git add convex/schema.ts convex/_generated/
git commit -m "feat(schema): extend members.role + add capabilityOverrides

Adds assistant_engineer, artist_relations, producer, intern, accountant.
Existing rows with owner|manager|engineer remain valid."
```

---

## Task 8: Create `convex/lib/access-types.ts`

**Files:**
- Create: `convex/lib/access-types.ts`

- [ ] **Step 1: Write the file**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access-types.ts`:

```ts
import type { Id } from "../_generated/dataModel";

/* ============================================================
   Shared type vocabulary for the Access Engine. All capability
   strings live in access-policies.ts; this file is just the
   shape contracts.
   ============================================================ */

export type AgencyRole = "owner" | "admin" | "staff" | "billing";

export type StudioRole =
  | "owner"
  | "manager"
  | "engineer"
  | "assistant_engineer"
  | "artist_relations"
  | "producer"
  | "intern"
  | "accountant";

export type GrantScope =
  | "session"
  | "song"
  | "deliverable"
  | "splitsheet"
  | "artist_portal";

/** Dot-namespaced capability string: <module>.<action>. */
export type Capability = string;

export type ResourceRef = {
  orgId?: string;
  entityId?: string;
  entityType?: string;
};

export type AgencyViewer = {
  kind: "agency_member";
  agencyId: string;
  agencyMemberId: Id<"agencyMembers">;
  clerkUserId: string;
  role: AgencyRole;
  scopedSubAccountOrgIds: string[] | "all";
  capabilities: Set<Capability>;
};

export type StudioViewer = {
  kind: "studio_member";
  orgId: string;
  agencyId?: string;
  memberId: Id<"members">;
  clerkUserId: string;
  role: StudioRole;
  capabilities: Set<Capability>;
};

export type GuestViewer = {
  kind: "guest";
  grantId: Id<"collaboratorGrants">;
  orgId: string;
  agencyId?: string;
  scope: GrantScope;
  entityId: string;
  capabilities: Set<Capability>;
  expiresAt: number;
};

export type Viewer = AgencyViewer | StudioViewer | GuestViewer;
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/access-types.ts
git commit -m "feat(access): add Viewer/Capability type vocabulary"
```

---

## Task 9: Create `convex/lib/plans.ts`

**Files:**
- Create: `convex/lib/plans.ts`

- [ ] **Step 1: Write the file**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/plans.ts`:

```ts
/* ============================================================
   Plan limits — single source of truth for what each tier gets.
   Used by createSubaccount, grants.issue, branding writes, and
   the billing webhook. Cycle 3 wires Stripe price IDs to these.
   ============================================================ */

export type TierKey = "studio" | "pro" | "agency";

export type TierLimits = {
  subAccountCap: number;
  magicLinkGrantsPerMonth: number;
  whitelabel: false | "studio_level" | "agency_level";
  customDomain: boolean;
  /** Monthly USD price in cents — wired to Stripe in cycle 3. */
  priceCents: number;
};

export const PLAN_LIMITS: Record<TierKey, TierLimits> = {
  studio: {
    subAccountCap: 1,
    magicLinkGrantsPerMonth: 5,
    whitelabel: false,
    customDomain: false,
    priceCents: 4900,
  },
  pro: {
    subAccountCap: 2,
    magicLinkGrantsPerMonth: 25,
    whitelabel: "studio_level",
    customDomain: false,
    priceCents: 9700,
  },
  agency: {
    subAccountCap: 999,
    magicLinkGrantsPerMonth: 999,
    whitelabel: "agency_level",
    customDomain: true,
    priceCents: 24900,
  },
};

export function limitsFor(tier: TierKey): TierLimits {
  return PLAN_LIMITS[tier];
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/plans.ts
git commit -m "feat(billing): add PLAN_LIMITS source of truth"
```

---

## Task 10: Create `convex/lib/access-policies.ts`

**Files:**
- Create: `convex/lib/access-policies.ts`

- [ ] **Step 1: Write the file**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access-policies.ts`:

```ts
import type { AgencyRole, StudioRole, GrantScope, Capability } from "./access-types";

/* ============================================================
   Capability policy map — the single source of truth for what
   each role can do. Edits here = behavior change everywhere.
   Capability strings are <module>.<action>; "own" qualifier is
   handled by the engine (viewer.scopedSubAccountOrgIds, etc.).
   ============================================================ */

// ── Agency layer (4 roles) ──────────────────────────────────
export const AGENCY_ROLE_CAPABILITIES: Record<AgencyRole, ReadonlyArray<Capability>> = {
  owner: [
    "agency.subaccount.create",
    "agency.subaccount.pause",
    "agency.subaccount.delete",
    "agency.staff.invite",
    "agency.staff.scope",
    "agency.viewAll",
    "billing.read",
    "billing.edit",
    "branding.edit",
    "act_as_studio",
    "audit.read",
  ],
  admin: [
    "agency.subaccount.create",
    "agency.subaccount.pause",
    "agency.staff.invite",
    "agency.staff.scope",
    "agency.viewAll",
    "billing.read",
    "branding.edit",
    "act_as_studio",
    "audit.read",
  ],
  staff: [
    "agency.subaccount.pause",       // scoped — engine enforces by sub-account list
    "act_as_studio",                  // scoped — same
  ],
  billing: [
    "billing.read",
    "billing.edit",
  ],
};

// ── Studio layer (8 roles) ──────────────────────────────────
//   "own" cells in the spec matrix become a per-capability qualifier
//   handled inside requireCapability (compares assigned member id).
//   This list is the positive grant set; everything not listed is denied.
export const STUDIO_ROLE_CAPABILITIES: Record<StudioRole, ReadonlyArray<Capability>> = {
  owner: [
    "songs.read", "songs.edit", "songs.delete",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit", "splitsheet.sign",
    "artists.read", "artists.edit",
    "rooms.read", "rooms.edit",
    "equipment.read", "equipment.edit",
    "invoices.read", "invoices.send",
    "finance.refund",
    "members.read", "members.invite", "members.remove",
    "branding.edit",
    "grants.issue", "grants.revoke",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "releases.read", "releases.edit",
    "insights.read",
    "activity.read",
  ],
  manager: [
    "songs.read", "songs.edit", "songs.delete",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit",
    "artists.read", "artists.edit",
    "rooms.read", "rooms.edit",
    "equipment.read", "equipment.edit",
    "invoices.read", "invoices.send",
    "finance.refund",
    "members.read", "members.invite",
    "branding.edit",
    "grants.issue", "grants.revoke",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "releases.read", "releases.edit",
    "insights.read",
    "activity.read",
  ],
  engineer: [
    "songs.read", "songs.edit",
    "sessions.read", "sessions.edit",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read",
    "artists.read",
    "rooms.read",
    "equipment.read",
    "grants.issue",
    "grants.revoke.own",
    "insights.read",
    "activity.read",
  ],
  assistant_engineer: [
    "songs.read", "songs.edit",
    "sessions.read", "sessions.edit.own",
    "deliverables.read", "deliverables.upload",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read",
    "artists.read",
    "rooms.read",
    "equipment.read",
    "activity.read",
  ],
  artist_relations: [
    "songs.read",
    "sessions.read", "sessions.edit", "sessions.cancel",
    "deliverables.read",
    "splitsheet.read",
    "artists.read", "artists.edit",
    "invoices.read",
    "grants.issue",
    "grants.revoke.own",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "opportunities.read", "opportunities.edit",
    "activity.read",
  ],
  producer: [
    "songs.read", "songs.edit",
    "sessions.read", "sessions.edit",
    "deliverables.read", "deliverables.upload", "deliverables.approve",
    "engineeringLogs.read", "engineeringLogs.edit",
    "splitsheet.read", "splitsheet.edit", "splitsheet.sign",
    "artists.read",
    "rooms.read",
    "equipment.read",
    "grants.issue",
    "grants.revoke.own",
    "licenses.read", "licenses.edit",
    "syncOpportunities.read", "syncOpportunities.edit",
    "activity.read",
  ],
  intern: [
    "songs.read",
    "sessions.read",
    "deliverables.read",
    "engineeringLogs.read",
    "artists.read",
    "rooms.read",
    "equipment.read",
    "activity.read",
  ],
  accountant: [
    "songs.read",
    "sessions.read",
    "deliverables.read",
    "artists.read",
    "invoices.read", "invoices.send",
    "finance.refund",
    "licenses.read", "licenses.edit",
    "activity.read",
  ],
};

// ── Guest grant scopes (5) ──────────────────────────────────
export const GUEST_SCOPE_CAPABILITIES: Record<GrantScope, ReadonlyArray<Capability>> = {
  session: [
    "sessions.read",
    "engineeringLogs.read",
    "deliverables.read",
  ],
  song: [
    "songs.read",
    "deliverables.read", "deliverables.upload",
    "engineeringLogs.read",
    "revisionComments.write",
  ],
  deliverable: [
    "deliverables.read", "deliverables.approve",
    "revisionComments.write",
  ],
  splitsheet: [
    "splitsheet.read", "splitsheet.sign",
  ],
  artist_portal: [
    "songs.read",
    "sessions.read",
    "deliverables.read", "deliverables.approve",
    "invoices.read",
    "revisionComments.write",
  ],
};

/** Capabilities whose grants/denies get audited. Keep tight to avoid noise. */
export const SENSITIVE_CAPABILITIES = new Set<Capability>([
  "agency.subaccount.create",
  "agency.subaccount.pause",
  "agency.subaccount.delete",
  "agency.staff.invite",
  "agency.staff.scope",
  "billing.edit",
  "branding.edit",
  "members.invite",
  "members.remove",
  "songs.delete",
  "deliverables.approve",
  "splitsheet.sign",
  "finance.refund",
  "grants.issue",
  "grants.revoke",
]);

/** Default magic-link expiry windows per scope, in ms. */
export const GUEST_SCOPE_DEFAULT_TTL_MS: Record<GrantScope, number> = {
  session: 14 * 24 * 60 * 60 * 1000,
  song: 30 * 24 * 60 * 60 * 1000,
  deliverable: 7 * 24 * 60 * 60 * 1000,
  splitsheet: 30 * 24 * 60 * 60 * 1000,
  artist_portal: 365 * 24 * 60 * 60 * 1000,
};

// ── Override token application ──────────────────────────────
/** Apply `+cap` / `-cap` tokens to a base set. */
export function applyOverrides(
  base: ReadonlyArray<Capability>,
  overrides: ReadonlyArray<string> | undefined,
): Set<Capability> {
  const set = new Set<Capability>(base);
  if (!overrides) return set;
  for (const tok of overrides) {
    if (tok.startsWith("+")) set.add(tok.slice(1));
    else if (tok.startsWith("-")) set.delete(tok.slice(1));
  }
  return set;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/access-policies.ts
git commit -m "feat(access): add static capability policy map for 4+8+5 roles"
```

---

## Task 11: Test policy lookups + override merging

**Files:**
- Create: `convex/lib/access-policies.test.ts`

- [ ] **Step 1: Write the test**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access-policies.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AGENCY_ROLE_CAPABILITIES,
  STUDIO_ROLE_CAPABILITIES,
  GUEST_SCOPE_CAPABILITIES,
  SENSITIVE_CAPABILITIES,
  applyOverrides,
} from "./access-policies";

describe("access-policies", () => {
  it("agency owner has full surface", () => {
    expect(AGENCY_ROLE_CAPABILITIES.owner).toContain("agency.subaccount.delete");
    expect(AGENCY_ROLE_CAPABILITIES.owner).toContain("billing.edit");
  });

  it("agency admin cannot delete sub-accounts", () => {
    expect(AGENCY_ROLE_CAPABILITIES.admin).not.toContain("agency.subaccount.delete");
  });

  it("agency admin cannot edit billing", () => {
    expect(AGENCY_ROLE_CAPABILITIES.admin).not.toContain("billing.edit");
  });

  it("agency staff is minimal until scoped", () => {
    expect(AGENCY_ROLE_CAPABILITIES.staff).toContain("act_as_studio");
    expect(AGENCY_ROLE_CAPABILITIES.staff).not.toContain("billing.edit");
  });

  it("agency billing sees money but not sub-accounts", () => {
    expect(AGENCY_ROLE_CAPABILITIES.billing).toContain("billing.edit");
    expect(AGENCY_ROLE_CAPABILITIES.billing).not.toContain("agency.subaccount.create");
  });

  it("studio engineer cannot delete songs", () => {
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("songs.delete");
  });

  it("studio engineer cannot refund money", () => {
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("finance.refund");
  });

  it("studio intern is read-only across the board", () => {
    for (const cap of STUDIO_ROLE_CAPABILITIES.intern) {
      expect(cap.endsWith(".read") || cap.endsWith(".own")).toBe(true);
    }
  });

  it("assistant engineer cannot approve deliverables", () => {
    expect(STUDIO_ROLE_CAPABILITIES.assistant_engineer).not.toContain("deliverables.approve");
  });

  it("accountant can refund and invoice but not edit songs", () => {
    expect(STUDIO_ROLE_CAPABILITIES.accountant).toContain("finance.refund");
    expect(STUDIO_ROLE_CAPABILITIES.accountant).toContain("invoices.send");
    expect(STUDIO_ROLE_CAPABILITIES.accountant).not.toContain("songs.edit");
  });

  it("artist_relations can edit artists and cancel sessions", () => {
    expect(STUDIO_ROLE_CAPABILITIES.artist_relations).toContain("artists.edit");
    expect(STUDIO_ROLE_CAPABILITIES.artist_relations).toContain("sessions.cancel");
  });

  it("producer can sign split sheets, engineer cannot", () => {
    expect(STUDIO_ROLE_CAPABILITIES.producer).toContain("splitsheet.sign");
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("splitsheet.sign");
  });

  it("guest session scope is read-only", () => {
    for (const cap of GUEST_SCOPE_CAPABILITIES.session) {
      expect(cap.endsWith(".read")).toBe(true);
    }
  });

  it("guest artist_portal scope can approve deliverables", () => {
    expect(GUEST_SCOPE_CAPABILITIES.artist_portal).toContain("deliverables.approve");
  });

  it("guest splitsheet scope can sign", () => {
    expect(GUEST_SCOPE_CAPABILITIES.splitsheet).toContain("splitsheet.sign");
  });

  it("sensitive set contains money + member + grant actions", () => {
    expect(SENSITIVE_CAPABILITIES.has("finance.refund")).toBe(true);
    expect(SENSITIVE_CAPABILITIES.has("members.remove")).toBe(true);
    expect(SENSITIVE_CAPABILITIES.has("grants.issue")).toBe(true);
    expect(SENSITIVE_CAPABILITIES.has("songs.read")).toBe(false);
  });

  describe("applyOverrides", () => {
    it("adds with +cap", () => {
      const result = applyOverrides(["songs.read"], ["+finance.read"]);
      expect(result.has("finance.read")).toBe(true);
      expect(result.has("songs.read")).toBe(true);
    });

    it("removes with -cap", () => {
      const result = applyOverrides(["songs.read", "songs.edit"], ["-songs.edit"]);
      expect(result.has("songs.edit")).toBe(false);
      expect(result.has("songs.read")).toBe(true);
    });

    it("ignores malformed tokens", () => {
      const result = applyOverrides(["songs.read"], ["bogus", "+ok"]);
      expect(result.has("ok")).toBe(true);
      expect(result.has("bogus")).toBe(false);
    });

    it("handles undefined overrides", () => {
      const result = applyOverrides(["songs.read"], undefined);
      expect(result.size).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
```

Expected: all tests PASS.

```bash
git add convex/lib/access-policies.test.ts
git commit -m "test(access): cover policy map + override merging"
```

---

## Task 12: Create `convex/lib/access.ts` — types + audit helper

**Files:**
- Create: `convex/lib/access.ts`

- [ ] **Step 1: Write the skeleton with audit helper**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access.ts`:

```ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import {
  AGENCY_ROLE_CAPABILITIES,
  STUDIO_ROLE_CAPABILITIES,
  GUEST_SCOPE_CAPABILITIES,
  SENSITIVE_CAPABILITIES,
  applyOverrides,
} from "./access-policies";
import type {
  Viewer, AgencyViewer, StudioViewer, GuestViewer,
  AgencyRole, StudioRole, GrantScope,
  Capability, ResourceRef,
} from "./access-types";

/* ============================================================
   Access Engine — one resolver, one require, one audit hook.
   Every Convex business function should either:
     • call requireCapability(ctx, "<cap>", { orgId, entityId })
     • or accept the legacy currentOrg() compat shim (read paths)
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

export class AccessError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AccessError";
  }
}

// ── Audit helper ────────────────────────────────────────────
/** Only persists when ctx is a MutationCtx (read paths skip). */
async function audit(
  ctx: Ctx,
  viewer: Viewer | null,
  action: Capability,
  resource: ResourceRef | undefined,
  result: "allow" | "deny",
  reason?: string,
): Promise<void> {
  if (!SENSITIVE_CAPABILITIES.has(action)) return;
  if (!("insert" in ctx.db)) return; // not a mutation ctx; skip silently
  const mctx = ctx as MutationCtx;
  await mctx.db.insert("auditEvents", {
    agencyId: viewer && "agencyId" in viewer ? viewer.agencyId : undefined,
    orgId: viewer && "orgId" in viewer ? viewer.orgId : resource?.orgId,
    viewerType: viewer?.kind ?? "studio_member",
    viewerId: viewer
      ? viewer.kind === "guest"
        ? viewer.grantId
        : (viewer as AgencyViewer | StudioViewer).clerkUserId
      : "anonymous",
    action,
    resource: resource?.entityId,
    result,
    reason,
  });
}

// ── Capability-set builders ─────────────────────────────────
function buildAgencyCaps(role: AgencyRole, overrides?: string[]): Set<Capability> {
  return applyOverrides(AGENCY_ROLE_CAPABILITIES[role], overrides);
}

function buildStudioCaps(role: StudioRole, overrides?: string[]): Set<Capability> {
  return applyOverrides(STUDIO_ROLE_CAPABILITIES[role], overrides);
}

function buildGuestCaps(scope: GrantScope, extra?: string[]): Set<Capability> {
  return applyOverrides(GUEST_SCOPE_CAPABILITIES[scope], extra?.map((c) => "+" + c));
}

// resolveViewer + requireCapability land in the next tasks.
export { audit, buildAgencyCaps, buildStudioCaps, buildGuestCaps };
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/access.ts
git commit -m "feat(access): scaffold engine with audit helper + cap builders"
```

---

## Task 13: Add `resolveViewer` to the Access Engine

**Files:**
- Modify: `convex/lib/access.ts`

- [ ] **Step 1: Append resolveViewer**

Append to `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access.ts` (just before the `export { audit, ... }` line — move that export to the bottom):

```ts
// ── resolveViewer ───────────────────────────────────────────
/**
 * Resolve the caller into a Viewer.
 * Order of checks:
 *   1. ctx.auth identity present → look up agency or studio member
 *   2. no identity → look for a guest token stashed by HTTP action
 *      in a sessionless "currentGuest" appState row (cycle 2 wires this)
 *   3. demo mode → synthesize a studio_member from appState.activeOrgId
 */
export async function resolveViewer(ctx: Ctx): Promise<Viewer> {
  const identity = await ctx.auth.getUserIdentity();

  // 1. Clerk-authenticated path
  if (identity) {
    const clerkUserId = identity.subject;
    const orgId = (identity as { orgId?: string }).orgId;
    const orgType = (identity as { orgType?: string }).orgType; // publicMetadata.type

    // Agency-tier Clerk org
    if (orgId && orgType === "agency") {
      const member = await ctx.db
        .query("agencyMembers")
        .withIndex("by_agency_clerk", (q) =>
          q.eq("agencyId", orgId).eq("clerkUserId", clerkUserId))
        .first();
      if (!member) throw new AccessError("NO_AGENCY_MEMBER", "No agencyMembers row for caller");
      let scoped: string[] | "all" = "all";
      if (member.role === "staff") {
        const scopes = await ctx.db
          .query("agencyMemberScopes")
          .withIndex("by_member", (q) => q.eq("agencyMemberId", member._id))
          .collect();
        scoped = scopes.map((s) => s.subAccountOrgId);
      }
      return {
        kind: "agency_member",
        agencyId: orgId,
        agencyMemberId: member._id,
        clerkUserId,
        role: member.role,
        scopedSubAccountOrgIds: scoped,
        capabilities: buildAgencyCaps(member.role, member.capabilityOverrides),
      };
    }

    // Studio-tier Clerk org (default)
    if (orgId) {
      const member = await ctx.db
        .query("members")
        .withIndex("by_org_clerk", (q) => q.eq("orgId", orgId).eq("clerkUserId", clerkUserId))
        .first();
      if (!member) throw new AccessError("NO_STUDIO_MEMBER", "No members row for caller");
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
      return {
        kind: "studio_member",
        orgId,
        agencyId: org?.agencyId,
        memberId: member._id,
        clerkUserId,
        role: member.role,
        capabilities: buildStudioCaps(member.role, member.capabilityOverrides),
      };
    }
  }

  // 2/3. No Clerk identity → demo mode synthesizes an owner-level studio viewer
  //      pointed at appState.activeOrgId (or "pulse-demo" default).
  const state = await ctx.db
    .query("appState")
    .withIndex("by_key", (q) => q.eq("key", "demo"))
    .first();
  const demoOrgId = state?.activeOrgId ?? "pulse-demo";
  const demoOrg = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", demoOrgId)).first();
  return {
    kind: "studio_member",
    orgId: demoOrgId,
    agencyId: demoOrg?.agencyId,
    memberId: "demo" as unknown as StudioViewer["memberId"],
    clerkUserId: "demo-user",
    role: "owner",
    capabilities: buildStudioCaps("owner"),
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/access.ts
git commit -m "feat(access): resolveViewer for Clerk + demo mode

Guest-token branch lands in cycle 2 along with the HTTP action that
stamps a sessionless guest token into appState."
```

---

## Task 14: Add `requireCapability` + `systemViewer`

**Files:**
- Modify: `convex/lib/access.ts`

- [ ] **Step 1: Append the require + system helpers**

Append to `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access.ts` (above the bottom `export` line):

```ts
// ── requireCapability ───────────────────────────────────────
export async function requireCapability(
  ctx: Ctx,
  capability: Capability,
  resource?: ResourceRef,
): Promise<Viewer> {
  const viewer = await resolveViewer(ctx);

  // Capability check (always)
  const ok = viewer.capabilities.has(capability)
    || (capability.endsWith(".own") && viewer.capabilities.has(capability))
    || viewer.capabilities.has(capability + ".own");
  if (!ok) {
    await audit(ctx, viewer, capability, resource, "deny", "missing capability");
    throw new AccessError("CAPABILITY_DENIED", `${viewer.kind} lacks ${capability}`);
  }

  // Scope/resource checks per viewer kind
  if (viewer.kind === "agency_member") {
    if (resource?.orgId) {
      // Org must belong to this agency
      const org = await ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", resource.orgId!))
        .first();
      if (!org || org.agencyId !== viewer.agencyId) {
        await audit(ctx, viewer, capability, resource, "deny", "org not under agency");
        throw new AccessError("SCOPE_DENIED", "Sub-account not under this agency");
      }
      // Staff additionally must have the sub-account in their scope list
      if (viewer.scopedSubAccountOrgIds !== "all"
          && !viewer.scopedSubAccountOrgIds.includes(resource.orgId)) {
        await audit(ctx, viewer, capability, resource, "deny", "out of staff scope");
        throw new AccessError("SCOPE_DENIED", "Sub-account out of staff scope");
      }
    }
  } else if (viewer.kind === "studio_member") {
    if (resource?.orgId && resource.orgId !== viewer.orgId) {
      await audit(ctx, viewer, capability, resource, "deny", "wrong org");
      throw new AccessError("SCOPE_DENIED", "Cross-org access denied");
    }
  } else if (viewer.kind === "guest") {
    if (Date.now() > viewer.expiresAt) {
      await audit(ctx, viewer, capability, resource, "deny", "grant expired");
      throw new AccessError("GRANT_EXPIRED", "Magic-link grant has expired");
    }
    if (resource?.entityId && resource.entityId !== viewer.entityId) {
      await audit(ctx, viewer, capability, resource, "deny", "guest wrong entity");
      throw new AccessError("SCOPE_DENIED", "Guest scope mismatch");
    }
  }

  await audit(ctx, viewer, capability, resource, "allow");
  return viewer;
}

// ── systemViewer ────────────────────────────────────────────
/**
 * Trusted internal viewer for system actions (Stripe webhooks, scheduled jobs).
 * Only callable from internalMutation / internalAction code paths — there is
 * no client surface to obtain this; it's a constructor helper.
 */
export function systemViewer(orgId?: string): StudioViewer {
  return {
    kind: "studio_member",
    orgId: orgId ?? "system",
    agencyId: undefined,
    memberId: "system" as unknown as StudioViewer["memberId"],
    clerkUserId: "system",
    role: "owner",
    capabilities: buildStudioCaps("owner"),
  };
}
```

- [ ] **Step 2: Fix bottom exports**

Replace the last `export { audit, buildAgencyCaps, buildStudioCaps, buildGuestCaps };` line with:

```ts
export { audit };
// resolveViewer, requireCapability, systemViewer are exported above via `export async function` / `export function`.
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/access.ts
git commit -m "feat(access): add requireCapability + systemViewer

requireCapability enforces capability + scope + (for guests) expiry,
audits sensitive actions, and throws on deny. systemViewer is the
escape hatch for trusted internal callers (Stripe webhooks)."
```

---

## Task 15: Wire the access engine into `currentOrg()`

**Files:**
- Modify: `convex/lib/tenant.ts`

- [ ] **Step 1: Replace `currentOrg` body**

Replace the contents of `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/tenant.ts` with:

```ts
import { QueryCtx, MutationCtx } from "../_generated/server";
import { resolveViewer } from "./access";

/* The seeded workspace used whenever Clerk auth is not configured. */
export const DEMO_ORG = "pulse-demo";

type Ctx = QueryCtx | MutationCtx;

/**
 * Resolve the caller's organization. Backed by the Access Engine —
 * agency, studio, and guest viewers all expose an `orgId`. orgId is
 * never trusted from client arguments; always derived here.
 */
export async function currentOrg(ctx: Ctx): Promise<string> {
  const viewer = await resolveViewer(ctx);
  return viewer.orgId ?? DEMO_ORG;
}

/** A human label for the caller — used for activity/comment attribution. */
export async function currentActor(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.name ?? identity?.email ?? "Studio";
}

/** Throw unless a fetched document belongs to the caller's org. */
export function assertOrg<T extends { orgId: string } | null>(
  doc: T,
  orgId: string,
): asserts doc is NonNullable<T> {
  if (!doc || doc.orgId !== orgId) throw new Error("Not found");
}
```

Note: `AgencyViewer` has no `orgId` directly (it has a list of scoped sub-accounts). For an agency viewer, `currentOrg()` returning `undefined` is wrong; it should return the **active** sub-account. We handle that by reading `appState.activeOrgId` in the agency-viewer branch. Add to `resolveViewer`:

- [ ] **Step 2: Patch `resolveViewer` to surface an `orgId` for agency viewers**

In `convex/lib/access-types.ts`, add an `orgId?: string` field to `AgencyViewer`:

```ts
export type AgencyViewer = {
  kind: "agency_member";
  agencyId: string;
  agencyMemberId: Id<"agencyMembers">;
  clerkUserId: string;
  role: AgencyRole;
  scopedSubAccountOrgIds: string[] | "all";
  capabilities: Set<Capability>;
  orgId?: string; // NEW — active sub-account (from appState.activeOrgId)
};
```

In `convex/lib/access.ts` inside `resolveViewer` agency-member branch, before the return, add:

```ts
      const state = await ctx.db
        .query("appState")
        .withIndex("by_key", (q) => q.eq("key", "demo"))
        .first();
      const activeOrgId = state?.activeOrgId;
```

Then in the return object, add `orgId: activeOrgId,`.

- [ ] **Step 3: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/tenant.ts convex/lib/access.ts convex/lib/access-types.ts
git commit -m "refactor(tenant): currentOrg() now backed by Access Engine

Existing call sites stay unchanged. Agency viewers expose their
'entered as' sub-account via appState.activeOrgId."
```

---

## Task 16: Unit-test `resolveViewer` and `requireCapability`

**Files:**
- Create: `convex/testHarness.ts` (real Convex module so codegen exposes it via `api`)
- Create: `convex/lib/access.test.ts`

- [ ] **Step 1a: Write the test harness as a real Convex file**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/testHarness.ts`:

```ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { resolveViewer, requireCapability, AccessError } from "./lib/access";

/* ============================================================
   Test harness — these are referenced only by *.test.ts files.
   In production Convex they sit unused; safe to leave deployed.
   ============================================================ */

export const resolve = query({
  args: {},
  handler: async (ctx) => {
    const v = await resolveViewer(ctx);
    return { kind: v.kind, role: (v as any).role, caps: [...v.capabilities].sort() };
  },
});

export const require_ = mutation({
  args: { cap: v.string(), orgId: v.optional(v.string()) },
  handler: async (ctx, { cap, orgId }) => {
    try {
      const viewer = await requireCapability(ctx, cap, { orgId });
      return { ok: true, kind: viewer.kind };
    } catch (e) {
      if (e instanceof AccessError) return { ok: false, code: e.code };
      throw e;
    }
  },
});
```

Then run codegen so `api.testHarness.resolve` / `api.testHarness.require_` are typed:

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex codegen --typecheck=disable
```

- [ ] **Step 1b: Write the test**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

describe("access engine — resolveViewer", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("demo mode returns studio_member owner pointed at pulse-demo", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "solo",
        status: "active",
      });
    });
    const result = await t.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("studio_member");
    expect(result.role).toBe("owner");
  });

  it("studio member with Clerk identity resolves with their role", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_abc", name: "Acme", slug: "acme", plan: "studio",
        status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_abc", name: "Eng", role: "engineer",
        clerkUserId: "user_eng", skills: [],
      });
    });
    const asEng = t.withIdentity({ subject: "user_eng", orgId: "org_abc" });
    const result = await asEng.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("studio_member");
    expect(result.role).toBe("engineer");
    expect(result.caps).toContain("songs.read");
    expect(result.caps).not.toContain("songs.delete");
  });

  it("agency owner with agency org type resolves as agency_member", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AcmeMG", slug: "acme",
        plan: "agency", status: "active",
        ownerClerkUserId: "user_owner", ownerEmail: "o@x.com",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "user_owner", email: "o@x.com",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
    });
    const asOwner = t.withIdentity({ subject: "user_owner", orgId: "org_ag", orgType: "agency" });
    const result = await asOwner.query(api.testHarness.resolve, {});
    expect(result.kind).toBe("agency_member");
    expect(result.role).toBe("owner");
    expect(result.caps).toContain("billing.edit");
  });
});

describe("access engine — requireCapability", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("engineer can edit songs (allow)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "E", role: "engineer", clerkUserId: "u1", skills: [] });
    });
    const asEng = t.withIdentity({ subject: "u1", orgId: "org_a" });
    const r = await asEng.mutation(api.testHarness.require_, { cap: "songs.edit", orgId: "org_a" });
    expect(r).toEqual({ ok: true, kind: "studio_member" });
  });

  it("engineer cannot delete songs (deny CAPABILITY_DENIED)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "E", role: "engineer", clerkUserId: "u1", skills: [] });
    });
    const asEng = t.withIdentity({ subject: "u1", orgId: "org_a" });
    const r = await asEng.mutation(api.testHarness.require_, { cap: "songs.delete", orgId: "org_a" });
    expect(r).toEqual({ ok: false, code: "CAPABILITY_DENIED" });
  });

  it("intern cannot edit anything (deny)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "I", role: "intern", clerkUserId: "u_i", skills: [] });
    });
    const asIntern = t.withIdentity({ subject: "u_i", orgId: "org_a" });
    const r = await asIntern.mutation(api.testHarness.require_, { cap: "songs.edit", orgId: "org_a" });
    expect(r.ok).toBe(false);
  });

  it("accountant can refund (allow)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "Acc", role: "accountant", clerkUserId: "u_a", skills: [] });
    });
    const asAcc = t.withIdentity({ subject: "u_a", orgId: "org_a" });
    const r = await asAcc.mutation(api.testHarness.require_, { cap: "finance.refund", orgId: "org_a" });
    expect(r.ok).toBe(true);
  });

  it("studio member denied cross-org access (SCOPE_DENIED)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org_b", name: "B", slug: "b", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "O", role: "owner", clerkUserId: "u_o", skills: [] });
    });
    const asOwner = t.withIdentity({ subject: "u_o", orgId: "org_a" });
    const r = await asOwner.mutation(api.testHarness.require_, { cap: "songs.edit", orgId: "org_b" });
    expect(r).toEqual({ ok: false, code: "SCOPE_DENIED" });
  });

  it("agency staff denied for sub-account outside scope", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_own", ownerEmail: "o@x",
      });
      const memberId = await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_staff", email: "s@x", name: "S",
        role: "staff", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1", name: "Sub1", slug: "s1", plan: "studio", status: "active",
        agencyId: "org_ag",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub2", name: "Sub2", slug: "s2", plan: "studio", status: "active",
        agencyId: "org_ag",
      });
      // Staff scoped only to sub1
      await ctx.db.insert("agencyMemberScopes", {
        agencyId: "org_ag", agencyMemberId: memberId, subAccountOrgId: "org_sub1",
      });
    });
    const asStaff = t.withIdentity({ subject: "u_staff", orgId: "org_ag", orgType: "agency" });
    const allowed = await asStaff.mutation(api.testHarness.require_, {
      cap: "act_as_studio", orgId: "org_sub1",
    });
    expect(allowed.ok).toBe(true);
    const denied = await asStaff.mutation(api.testHarness.require_, {
      cap: "act_as_studio", orgId: "org_sub2",
    });
    expect(denied).toEqual({ ok: false, code: "SCOPE_DENIED" });
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
```

Expected: all access engine tests PASS.

```bash
git add convex/lib/access.test.ts
git commit -m "test(access): resolve + require integration cases

Covers demo mode, studio role caps, agency staff scoping, cross-org
denial, and capability-denied paths."
```

---

## Task 17: Create `convex/grants.ts` — magic-link grant CRUD

**Files:**
- Create: `convex/grants.ts`

- [ ] **Step 1: Write the file**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/grants.ts`:

```ts
import { mutation, query, action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";
import { GUEST_SCOPE_CAPABILITIES, GUEST_SCOPE_DEFAULT_TTL_MS } from "./lib/access-policies";

/* ============================================================
   Magic-link guest grants. The studio issues a token-backed
   pass for a non-account collaborator (session bassist, sync
   supervisor, external mix engineer, artist on the portal).
   ============================================================ */

const scopeV = v.union(
  v.literal("session"),
  v.literal("song"),
  v.literal("deliverable"),
  v.literal("splitsheet"),
  v.literal("artist_portal"),
);

/** Generate a URL-safe random token. */
function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCapability(ctx, "grants.issue");
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) return [];
    return await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(50);
  },
});

export const issue = mutation({
  args: {
    scope: scopeV,
    entityId: v.string(),
    email: v.string(),
    name: v.string(),
    ttlMs: v.optional(v.number()),
    extraCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "grants.issue");
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) throw new Error("issuing requires an active org");
    const ttl = args.ttlMs ?? GUEST_SCOPE_DEFAULT_TTL_MS[args.scope];
    const caps = [...GUEST_SCOPE_CAPABILITIES[args.scope], ...(args.extraCapabilities ?? [])];
    const id = await ctx.db.insert("collaboratorGrants", {
      orgId,
      agencyId: "agencyId" in viewer ? viewer.agencyId : undefined,
      email: args.email,
      name: args.name,
      scope: args.scope,
      entityId: args.entityId,
      capabilities: caps,
      token: makeToken(),
      expiresAt: Date.now() + ttl,
      invitedBy: "clerkUserId" in viewer ? viewer.clerkUserId : "system",
      useCount: 0,
    });
    return await ctx.db.get(id);
  },
});

export const revoke = mutation({
  args: { grantId: v.id("collaboratorGrants") },
  handler: async (ctx, { grantId }) => {
    await requireCapability(ctx, "grants.revoke");
    const g = await ctx.db.get(grantId);
    if (!g) throw new Error("grant not found");
    await ctx.db.patch(grantId, { revoked: true });
  },
});

/** Public lookup by token. Called by HTTP action that stamps a guest session. */
export const lookupByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const g = await ctx.db
      .query("collaboratorGrants")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!g || g.revoked || g.expiresAt < Date.now()) return null;
    return { _id: g._id, orgId: g.orgId, scope: g.scope, entityId: g.entityId, expiresAt: g.expiresAt };
  },
});

/** Internal — bumped on every successful guest-token use. */
export const markUsed = internalMutation({
  args: { grantId: v.id("collaboratorGrants") },
  handler: async (ctx, { grantId }) => {
    const g = await ctx.db.get(grantId);
    if (!g) return;
    await ctx.db.patch(grantId, {
      lastUsedAt: Date.now(),
      firstUsedAt: g.firstUsedAt ?? Date.now(),
      useCount: g.useCount + 1,
    });
  },
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/grants.ts
git commit -m "feat(grants): magic-link grant issue/list/revoke + token lookup

Issuance is gated by 'grants.issue'; per-scope capability bundle and
default TTL come from access-policies. HTTP action wiring lands in
cycle 2 along with the /g/[token] guest pages."
```

---

## Task 18: Integration-test grant lifecycle

**Files:**
- Create: `convex/grants.test.ts`

- [ ] **Step 1: Write the test**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/grants.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("grants — lifecycle", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedStudio(orgId = "org_studio") {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId, name: "S", slug: "s", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId, name: "O", role: "owner", clerkUserId: "u_o", skills: [] });
    });
    return t.withIdentity({ subject: "u_o", orgId });
  }

  it("issue → list returns the new grant", async () => {
    const owner = await seedStudio();
    const grant = await owner.mutation(api.grants.issue, {
      scope: "song",
      entityId: "song_fake",
      email: "bass@x.com",
      name: "Session Bass",
    });
    expect(grant).not.toBeNull();
    expect(grant!.scope).toBe("song");
    const list = await owner.query(api.grants.list, {});
    expect(list.length).toBe(1);
    expect(list[0]._id).toBe(grant!._id);
  });

  it("token lookup returns grant when fresh, null after revoke", async () => {
    const owner = await seedStudio();
    const grant = await owner.mutation(api.grants.issue, {
      scope: "deliverable",
      entityId: "del_fake",
      email: "a@x", name: "Artist",
    });
    const ok = await t.query(api.grants.lookupByToken, { token: grant!.token });
    expect(ok).not.toBeNull();
    await owner.mutation(api.grants.revoke, { grantId: grant!._id });
    const dead = await t.query(api.grants.lookupByToken, { token: grant!.token });
    expect(dead).toBeNull();
  });

  it("token lookup returns null after expiry", async () => {
    const owner = await seedStudio();
    const grant = await owner.mutation(api.grants.issue, {
      scope: "splitsheet",
      entityId: "ss_fake",
      email: "x@x", name: "X",
      ttlMs: 1, // immediate expiry
    });
    // Wait so Date.now() ticks past expiresAt
    await new Promise((r) => setTimeout(r, 5));
    const dead = await t.query(api.grants.lookupByToken, { token: grant!.token });
    expect(dead).toBeNull();
  });

  it("intern cannot issue grants", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_x", name: "X", slug: "x", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_x", name: "I", role: "intern", clerkUserId: "u_i", skills: [],
      });
    });
    const asIntern = t.withIdentity({ subject: "u_i", orgId: "org_x" });
    await expect(
      asIntern.mutation(api.grants.issue, {
        scope: "session", entityId: "s_fake", email: "x@x", name: "X",
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
```

Expected: all grants tests PASS.

```bash
git add convex/grants.test.ts
git commit -m "test(grants): issue → list → lookup → revoke → expire lifecycle"
```

---

## Task 19: Refactor `convex/agency.ts` to enforce plan caps + Access Engine

**Files:**
- Modify: `convex/agency.ts`

- [ ] **Step 1: Replace `access` query with Access-Engine-backed check**

In `convex/agency.ts`, replace the existing `access` query body with:

```ts
export const access = query({
  args: {},
  handler: async (ctx) => {
    try {
      const viewer = await resolveViewer(ctx);
      // Demo + agency owner/admin pass; studio-only members don't see the agency console
      const allowed =
        viewer.kind === "agency_member"
        || (viewer.kind === "studio_member" && (await ctx.auth.getUserIdentity()) === null);
      return { allowed, demo: viewer.kind === "studio_member" && viewer.clerkUserId === "demo-user" };
    } catch {
      return { allowed: false, demo: false };
    }
  },
});
```

Add the import at the top of the file:

```ts
import { resolveViewer, requireCapability, AccessError } from "./lib/access";
import { PLAN_LIMITS } from "./lib/plans";
```

- [ ] **Step 2: Gate `setStatus` with `agency.subaccount.pause`**

Replace `setStatus` handler:

```ts
export const setStatus = mutation({
  args: {
    orgId: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("setup")),
  },
  handler: async (ctx, { orgId, status }) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Subaccount not found");
    await ctx.db.patch(org._id, { status });
  },
});
```

- [ ] **Step 3: Enforce sub-account cap inside `createSubaccount`**

Inside the existing `createSubaccount` action handler, immediately after the `slug` normalization, insert:

```ts
    // Resolve caller into a viewer; enforce capability + plan cap
    const viewer = await ctx.runQuery(internal.agency._resolveSelf, {});
    if (!viewer || viewer.kind !== "agency_member") {
      // Demo / single-tenant Studio path: allow only if there's no existing org
      const existing = await ctx.runQuery(internal.agency._anyOrgs, {});
      if (existing > 0) throw new Error("Sub-account creation requires an agency (Pro/Agency tier).");
    } else {
      const agency = await ctx.runQuery(internal.agency._agencyById, { agencyId: viewer.agencyId });
      if (!agency) throw new Error("Agency record not found");
      const tier = agency.plan === "pro" ? "pro" : "agency";
      const cap = PLAN_LIMITS[tier].subAccountCap;
      const count = await ctx.runQuery(internal.agency._countSubaccounts, { agencyId: viewer.agencyId });
      if (count >= cap) {
        throw new Error(`Plan cap reached (${count}/${cap}). Upgrade your plan to add more studios.`);
      }
    }
```

- [ ] **Step 4: Add the internal helpers used above**

Append to `convex/agency.ts`:

```ts
export const _resolveSelf = internalQuery({
  args: {},
  handler: async (ctx) => {
    try {
      const v = await resolveViewer(ctx);
      return v.kind === "agency_member"
        ? { kind: v.kind, agencyId: v.agencyId, role: v.role }
        : { kind: v.kind };
    } catch { return null; }
  },
});

export const _anyOrgs = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("orgs").take(1)).length,
});

export const _agencyById = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) =>
    await ctx.db.query("agencies").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).first(),
});

export const _countSubaccounts = internalQuery({
  args: { agencyId: v.string() },
  handler: async (ctx, { agencyId }) =>
    (await ctx.db.query("orgs").withIndex("by_agency", (q) => q.eq("agencyId", agencyId)).collect()).length,
});
```

Add `internalQuery` to the top-of-file import:

```ts
import { query, mutation, internalMutation, internalQuery, action, QueryCtx } from "./_generated/server";
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/agency.ts
git commit -m "feat(agency): enforce capabilities + plan caps via Access Engine

createSubaccount throws plan_cap_reached when at limit; setStatus
requires agency.subaccount.pause; access query backed by resolveViewer."
```

---

## Task 20: Integration-test agency provisioning + cap enforcement

**Files:**
- Create: `convex/agency.test.ts`

- [ ] **Step 1: Write the test**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/agency.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("agency — plan-cap enforcement", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedAgency(plan: "pro" | "agency") {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag",
        plan, status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x",
        name: "Owner", role: "owner", status: "active", invitedAt: 0,
      });
    });
    return t.withIdentity({ subject: "u_owner", orgId: "org_ag", orgType: "agency" });
  }

  it("pro tier blocks the 3rd sub-account", async () => {
    const owner = await seedAgency("pro");
    await owner.action(api.agency.createSubaccount, {
      name: "Studio 1", slug: "s1", plan: "studio",
      ownerName: "X", ownerEmail: "x@x",
    });
    await owner.action(api.agency.createSubaccount, {
      name: "Studio 2", slug: "s2", plan: "studio",
      ownerName: "Y", ownerEmail: "y@x",
    });
    await expect(
      owner.action(api.agency.createSubaccount, {
        name: "Studio 3", slug: "s3", plan: "studio",
        ownerName: "Z", ownerEmail: "z@x",
      }),
    ).rejects.toThrow(/Plan cap reached/);
  });

  it("agency tier allows many sub-accounts", async () => {
    const owner = await seedAgency("agency");
    for (let i = 0; i < 5; i++) {
      await owner.action(api.agency.createSubaccount, {
        name: `S${i}`, slug: `s${i}`, plan: "studio",
        ownerName: "X", ownerEmail: `x${i}@x`,
      });
    }
    const subs = await owner.query(api.agency.subaccounts, {});
    expect(subs.length).toBe(5);
  });

  it("setStatus is gated by agency.subaccount.pause", async () => {
    const owner = await seedAgency("agency");
    await owner.action(api.agency.createSubaccount, {
      name: "S", slug: "s", plan: "studio", ownerName: "X", ownerEmail: "x@x",
    });
    // Owner can pause
    const sub = (await owner.query(api.agency.subaccounts, {}))[0];
    await owner.mutation(api.agency.setStatus, { orgId: sub.orgId, status: "paused" });
    // Random studio-only identity cannot
    await t.run(async (ctx) => {
      await ctx.db.insert("members", {
        orgId: sub.orgId, name: "Random", role: "intern", clerkUserId: "u_rand", skills: [],
      });
    });
    const stranger = t.withIdentity({ subject: "u_rand", orgId: sub.orgId });
    await expect(
      stranger.mutation(api.agency.setStatus, { orgId: sub.orgId, status: "active" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
```

Expected: all agency tests PASS.

```bash
git add convex/agency.test.ts
git commit -m "test(agency): pro cap blocks 3rd sub-account; setStatus gated"
```

---

## Task 21: Migration mutation — `backfillOrgTier`

**Files:**
- Create: `convex/migrations.ts`

- [ ] **Step 1: Write the file**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/migrations.ts`:

```ts
import { internalMutation, mutation } from "./_generated/server";
import { requireCapability } from "./lib/access";

/* ============================================================
   One-shot migrations. Each one is idempotent: safe to run on
   every deploy. Run via the dashboard or `convex run`.
   ============================================================ */

export const backfillOrgTier = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    let touched = 0;
    for (const org of orgs) {
      if (org.tier) continue;
      // Base assumption: no agencyId → studio tier; with agencyId → look up agency.plan
      let tier: "studio" | "pro" | "agency" = "studio";
      if (org.agencyId) {
        const ag = await ctx.db
          .query("agencies")
          .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
          .first();
        if (ag?.plan === "pro") tier = "pro";
        else if (ag?.plan === "agency" || ag?.plan === "agency_plus") tier = "agency";
      }
      await ctx.db.patch(org._id, { tier });
      touched++;
    }
    return { touched, total: orgs.length };
  },
});

/** Public trigger so a logged-in agency owner can self-serve. */
export const runBackfillOrgTier = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "agency.viewAll");
    return await ctx.runMutation(
      // @ts-ignore — runMutation typing on internal ref
      "migrations:backfillOrgTier" as any,
      {},
    );
  },
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/migrations.ts
git commit -m "feat(migrations): idempotent backfillOrgTier"
```

---

## Task 22: Audit-event integration test

**Files:**
- Create: `convex/lib/access-audit.test.ts`

- [ ] **Step 1: Write the test**

Create `/Users/myindsound/SaaS Build Pack/pulse/convex/lib/access-audit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

describe("access engine — audit log", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("logs an allow row when an owner refunds", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "O", role: "owner", clerkUserId: "u_o", skills: [] });
    });
    const owner = t.withIdentity({ subject: "u_o", orgId: "org_a" });
    await owner.mutation(api.testHarness.require_, { cap: "finance.refund", orgId: "org_a" });
    const events = await t.run(async (ctx) =>
      await ctx.db.query("auditEvents").collect(),
    );
    const refundEvents = events.filter((e) => e.action === "finance.refund");
    expect(refundEvents.length).toBe(1);
    expect(refundEvents[0].result).toBe("allow");
  });

  it("logs a deny row when an engineer attempts to delete a song", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "E", role: "engineer", clerkUserId: "u_e", skills: [] });
    });
    const eng = t.withIdentity({ subject: "u_e", orgId: "org_a" });
    await eng.mutation(api.testHarness.require_, { cap: "songs.delete", orgId: "org_a" });
    const events = await t.run(async (ctx) =>
      await ctx.db.query("auditEvents").collect(),
    );
    const deleteEvents = events.filter((e) => e.action === "songs.delete");
    expect(deleteEvents.length).toBe(1);
    expect(deleteEvents[0].result).toBe("deny");
    expect(deleteEvents[0].reason).toBe("missing capability");
  });

  it("does NOT log read actions (not sensitive)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "I", role: "intern", clerkUserId: "u_i", skills: [] });
    });
    const intern = t.withIdentity({ subject: "u_i", orgId: "org_a" });
    await intern.mutation(api.testHarness.require_, { cap: "songs.read", orgId: "org_a" });
    const events = await t.run(async (ctx) =>
      await ctx.db.query("auditEvents").collect(),
    );
    expect(events.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
```

Expected: all audit tests PASS.

```bash
git add convex/lib/access-audit.test.ts
git commit -m "test(access): audit log allow + deny + non-sensitive skip"
```

---

## Task 23: Final cycle-1 smoke check

**Files:**
- (none — verification only)

- [ ] **Step 1: Run the full quality bar**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck && npm run lint && npm test && npm run build
```

Expected:
- `typecheck` → exit 0
- `lint` → exit 0 (or warnings only)
- `test` → all green, ≥ 60 cases passing
- `build` → success

- [ ] **Step 2: Commit any auto-fixes from lint/build**

```bash
git status
# if any files dirty:
git add -A
git commit -m "chore: post-cycle-1 quality bar passes"
```

- [ ] **Step 3: Tag the cycle**

```bash
git tag agency-mode-foundation-complete
git log --oneline -25
```

Show the last 25 commits — every task should produce one.

---

## Verification gates per the user's "test every mode" instruction

After Task 23, you should be able to demonstrate:

1. **Agency viewer** resolves correctly from a Clerk identity with `orgType=agency`; carries the four agency-role capabilities; staff role is scope-limited.
2. **Studio viewer** resolves for all 8 roles; capability set matches the policy map; cross-org access denied.
3. **Guest viewer** resolves from a magic-link token; expires; revokable; per-scope capability bundle correct.
4. **Sensitive actions** (`finance.refund`, `members.remove`, `songs.delete`, `grants.issue`, etc.) write to `auditEvents`; reads do not.
5. **Plan cap** enforced: Pro tier rejects the 3rd sub-account; Agency tier accepts many.
6. **Existing functions still work**: `npm run build` succeeds; the existing 25 convex files compile unchanged (since `currentOrg()` keeps its signature).

All six of these are covered by automated tests committed in this cycle.

---

## Out of scope (deliberately — cycles 2 and 3 own this)

- Any UI surface (agency console expansion, studio settings, guest pages, artist portal)
- Magic-link HTTP action that stamps a guest token into a sessionless context
- Stripe Checkout, webhook handlers, onboarding flow
- Adding `requireCapability` calls to all 25 existing Convex business functions (cycle 2 does this file-by-file as it builds out the surfaces)
- Custom domain / branding upload UI

If you finish Task 23 with all gates green, you are ready for cycle 2.
