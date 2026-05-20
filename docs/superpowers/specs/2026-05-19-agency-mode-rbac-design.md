# Pulse - Agency Mode + Granular RBAC Design

**Status:** Approved design, ready for implementation planning
**Date:** 2026-05-19
**Owner:** Lawrence Berment
**Scope:** Pulse (music-industry CRM at `/Users/myindsound/SaaS Build Pack/pulse`)

---

## 1. Goal

Add agency-mode and granular permissions to Pulse, modeled on GoHighLevel's two-tier Agency → Sub-Account structure but adapted for the music vertical (studios, session musicians, engineers, artists). The result is a multi-tenant SaaS where any agency can sign up, run multiple studios, scope staff access, and issue magic-link passes to external collaborators on specific songs or sessions.

This design does not introduce new business surfaces; it adds the access fabric that the existing surfaces (songs, sessions, deliverables, finance, etc.) now run on top of.

## 2. Comparable-product synthesis

| Product | What we keep | What we drop |
|---|---|---|
| **GoHighLevel** | Two-tier Agency → Sub-Account, scoped agency staff, consolidated agency billing, per-tier feature gates | Workflow builder, snapshots, marketplace |
| **HubSpot** | Module-level capability toggles, per-team data filtering | Paid "Business Units" add-on, profile bloat |
| **Salesforce / Zoho** | Per-member capability overrides as an escape hatch | Profile + permission set + role hierarchy + sharing rules stacking (overkill) |
| **Vendasta** | Plan-tier-per-sub-account, white-label-as-default | Marketplace orientation |
| **Music tools (Studio Manager, SoundBetter)** | none have an agency model; that is the opening |

The music vertical adds one pattern none of the above support natively: **scoped temporary access for non-employees** (session bassist, sync supervisor, external mix engineer). We invent that here as magic-link guest grants.

## 3. Decisions locked in

| # | Decision | Choice |
|---|---|---|
| 1 | Tenant shape | Multi-tenant SaaS; any agency can sign up |
| 2 | Persona layers covered | Agency, Studio, External-collab, Artist-client (all four) |
| 3 | Granularity model | Role-based with feature toggles (GHL style); per-member capability overrides as escape hatch |
| 4 | External-collab access | Magic-link guest passes; no Clerk account needed |
| 5 | Billing model | Plan-tier-based, single subscription per tenant; Stripe Customer = Agency (or Studio for base tier) |
| 6 | Build approach | Cross-cutting Access Engine first; then surfaces |
| 7 | Pricing | Studio $49 (1 sub-acct, no agency) / Pro $97 (2) / Agency $249 (unlimited) |
| 8 | Resell hook | Schema-ready (`agencies.resellEnabled`, `agencies.markupCents`); no MVP UI |
| 9 | Studio role inventory | 8 roles: owner, manager, engineer, assistant_engineer, artist_relations, producer, intern, accountant |
| 10 | Audit logging | Sensitive actions only |

## 4. Architecture overview

Three-layer hierarchy:

```
AGENCY  (Clerk Organization, type=agency)
  ├─ pays Pulse, owns billing + branding
  ├─ Agency Owner + scoped Agency Staff
  │
  └─ SUB-ACCOUNT (Clerk Organization, type=studio) ×N
       ├─ one studio's workspace (existing `orgs` table)
       ├─ Studio Owner / Manager / Engineer / Assistant / Artist Relations / Producer / Intern / Accountant
       │
       └─ GUEST GRANT (no Clerk account) ×N
            ├─ magic-link token + scope + expiry
            └─ session musician, sync supervisor, external mix/master pro, artist portal
```

Three identity sources collapse into a single `Viewer` object:

1. Clerk identity + Agency org membership → Agency Viewer
2. Clerk identity + Studio org membership → Studio Viewer
3. Magic-link token (request header) → Guest Viewer

One central Access Engine resolves every request. Every Convex query and mutation calls `requireCapability(ctx, "<module>.<action>", { resource })`. The engine handles role lookup, capability evaluation, scope check, and audit logging.

## 5. Pricing tiers

| Tier | Price/mo | Sub-accounts | Agency console | White-label | Magic-link grants/mo | Artist portal |
|---|---|---|---|---|---|---|
| **Studio** | $49 | 1 (self only) | none | none | 5 active | yes |
| **Pro** | $97 | 2 | basic | per-sub-account | 25 active | yes |
| **Agency** | $249 | unlimited (soft 25-cap) | full | agency-level domain + logo | unlimited | yes |

- Base-tier Studio customers have **no agency row**. The `agencies` table is only populated for Pro and Agency tiers.
- `orgs.agencyId` is optional; this is how base-tier studios coexist with multi-tenant agencies in one schema.
- Tier downgrades are blocked at the API and Stripe-portal layers if sub-account count exceeds the destination tier's cap.
- 14-day free trial for all tiers. Card required up front for Pro and Agency; optional for Studio.

A future **Agency Plus** (SaaS-resell) tier is schema-ready via `agencies.resellEnabled` and `agencies.markupCents`. No MVP price; turn on later without migration.

## 6. Data model

### 6.1 New tables (in `convex/schema.ts`)

#### `agencies`

```ts
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

#### `agencyMembers`

```ts
agencyMembers: defineTable({
  agencyId: v.string(),
  clerkUserId: v.string(),
  email: v.string(),
  name: v.string(),
  role: v.union(
    v.literal("owner"),                 // full control, billing, cannot be removed
    v.literal("admin"),                 // everything except billing + delete agency
    v.literal("staff"),                 // scoped via agencyMemberScopes
    v.literal("billing"),               // billing surface only
  ),
  capabilityOverrides: v.optional(v.array(v.string())),
  status: v.union(v.literal("active"), v.literal("invited"), v.literal("suspended")),
  invitedAt: v.number(),
  lastActiveAt: v.optional(v.number()),
})
  .index("by_agency", ["agencyId"])
  .index("by_clerk", ["clerkUserId"])
  .index("by_agency_clerk", ["agencyId", "clerkUserId"]),
```

#### `agencyMemberScopes`

```ts
agencyMemberScopes: defineTable({
  agencyId: v.string(),
  agencyMemberId: v.id("agencyMembers"),
  subAccountOrgId: v.string(),          // matches orgs.orgId
  capabilityOverrides: v.optional(v.array(v.string())),
})
  .index("by_member", ["agencyMemberId"])
  .index("by_subaccount", ["subAccountOrgId"]),
```

Empty for owner and admin (they get "all"). One row per (agencyMember, subAccountOrgId) for staff.

#### `collaboratorGrants`

```ts
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
  entityId: v.string(),                 // sessions._id | songs._id | deliverables._id | splitSheets._id | artists._id
  capabilities: v.array(v.string()),
  token: v.string(),                    // long random string; URL is /g/<token>
  expiresAt: v.number(),
  revoked: v.optional(v.boolean()),
  invitedBy: v.string(),
  firstUsedAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  useCount: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_token", ["token"])
  .index("by_entity", ["entityId"]),
```

#### `auditEvents`

```ts
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

### 6.2 Changes to existing tables

```ts
// orgs - add the optional parent agency link + cached tier
orgs: defineTable({
  ...existing fields,
  agencyId: v.optional(v.string()),     // NEW: parent agency, null for base tier
  tier: v.optional(v.union(             // NEW: cached for cap-check perf
    v.literal("studio"),
    v.literal("pro"),
    v.literal("agency"),
  )),
})
  ...existing indexes,
  .index("by_agency", ["agencyId"]),    // NEW
```

```ts
// members - extend the role enum to cover music-vertical personas
members: defineTable({
  ...existing fields,
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
})
```

### 6.3 What we deliberately do not add

- No separate `roles` table. Roles are an enum; capabilities derive from a static map in `convex/lib/access-policies.ts`.
- No deny rules. Capabilities are positive grants only.
- No "team" abstraction inside a sub-account. The studio scope is the team.

## 7. The Access Engine

Lives at `convex/lib/access.ts`. One file, one API, one place to test.

### 7.1 Public API

```ts
export async function resolveViewer(ctx: QueryCtx | MutationCtx): Promise<Viewer>;

export async function requireCapability(
  ctx: QueryCtx | MutationCtx,
  capability: Capability,
  resource?: { orgId?: string; entityId?: string; entityType?: ResourceType },
): Promise<Viewer>;
```

### 7.2 The Viewer object

```ts
type Viewer =
  | {
      kind: "agency_member";
      agencyId: string;
      agencyMemberId: Id<"agencyMembers">;
      clerkUserId: string;
      role: "owner" | "admin" | "staff" | "billing";
      scopedSubAccountOrgIds: string[] | "all";
      capabilities: Set<Capability>;
    }
  | {
      kind: "studio_member";
      orgId: string;
      agencyId?: string;
      memberId: Id<"members">;
      clerkUserId: string;
      role: StudioRole;
      capabilities: Set<Capability>;
    }
  | {
      kind: "guest";
      grantId: Id<"collaboratorGrants">;
      orgId: string;
      agencyId?: string;
      scope: GrantScope;
      entityId: string;
      capabilities: Set<Capability>;
      expiresAt: number;
    };
```

### 7.3 Resolution order

```
resolveViewer(ctx):
  1. Read ctx.auth.getUserIdentity()
     • if no Clerk identity → check `x-guest-token` header
       → look up `collaboratorGrants` by token
       → verify not revoked, expiresAt > now
       → return Guest viewer
     • else continue
  2. Read Clerk org id from identity claims
     • if Clerk org publicMetadata.type === "agency" → return Agency viewer
     • if Clerk org publicMetadata.type === "studio" → return Studio viewer
     • else throw NO_VIEWER
```

### 7.4 Capability evaluation

```
requireCapability(ctx, cap, resource):
  1. viewer = resolveViewer(ctx)
  2. switch viewer.kind:
       agency_member:
         a. viewer.capabilities.has(cap)
         b. orgId in viewer.scopedSubAccountOrgIds OR scope === "all"
         c. orgs[orgId].agencyId === viewer.agencyId
       studio_member:
         a. viewer.orgId === orgId
         b. viewer.capabilities.has(cap)
       guest:
         a. viewer.entityId === entityId
         b. viewer.expiresAt > now AND !revoked
         c. viewer.capabilities.has(cap)
  3. on any fail → audit-log deny (if sensitive) + throw
  4. on success → audit-log allow (if sensitive) + return viewer
```

### 7.5 Capability namespacing

Dot-namespaced `<module>.<action>` strings. Full list lives in `convex/lib/access-policies.ts` and is the single source of truth.

Modules: `songs, sessions, deliverables, engineeringLogs, splitsheet, artists, rooms, equipment, invoices, payments, opportunities, syncOpportunities, releaseCampaigns, licenses, activity, insights, members, branding, billing, grants, agency.subaccount, agency.staff`.

### 7.6 Integration with existing Convex functions

Existing pattern in every business function today:

```ts
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw new Error("unauth");
const orgId = await currentOrg(ctx);
```

New pattern:

```ts
const viewer = await requireCapability(ctx, "sessions.edit", {
  orgId: args.orgId,
  entityId: args.sessionId,
});
// viewer.orgId is now trusted
```

### 7.7 Edge cases on the record

- **Internal/system calls** (Stripe webhooks, scheduled actions): a `systemViewer()` factory returns a synthetic Viewer with all capabilities. Only callable from `internalMutation` and `internalAction`.
- **Long-running guest sessions**: HTTP actions handle the initial token resolve and set a short-lived `guestSessionId` cookie that Convex queries can read.
- **Time-bombed grant race conditions**: compute `now` once per request; compare against `expiresAt`.

## 8. Capability matrix

The policy map lives in `convex/lib/access-policies.ts`. Default capabilities per role; per-member overrides handled via `members.capabilityOverrides` array of `+cap` / `-cap` tokens.

### 8.1 Agency layer

| Capability | Owner | Admin | Staff | Billing |
|---|:-:|:-:|:-:|:-:|
| `agency.subaccount.create` | ✓ | ✓ | – | – |
| `agency.subaccount.pause` | ✓ | ✓ | scope | – |
| `agency.subaccount.delete` | ✓ | – | – | – |
| `agency.staff.invite` | ✓ | ✓ | – | – |
| `agency.staff.scope` | ✓ | ✓ | – | – |
| `agency.viewAll` | ✓ | ✓ | – | – |
| `billing.read` | ✓ | ✓ | – | ✓ |
| `billing.edit` | ✓ | – | – | ✓ |
| `branding.edit` (agency-level) | ✓ | ✓ | – | – |
| `act_as_studio.*` (gain studio-owner caps when entering a scoped sub-account) | ✓ | ✓ | scope | – |

### 8.2 Studio layer

Read-only (R), full (✓), own-records-only (own), none (–):

| Capability | Owner | Manager | Engineer | Asst Eng | Artist Rel | Producer | Intern | Accountant |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `songs.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | R | R |
| `songs.edit` | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – |
| `songs.delete` | ✓ | ✓ | – | – | – | – | – | – |
| `sessions.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | R | R |
| `sessions.edit` | ✓ | ✓ | ✓ | own | ✓ | ✓ | – | – |
| `sessions.cancel` | ✓ | ✓ | – | – | ✓ | – | – | – |
| `deliverables.upload` | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – |
| `deliverables.approve` | ✓ | ✓ | ✓ | – | – | ✓ | – | – |
| `engineeringLogs.edit` | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – |
| `splitsheet.edit` | ✓ | ✓ | – | – | – | ✓ | – | – |
| `splitsheet.sign` | ✓ | – | – | – | – | ✓ | – | – |
| `invoices.read` | ✓ | ✓ | – | – | ✓ | – | – | ✓ |
| `invoices.send` | ✓ | ✓ | – | – | – | – | – | ✓ |
| `finance.refund` | ✓ | ✓ | – | – | – | – | – | ✓ |
| `members.invite` | ✓ | ✓ | – | – | – | – | – | – |
| `members.remove` | ✓ | – | – | – | – | – | – | – |
| `branding.edit` (studio-level) | ✓ | ✓ | – | – | – | – | – | – |
| `grants.issue` | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | – |
| `grants.revoke` | ✓ | ✓ | own | – | own | own | – | – |
| `rooms.edit` / `equipment.edit` | ✓ | ✓ | – | – | – | – | – | – |
| `licenses.edit` (beat sales) | ✓ | ✓ | – | – | ✓ | ✓ | – | ✓ |
| `syncOpportunities.edit` | ✓ | ✓ | – | – | ✓ | ✓ | – | – |

### 8.3 Guest grant scopes

Each scope is a fixed capability bundle. Studios pick one scope per grant.

| Scope | Capability bundle | Default expiry |
|---|---|---|
| `session` | `sessions.read` (one), `engineeringLogs.read` (one), `deliverables.read` (own contributions) | 14 days post-session |
| `song` | `songs.read` (one), `deliverables.read+upload` (one song), `engineeringLogs.read` (one), `revisionComments.write` | 30 days |
| `deliverable` | `deliverables.read+approve` (one version), `revisionComments.write` | 7 days |
| `splitsheet` | `splitsheet.read+sign` (one) | 30 days |
| `artist_portal` | `songs.read` (theirs), `sessions.read` (theirs), `deliverables.read+approve` (theirs), `invoices.read` (theirs), `revisionComments.write` | 1 year, renewable |

### 8.4 Capability overrides - the escape hatch

`members.capabilityOverrides` accepts tokens like `["+finance.read", "-deliverables.approve"]`. The engine applies these on top of the role default. Surfaced in the UI as a "Customize permissions" disclosure under the role picker.

## 9. UI surfaces

### 9.1 Agency Console (`src/app/(agency)/agency/*`)

| Route | Status | Purpose |
|---|---|---|
| `/agency` | exists | Subaccounts list + KPI rollup |
| `/agency/subaccounts/new` | exists | Provision a new sub-account (gated by plan cap) |
| `/agency/subaccounts/[orgId]` | exists | Drill-down, "enter as," pause/resume |
| `/agency/staff` | NEW | Agency members table, invite, role, scope assignment |
| `/agency/staff/[id]/scope` | NEW | Pick which sub-accounts a staff member can reach |
| `/agency/branding` | NEW | Agency logo, accent, custom domain, app name |
| `/agency/billing` | NEW | Current plan, sub-account usage vs cap, upgrade/downgrade, invoices |
| `/agency/audit` | NEW | Audit log viewer (filter by member, action, sub-account) |

### 9.2 Studio Settings (`src/app/(studio)/settings/*`)

| Route | Status | Purpose |
|---|---|---|
| `/settings/general` | exists | Name, slug, tagline, booking page intro |
| `/settings/branding` | exists | Logo, accent, booking hero |
| `/settings/members` | NEW (expand) | Studio members table; role picker; "Customize permissions" disclosure |
| `/settings/guests` | NEW | Active guest grants; copy link; revoke; last-used; issue new |
| `/settings/plan` | NEW | Read-only when managed by an agency; upgrade CTA if base tier |

### 9.3 Artist Portal (`src/app/portal/[token]/*`)

Separate route tree, no shared shell with studio app. Skinned per studio.

- `/portal/[token]` - Hub: artist's songs, sessions, invoices at a glance
- `/portal/[token]/songs/[songId]` - Song detail, deliverable list, comment thread
- `/portal/[token]/deliverables/[id]` - Player with waveform, approve, leave timestamped comment
- `/portal/[token]/invoices` - Invoice list, pay button
- `/portal/[token]/splits/[id]` - Sign split sheet

### 9.4 Guest Magic-Link (`src/app/g/[token]/*`)

Single dynamic route, shell switches on `grant.scope`. Handles four of the five grant scopes; the fifth (`artist_portal`) lives in its own route tree at `/portal/[token]` (Section 9.3) because the artist's surface is broader than a single-entity guest view.

- `scope=session` → simple session view
- `scope=song` → song view with stems and revision comments
- `scope=deliverable` → focused review with one waveform
- `scope=splitsheet` → e-sign view

Aggressively narrow: no nav, no other content, just the one thing.

### 9.5 Onboarding (`src/app/(auth)/onboard/*`)

Three-step:

1. Tier picker: Studio $49 / Pro $97 / Agency $249 (Stripe Checkout)
2. If Pro/Agency: create agency (name, slug). Auto-creates Clerk org with publicMetadata.type=agency.
3. Create first sub-account (identical to existing studio setup).

Existing base-tier users upgrading to Pro spawn an agency wrapper around their existing org with no data move.

### 9.6 Shared access components (`src/components/access/`)

- `<RolePicker layer="agency"|"studio" value onChange />`
- `<CapabilityOverridesEditor role overrides onChange />` (disclosure under RolePicker)
- `<ScopePicker agencyId selectedOrgIds onChange />` (agency staff only)
- `<CapGuard cap fallback>{children}</CapGuard>` (server component; renders or fallback)

### 9.7 Demo persona switcher (extend existing `PersonaSwitcher`)

Add agency-tier viewers (Agency Owner, scoped Agency Staff) and guest tokens (session musician, artist portal) so the full permission surface is browsable in demo mode without seeding real Clerk orgs.

## 10. Billing implementation

Stripe integration lives in `convex/integrations/stripe.ts`.

### 10.1 Object shape

- **Customer**: one per agency (Pro/Agency tiers) or one per org (Studio tier).
- **Subscription**: one per Customer; single line item against tier price.
- **Prices** (env vars):
  - `STRIPE_PRICE_STUDIO` → $49/mo
  - `STRIPE_PRICE_PRO` → $97/mo
  - `STRIPE_PRICE_AGENCY` → $249/mo
  - `STRIPE_PRICE_AGENCY_PLUS` → unset in MVP, schema-ready
- **Webhook endpoint**: `convex/http.ts` route `/stripe/webhook` → `internal.billing.handleWebhook`.

### 10.2 Provisioning flow

```
/onboard → user picks tier
  → billing.beginCheckout(tier):
     • create Stripe Customer (metadata: clerkUserId, intendedAgencyName)
     • create Checkout Session in subscription mode
     • return checkout URL
  → user completes Stripe Checkout
  → webhook checkout.session.completed:
     • if Pro/Agency: create Clerk org type=agency, insert `agencies` row
     • create first `orgs` row, linked to agency if applicable
     • call seedStarterWorkspace()
  → redirect to /agency or /studio dashboard
```

### 10.3 Webhook handlers (idempotent)

| Event | Behavior |
|---|---|
| `checkout.session.completed` | provision agency + first sub-account |
| `customer.subscription.updated` | update `agencies.plan`; cascade `orgs.tier` |
| `customer.subscription.deleted` | set `agencies.status = "paused"`; auto-pause sub-accounts |
| `invoice.payment_failed` | trial → active → paused state machine |
| `invoice.payment_succeeded` | bump `lastPaidAt`; lift holds |

De-duplication via a `stripeEventsProcessed` table keyed on `event.id`.

### 10.4 Plan limits

`convex/lib/plans.ts`:

```ts
export const PLAN_LIMITS = {
  studio: { subAccountCap: 1,   magicLinkGrantsPerMonth: 5,   whitelabel: false,           customDomain: false },
  pro:    { subAccountCap: 2,   magicLinkGrantsPerMonth: 25,  whitelabel: "studio_level",  customDomain: false },
  agency: { subAccountCap: 999, magicLinkGrantsPerMonth: 999, whitelabel: "agency_level",  customDomain: true  },
} as const;
```

Enforced inside `agency.createSubaccount`, `grants.issue`, `branding.editAgencyLevel`, `branding.setCustomDomain`.

### 10.5 Tier transitions

| From | To | Behavior |
|---|---|---|
| Studio → Pro / Agency | upgrade | Auto-create agency wrapper around existing org. User is owner of new agency. No data move. |
| Pro → Agency | upgrade | Flip `agencies.plan`. Sub-account cap goes from 2 → unlimited. |
| Agency → Pro | downgrade | Blocked at API if `subaccountCount > 2`. UI says "Pause or delete N sub-accounts first." |
| Pro → Studio | downgrade | Blocked at API if `subaccountCount > 1`. Same UI. |
| Any → cancelled | hard | After 14-day grace, set all `orgs.status = "paused"`. Data preserved; logins blocked. |

Block enforced at both layers: API mutation throws, Stripe Customer Portal restricts via `subscription_update` config.

### 10.6 Trials and payment failure

- 14-day free trial all tiers. No card up front for Studio; required for Pro and Agency.
- Stripe Smart Retries (3 attempts over 14 days) on failure. After final fail: `agencies.status = "paused"`; sub-accounts read-only with billing banner. Reactivation via Stripe Customer Portal.

### 10.7 Future: Agency Plus (SaaS resell)

Schema fields exist (`agencies.resellEnabled`, `agencies.markupCents`). Activation later requires Stripe Connect Standard for the agency and a sub-account-as-customer pattern under the agency's Connect account. Pulse takes a platform fee; agency keeps markup. Zero schema changes from MVP.

## 11. Testing

### 11.1 Access Engine unit tests - `convex/lib/access.test.ts`

One file. ~80 cases. Table-driven `[viewer, action, resource, expected]`. Mocked `ctx`. Capability matrix from Section 8 IS the fixture. Target: 100% branch coverage on `requireCapability`.

### 11.2 Integration tests - `convex/agency.test.ts`, `convex/billing.test.ts`, `convex/grants.test.ts`

`convex-test` harness (existing pattern). Critical flows:

- Agency provisioning + sub-account create at cap throws `plan_cap_reached`
- Agency staff invite + scope assignment + scoped query returns subset
- Guest grant issue → use → expire (time-travel via test clock)
- Stripe webhook idempotency (replay same event, single state change)
- Tier downgrade with sub-accounts over cap is blocked

### 11.3 End-to-end - `e2e/agency-rbac.spec.ts`, `e2e/portal.spec.ts`, `e2e/guest-link.spec.ts`

Playwright. One happy-path test per persona:

- Agency Owner provisions a sub-account
- Agency Staff scoped to 1 of 2 studios sees only their scope
- Studio Engineer cannot see Finance
- Artist Portal user approves a deliverable
- Session Musician sees one session and nothing else

### 11.4 Merge gate

Access Engine 100%, integrations ≥ 90%, E2E happy paths green.

## 12. Migration plan

All migrations idempotent and runnable on every deploy.

### 12.1 `agencies` backfill - zero-impact

Existing `orgs` rows work with no `agencyId`. They are base-tier studios. No data move.

### 12.2 `members.role` enum widening

Existing roles stay valid. New roles available but no row retagged automatically. Convex schema validation handles the union.

### 12.3 `orgs.tier` cache backfill

One-time `internal.migrations.backfillOrgTier`: walks every `orgs` row, sets `tier = "studio"` for rows without one. Idempotent.

## 13. Rollout sequence

Phased so demo mode and base Studio tier never break. Each step ships independently behind `NEXT_PUBLIC_AGENCY_ENABLED`.

1. **Foundation**: schema + Access Engine + capability matrix + unit tests. No UI change. Existing functions still work via legacy `currentOrg()`.
2. **Migrate Convex functions**: swap `currentOrg()` for `requireCapability()` file by file. Per-file PR with gitnexus impact check first.
3. **Studio settings expansion**: `/settings/members` with role picker + overrides.
4. **Agency console expansion**: `/agency/staff`, `/agency/branding`, `/agency/audit`.
5. **Magic-link guest grants**: `/g/<token>` shells + grant issuance UI in studio settings.
6. **Artist portal**: `/portal/<token>` shells.
7. **Billing**: Stripe Checkout + webhooks + plan-cap enforcement + onboard flow.
8. **Demo persona switcher extension**: Agency/Guest personas browsable.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Migrating 28+ existing Convex functions to `requireCapability` introduces subtle regressions | Per-file PR with gitnexus impact check; existing E2E suite as gate; feature flag rollback |
| Clerk org-type metadata not first-class in Clerk | Set `publicMetadata.type = "agency"\|"studio"` on org create; `resolveViewer` reads it; covered by integration tests |
| Magic-link tokens leak via URL referrers | `referrerPolicy="no-referrer"` on guest pages; short expiries; revocation UI |
| Stripe webhook race against checkout redirect | Webhook is source of truth; redirect polls `agencies.status` before showing dashboard |
| Convex queries cannot read request headers (where `x-guest-token` lives) | Guest views use HTTP actions for initial token-resolve; pass short-lived `guestSessionId` cookie that queries can read |
| 8 studio roles is more than typical SaaS; UX risk | Role picker shows a one-line description on each option; capability matrix is the source of truth, not the role name |

## 15. Design summary

| Layer | Decision |
|---|---|
| Tenants | Multi-tenant SaaS, three plans: Studio $49 / Pro $97 / Agency $249. `agencies` optional; base-tier skips it. |
| Personas | 4 agency roles, 8 studio roles, 5 guest grant scopes. |
| Authorization | One central Access Engine (`requireCapability`) consumed by every Convex function. |
| Capabilities | Dot-namespaced strings, static policy map, per-member overrides for edge cases. |
| External collabs | Magic-link guest grants, scope + entity + expiry, no Clerk account needed. |
| Billing | Stripe Customer = Agency (or Studio for base tier), tier-priced single subscription, schema hook for SaaS resell. |
| White-label | Per-agency (logo, color, app name, optional custom domain) + per-sub-account branding. |
| Observability | `auditEvents` table for sensitive actions, viewable in `/agency/audit`. |
| Migration | Zero-impact backfill; per-file Convex function migration; existing demo + single-org accounts unaffected. |
