# Agency Mode Surfaces - Implementation Plan (Cycle 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the UI + backend surfaces that let agency operators *actually use* the engine shipped in Cycle 1 - agency staff management, scoped sub-account access, studio member role + override editing, branding, audit log viewer, and the guest magic-link landing pages.

**Architecture:** Backend mutations for agencyMembers + agencyMemberScopes CRUD (`convex/agencyStaff.ts`) and members.ts expansion. Shared access UI components in `src/components/access/`. New Next routes under `(agency)` and `(studio)`. Magic-link guests resolve via an HTTP action that exchanges a token for a guest session cookie. Demo persona switcher extended to browse all four agency roles + guest scopes.

**Tech Stack:** Convex 1.39, Next 16 RSC + Turbopack, Clerk Next, Tailwind v4, Radix UI (already in deps), vitest + convex-test.

**Spec reference:** `docs/superpowers/specs/2026-05-19-agency-mode-rbac-design.md` (sections 9.1-9.7)

**Cycle 1 reference:** `docs/superpowers/plans/2026-05-19-agency-mode-foundation.md`

---

## File map

| Path | Action | Purpose |
|---|---|---|
| `convex/agencyStaff.ts` | create | agencyMembers CRUD + scope mgmt |
| `convex/members.ts` | modify | invite/update/remove with cap checks |
| `convex/branding.ts` | create | branding mutations for agency + studio |
| `convex/audit.ts` | create | list query for audit log viewer |
| `convex/http.ts` | create | HTTP action: exchange guest token → session |
| `convex/grants.ts` | modify | session resolve via cookie |
| `convex/lib/access.ts` | modify | add guest viewer branch via session cookie |
| `convex/seed.ts` | modify | seed demo agency + 2 sub-accounts |
| `convex/agencyStaff.test.ts` | create | invite + scope + role tests |
| `convex/branding.test.ts` | create | branding cap-gated tests |
| `src/components/access/RolePicker.tsx` | create | shared dropdown for 4 + 8 roles |
| `src/components/access/ScopePicker.tsx` | create | sub-account multi-select |
| `src/components/access/CapabilityOverrides.tsx` | create | +cap / -cap editor disclosure |
| `src/components/access/CapGuard.tsx` | create | server component that gates children |
| `src/app/(agency)/agency/staff/page.tsx` | create | agency members list |
| `src/app/(agency)/agency/staff/[id]/page.tsx` | create | one staff member detail + scope |
| `src/app/(agency)/agency/branding/page.tsx` | create | agency white-label form |
| `src/app/(agency)/agency/audit/page.tsx` | create | audit log table |
| `src/app/settings/members/page.tsx` | modify | role picker + overrides for 8 roles |
| `src/app/g/[token]/page.tsx` | create | guest magic-link landing (scope router) |
| `src/app/portal/[token]/page.tsx` | create | artist portal hub |

---

## Phase A - Backend mutations (Tasks 1-4)

## Task 1: agencyStaff module - invite + setRole + remove

**Files:**
- Create: `convex/agencyStaff.ts`

- [ ] **Step 1: Write the file**

```ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";

const agencyRoleV = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("staff"),
  v.literal("billing"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireCapability(ctx, "agency.viewAll");
    if (viewer.kind !== "agency_member") return [];
    return await ctx.db
      .query("agencyMembers")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .collect();
  },
});

export const invite = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: agencyRoleV,
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "agency.staff.invite");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    // Use a stub clerkUserId until Clerk invitation lands the real one.
    const stub = `pending_${args.email.replace(/[^a-z0-9]/g, "_")}`;
    const id = await ctx.db.insert("agencyMembers", {
      agencyId: viewer.agencyId,
      clerkUserId: stub,
      email: args.email,
      name: args.name,
      role: args.role,
      capabilityOverrides: args.capabilityOverrides,
      status: "invited",
      invitedAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

export const setRole = mutation({
  args: {
    memberId: v.id("agencyMembers"),
    role: agencyRoleV,
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { memberId, role, capabilityOverrides }) => {
    const viewer = await requireCapability(ctx, "agency.staff.invite");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const m = await ctx.db.get(memberId);
    if (!m || m.agencyId !== viewer.agencyId) throw new Error("not found");
    if (m.role === "owner" && role !== "owner") throw new Error("cannot demote owner");
    await ctx.db.patch(memberId, { role, capabilityOverrides });
  },
});

export const remove = mutation({
  args: { memberId: v.id("agencyMembers") },
  handler: async (ctx, { memberId }) => {
    const viewer = await requireCapability(ctx, "agency.staff.invite");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const m = await ctx.db.get(memberId);
    if (!m || m.agencyId !== viewer.agencyId) throw new Error("not found");
    if (m.role === "owner") throw new Error("cannot remove owner");
    // Cascade scopes
    const scopes = await ctx.db
      .query("agencyMemberScopes")
      .withIndex("by_member", (q) => q.eq("agencyMemberId", memberId))
      .collect();
    for (const s of scopes) await ctx.db.delete(s._id);
    await ctx.db.delete(memberId);
  },
});

export const scopes = query({
  args: { memberId: v.id("agencyMembers") },
  handler: async (ctx, { memberId }) => {
    await requireCapability(ctx, "agency.viewAll");
    return await ctx.db
      .query("agencyMemberScopes")
      .withIndex("by_member", (q) => q.eq("agencyMemberId", memberId))
      .collect();
  },
});

export const setScopes = mutation({
  args: {
    memberId: v.id("agencyMembers"),
    subAccountOrgIds: v.array(v.string()),
  },
  handler: async (ctx, { memberId, subAccountOrgIds }) => {
    const viewer = await requireCapability(ctx, "agency.staff.scope");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const m = await ctx.db.get(memberId);
    if (!m || m.agencyId !== viewer.agencyId) throw new Error("not found");
    // Replace all scopes
    const existing = await ctx.db
      .query("agencyMemberScopes")
      .withIndex("by_member", (q) => q.eq("agencyMemberId", memberId))
      .collect();
    for (const s of existing) await ctx.db.delete(s._id);
    for (const subAccountOrgId of subAccountOrgIds) {
      await ctx.db.insert("agencyMemberScopes", {
        agencyId: viewer.agencyId,
        agencyMemberId: memberId,
        subAccountOrgId,
      });
    }
  },
});
```

- [ ] **Step 2: Codegen + typecheck**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex dev --once --typecheck disable
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add convex/agencyStaff.ts convex/_generated/api.d.ts
git commit -m "feat(agency): agencyStaff CRUD + scope mutations

list / invite / setRole / remove / scopes / setScopes; all gated by
agency.staff.invite or agency.staff.scope capabilities; cascade
scopes on remove; refuse to demote/remove the owner."
```

## Task 2: members.ts expansion

**Files:**
- Modify: `convex/members.ts`

- [ ] **Step 1: Read current members.ts**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
cat convex/members.ts
```

- [ ] **Step 2: Add invite / updateRole / remove mutations with capability checks**

Append to `convex/members.ts`:

```ts
import { requireCapability } from "./lib/access";

const studioRoleV = v.union(
  v.literal("owner"),
  v.literal("manager"),
  v.literal("engineer"),
  v.literal("assistant_engineer"),
  v.literal("artist_relations"),
  v.literal("producer"),
  v.literal("intern"),
  v.literal("accountant"),
);

export const invite = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    role: studioRoleV,
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) throw new Error("requires active org");
    const stub = `pending_${args.email.replace(/[^a-z0-9]/g, "_")}`;
    return await ctx.db.insert("members", {
      orgId, name: args.name, email: args.email, role: args.role,
      capabilityOverrides: args.capabilityOverrides,
      clerkUserId: stub, skills: [],
    });
  },
});

export const updateRole = mutation({
  args: {
    memberId: v.id("members"),
    role: studioRoleV,
    capabilityOverrides: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { memberId, role, capabilityOverrides }) => {
    const viewer = await requireCapability(ctx, "members.invite");
    const m = await ctx.db.get(memberId);
    if (!m || m.orgId !== ("orgId" in viewer ? viewer.orgId : "")) throw new Error("not found");
    if (m.role === "owner" && role !== "owner") throw new Error("cannot demote owner");
    await ctx.db.patch(memberId, { role, capabilityOverrides });
  },
});

export const remove = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const viewer = await requireCapability(ctx, "members.remove");
    const m = await ctx.db.get(memberId);
    if (!m || m.orgId !== ("orgId" in viewer ? viewer.orgId : "")) throw new Error("not found");
    if (m.role === "owner") throw new Error("cannot remove owner");
    await ctx.db.delete(memberId);
  },
});
```

Add `import { mutation, query }` to the top if not present. Reuse existing `v` import.

- [ ] **Step 3: Codegen + typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex dev --once --typecheck disable
npm run typecheck
git add convex/members.ts convex/_generated/api.d.ts
git commit -m "feat(members): invite / updateRole / remove with capability checks

Gated by members.invite + members.remove. Refuses to demote or
remove the owner. capabilityOverrides flow through end-to-end."
```

## Task 3: branding module

**Files:**
- Create: `convex/branding.ts`

- [ ] **Step 1: Write the file**

```ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";
import { PLAN_LIMITS } from "./lib/plans";

export const updateAgencyBranding = mutation({
  args: {
    accentColor: v.optional(v.string()),
    appName: v.optional(v.string()),
    customDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "branding.edit");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .first();
    if (!ag) throw new Error("agency not found");

    // Plan-cap check: custom domain requires Agency tier
    if (args.customDomain) {
      const tier: "pro" | "agency" = ag.plan === "pro" ? "pro" : "agency";
      if (!PLAN_LIMITS[tier].customDomain) {
        throw new Error("Custom domain requires Agency tier.");
      }
    }
    await ctx.db.patch(ag._id, {
      accentColor: args.accentColor ?? ag.accentColor,
      appName: args.appName ?? ag.appName,
      customDomain: args.customDomain ?? ag.customDomain,
    });
  },
});

export const updateStudioBranding = mutation({
  args: {
    accentColor: v.optional(v.string()),
    tagline: v.optional(v.string()),
    bookingHeadline: v.optional(v.string()),
    bookingIntro: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "branding.edit");
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) throw new Error("requires active org");
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("org not found");
    await ctx.db.patch(org._id, {
      accentColor: args.accentColor ?? org.accentColor,
      tagline: args.tagline ?? org.tagline,
      bookingHeadline: args.bookingHeadline ?? org.bookingHeadline,
      bookingIntro: args.bookingIntro ?? org.bookingIntro,
    });
  },
});
```

- [ ] **Step 2: Codegen + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex dev --once --typecheck disable
npm run typecheck
git add convex/branding.ts convex/_generated/api.d.ts
git commit -m "feat(branding): updateAgencyBranding + updateStudioBranding

Both gated by branding.edit. Custom domain requires Agency tier per
PLAN_LIMITS. Per-sub-account branding stays on the orgs row;
agency-level lives on agencies row."
```

## Task 4: audit.ts list query

**Files:**
- Create: `convex/audit.ts`

- [ ] **Step 1: Write the file**

```ts
import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";

export const list = query({
  args: {
    limit: v.optional(v.number()),
    actionFilter: v.optional(v.string()),
    resultFilter: v.optional(v.union(v.literal("allow"), v.literal("deny"))),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "audit.read");
    if (viewer.kind !== "agency_member") return [];
    const cap = args.limit ?? 200;
    let rows = await ctx.db
      .query("auditEvents")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .order("desc")
      .take(cap);
    if (args.actionFilter) rows = rows.filter((r) => r.action.startsWith(args.actionFilter!));
    if (args.resultFilter) rows = rows.filter((r) => r.result === args.resultFilter);
    return rows;
  },
});
```

- [ ] **Step 2: Codegen + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex dev --once --typecheck disable
npm run typecheck
git add convex/audit.ts convex/_generated/api.d.ts
git commit -m "feat(audit): list query with action + result filters"
```

## Phase B - Integration tests (Tasks 5-6)

## Task 5: agencyStaff + members tests

**Files:**
- Create: `convex/agencyStaff.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("agencyStaff - CRUD + scoping", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seedAgency() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x", name: "Owner",
        role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1", name: "Sub1", slug: "s1", plan: "studio", status: "active", agencyId: "org_ag",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub2", name: "Sub2", slug: "s2", plan: "studio", status: "active", agencyId: "org_ag",
      });
    });
    return t.withIdentity({
      subject: "u_owner", name: "Owner", orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
  }

  it("owner invites a staff member; list returns it", async () => {
    const owner = await seedAgency();
    await owner.mutation(api.agencyStaff.invite, {
      email: "s@x", name: "Staffer", role: "staff",
    });
    const list = await owner.query(api.agencyStaff.list, {});
    expect(list.length).toBe(2); // owner + new staff
  });

  it("setScopes replaces the scope list", async () => {
    const owner = await seedAgency();
    const created = await owner.mutation(api.agencyStaff.invite, {
      email: "s@x", name: "Staffer", role: "staff",
    });
    await owner.mutation(api.agencyStaff.setScopes, {
      memberId: created!._id,
      subAccountOrgIds: ["org_sub1"],
    });
    const scopes1 = await owner.query(api.agencyStaff.scopes, { memberId: created!._id });
    expect(scopes1.length).toBe(1);
    expect(scopes1[0].subAccountOrgId).toBe("org_sub1");

    await owner.mutation(api.agencyStaff.setScopes, {
      memberId: created!._id,
      subAccountOrgIds: ["org_sub1", "org_sub2"],
    });
    const scopes2 = await owner.query(api.agencyStaff.scopes, { memberId: created!._id });
    expect(scopes2.length).toBe(2);
  });

  it("cannot demote or remove the owner", async () => {
    const owner = await seedAgency();
    const owners = await owner.query(api.agencyStaff.list, {});
    const ownerRow = owners.find((m) => m.role === "owner")!;
    await expect(
      owner.mutation(api.agencyStaff.setRole, { memberId: ownerRow._id, role: "admin" }),
    ).rejects.toThrow();
    await expect(
      owner.mutation(api.agencyStaff.remove, { memberId: ownerRow._id }),
    ).rejects.toThrow();
  });

  it("billing-role member cannot invite staff", async () => {
    const owner = await seedAgency();
    await owner.mutation(api.agencyStaff.invite, {
      email: "b@x", name: "Bookkeeper", role: "billing",
    });
    await t.run(async (ctx) => {
      const m = (await ctx.db.query("agencyMembers")
        .withIndex("by_clerk", (q) => q.eq("clerkUserId", "pending_b_x"))
        .first())!;
      await ctx.db.patch(m._id, { clerkUserId: "u_billing", status: "active" });
    });
    const asBilling = t.withIdentity({
      subject: "u_billing", name: "B", orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
    await expect(
      asBilling.mutation(api.agencyStaff.invite, { email: "x@x", name: "X", role: "staff" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
git add convex/agencyStaff.test.ts
git commit -m "test(agencyStaff): invite + scope + role + billing-cannot-invite"
```

## Task 6: branding + audit smoke tests

**Files:**
- Create: `convex/branding.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

describe("branding", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("agency tier can set custom domain; pro cannot", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_o", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_o", email: "o@x", name: "O",
        role: "owner", status: "active", invitedAt: 0,
      });
    });
    const asAg = t.withIdentity({
      subject: "u_o", name: "O", orgId: "org_ag", orgType: "agency",
    } as { subject: string; name: string; orgId: string; orgType: string });
    await asAg.mutation(api.branding.updateAgencyBranding, {
      customDomain: "app.acme.com", accentColor: "#fdb913",
    });

    // Now downgrade to pro
    await t.run(async (ctx) => {
      const ag = (await ctx.db.query("agencies").first())!;
      await ctx.db.patch(ag._id, { plan: "pro", customDomain: undefined });
    });
    await expect(
      asAg.mutation(api.branding.updateAgencyBranding, { customDomain: "app.acme.com" }),
    ).rejects.toThrow(/Custom domain requires Agency tier/);
  });

  it("studio owner can update studio branding", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s", name: "S", slug: "s", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_s", name: "O", role: "owner", clerkUserId: "u_o", skills: [],
      });
    });
    const owner = t.withIdentity({ subject: "u_o", name: "O", orgId: "org_s" });
    await owner.mutation(api.branding.updateStudioBranding, {
      tagline: "Where the record gets made.",
    });
    const org = await t.run(async (ctx) =>
      await ctx.db.query("orgs").first(),
    );
    expect(org!.tagline).toBe("Where the record gets made.");
  });

  it("studio intern cannot edit branding", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_s", name: "S", slug: "s", plan: "studio", status: "active",
      });
      await ctx.db.insert("members", {
        orgId: "org_s", name: "I", role: "intern", clerkUserId: "u_i", skills: [],
      });
    });
    const intern = t.withIdentity({ subject: "u_i", name: "I", orgId: "org_s" });
    await expect(
      intern.mutation(api.branding.updateStudioBranding, { tagline: "X" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
git add convex/branding.test.ts
git commit -m "test(branding): plan-tier gate for custom domain + cap-gated writes"
```

## Phase C - Shared access components (Tasks 7-9)

## Task 7: RolePicker component

**Files:**
- Create: `src/components/access/RolePicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import * as React from "react";

const AGENCY_ROLES = [
  { value: "owner",   label: "Owner",   desc: "Full control, billing, agency settings" },
  { value: "admin",   label: "Admin",   desc: "Everything except billing + delete agency" },
  { value: "staff",   label: "Staff",   desc: "Scoped to specific sub-accounts" },
  { value: "billing", label: "Billing", desc: "Billing surface only" },
] as const;

const STUDIO_ROLES = [
  { value: "owner",              label: "Owner",              desc: "Runs the studio; full control" },
  { value: "manager",            label: "Manager",            desc: "Bookings, clients, members" },
  { value: "engineer",           label: "Engineer",           desc: "Runs sessions, edits songs and deliverables" },
  { value: "assistant_engineer", label: "Assistant Engineer", desc: "Narrower scope; own sessions only" },
  { value: "artist_relations",   label: "Artist Relations",   desc: "Booker / front-of-house; CRM access" },
  { value: "producer",           label: "Producer",           desc: "Runs sessions; signs split sheets" },
  { value: "intern",             label: "Intern",             desc: "Read-only across the board" },
  { value: "accountant",         label: "Accountant",         desc: "Invoices, payments, refunds - no creative" },
] as const;

type Props = {
  layer: "agency" | "studio";
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
};

export function RolePicker({ layer, value, onChange, disabled }: Props) {
  const roles = layer === "agency" ? AGENCY_ROLES : STUDIO_ROLES;
  return (
    <div className="space-y-1">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
      >
        {roles.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
      <p className="text-xs text-white/60">
        {roles.find((r) => r.value === value)?.desc ?? ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/components/access/RolePicker.tsx
git commit -m "feat(ui): RolePicker for 4 agency + 8 studio roles"
```

## Task 8: ScopePicker + CapabilityOverrides

**Files:**
- Create: `src/components/access/ScopePicker.tsx`
- Create: `src/components/access/CapabilityOverrides.tsx`

- [ ] **Step 1: Write ScopePicker**

Create `src/components/access/ScopePicker.tsx`:

```tsx
"use client";

import * as React from "react";

type Sub = { orgId: string; name: string };

type Props = {
  subaccounts: Sub[];
  selected: string[];
  onChange: (orgIds: string[]) => void;
};

export function ScopePicker({ subaccounts, selected, onChange }: Props) {
  function toggle(orgId: string) {
    onChange(selected.includes(orgId)
      ? selected.filter((o) => o !== orgId)
      : [...selected, orgId]);
  }
  return (
    <div className="space-y-1 rounded border border-white/15 bg-black/30 p-3">
      <p className="text-xs text-white/60">
        Select which sub-accounts this staff member can reach.
      </p>
      <ul className="space-y-1">
        {subaccounts.map((s) => (
          <li key={s.orgId}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(s.orgId)}
                onChange={() => toggle(s.orgId)}
              />
              <span>{s.name}</span>
              <span className="text-xs text-white/40">{s.orgId}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-white/40">
        {selected.length} of {subaccounts.length} selected
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write CapabilityOverrides**

Create `src/components/access/CapabilityOverrides.tsx`:

```tsx
"use client";

import * as React from "react";

type Props = {
  overrides: string[];
  onChange: (next: string[]) => void;
};

/**
 * Override tokens are "+cap" or "-cap" strings; the engine applies them
 * on top of the role default. UI is a simple textarea - power-user.
 */
export function CapabilityOverrides({ overrides, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(overrides.join("\n"));
  React.useEffect(() => {
    setText(overrides.join("\n"));
  }, [overrides]);
  function commit() {
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    onChange(lines);
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-white/60 underline underline-offset-2"
      >
        Customize permissions ({overrides.length} overrides)
      </button>
    );
  }
  return (
    <div className="space-y-1 rounded border border-white/15 bg-black/30 p-3">
      <p className="text-xs text-white/60">
        One token per line. Use <code>+cap.name</code> to add or <code>-cap.name</code> to remove.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={4}
        className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-xs"
        placeholder="+finance.read&#10;-deliverables.approve"
      />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-white/40 underline underline-offset-2"
      >
        Collapse
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/components/access/
git commit -m "feat(ui): ScopePicker + CapabilityOverrides components"
```

## Task 9: CapGuard server component

**Files:**
- Create: `src/components/access/CapGuard.tsx`

- [ ] **Step 1: Write the file**

```tsx
import * as React from "react";

/**
 * Client-side cap guard. Hides children when the viewer's capability
 * set doesn't include `cap`. Server-side gating still lives in Convex.
 */
type Props = {
  viewerCapabilities: Set<string> | string[];
  cap: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

export function CapGuard({ viewerCapabilities, cap, fallback = null, children }: Props) {
  const set = viewerCapabilities instanceof Set ? viewerCapabilities : new Set(viewerCapabilities);
  if (set.has(cap) || set.has(cap + ".own")) return <>{children}</>;
  return <>{fallback}</>;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/components/access/CapGuard.tsx
git commit -m "feat(ui): CapGuard client component for hiding UI by capability"
```

## Phase D - Agency console pages (Tasks 10-12)

## Task 10: /agency/staff page

**Files:**
- Create: `src/app/(agency)/agency/staff/page.tsx`

- [ ] **Step 1: Read existing agency/page.tsx to learn the layout pattern**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
ls src/app/agency 2>/dev/null || ls "src/app/(agency)/agency"
```

(Pick whichever path actually exists - Next 16 may use grouped routes.)

- [ ] **Step 2: Write the page**

Create the page at the matching path (adapt directory grouping to whatever Next 16 uses in this repo):

```tsx
"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { RolePicker } from "@/components/access/RolePicker";
import { CapabilityOverrides } from "@/components/access/CapabilityOverrides";

export default function StaffPage() {
  const members = useQuery(api.agencyStaff.list, {});
  const invite = useMutation(api.agencyStaff.invite);
  const setRole = useMutation(api.agencyStaff.setRole);
  const remove = useMutation(api.agencyStaff.remove);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole_] = React.useState("staff");

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !email) return;
    await invite({ name, email, role: role as "owner" | "admin" | "staff" | "billing" });
    setName(""); setEmail("");
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Agency staff</h1>
        <p className="text-sm text-white/60">
          Invite teammates, set their role, and scope them to specific sub-accounts.
        </p>
      </header>

      <form onSubmit={onInvite} className="space-y-3 rounded-lg border border-white/15 p-4">
        <h2 className="text-lg font-medium">Invite a staff member</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
          />
          <input
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com" type="email"
            className="rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
          />
          <RolePicker layer="agency" value={role} onChange={setRole_} />
        </div>
        <button type="submit" className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-black">
          Send invite
        </button>
      </form>

      <section className="rounded-lg border border-white/15">
        <h2 className="border-b border-white/15 p-4 text-lg font-medium">All members</h2>
        <ul className="divide-y divide-white/10">
          {(members ?? []).map((m) => (
            <li key={m._id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-4">
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-white/50">{m.email}</p>
              </div>
              <div className="min-w-[180px]">
                <RolePicker
                  layer="agency" value={m.role}
                  onChange={(v) => setRole({
                    memberId: m._id,
                    role: v as "owner" | "admin" | "staff" | "billing",
                  })}
                  disabled={m.role === "owner"}
                />
              </div>
              <button
                onClick={() => remove({ memberId: m._id })}
                disabled={m.role === "owner"}
                className="text-xs text-red-400 disabled:opacity-30"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Verify it loads - typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/app
git commit -m "feat(ui): /agency/staff page - invite + list + role + remove"
```

## Task 11: /agency/branding page

**Files:**
- Create: agency/branding/page.tsx (matching the route pattern of /agency/staff)

- [ ] **Step 1: Write the page**

```tsx
"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

export default function BrandingPage() {
  const update = useMutation(api.branding.updateAgencyBranding);
  const [accent, setAccent] = React.useState("#fdb913");
  const [appName, setAppName] = React.useState("");
  const [customDomain, setCustomDomain] = React.useState("");
  const [msg, setMsg] = React.useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await update({ accentColor: accent, appName, customDomain });
      setMsg("Saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Agency branding</h1>
        <p className="text-sm text-white/60">
          Logo, accent, and (on Agency tier) your own custom domain.
        </p>
      </header>
      <form onSubmit={save} className="max-w-lg space-y-4 rounded-lg border border-white/15 p-4">
        <label className="block space-y-1">
          <span className="text-sm">Accent color</span>
          <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">App name (shown in nav)</span>
          <input
            value={appName} onChange={(e) => setAppName(e.target.value)}
            placeholder="Pulse, AcmeOS, …"
            className="w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">Custom domain (Agency tier)</span>
          <input
            value={customDomain} onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="app.acme.com"
            className="w-full rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="rounded bg-amber-400 px-4 py-2 text-sm font-medium text-black">
          Save
        </button>
        {msg && <p className="text-xs text-white/60">{msg}</p>}
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/app
git commit -m "feat(ui): /agency/branding page - accent + app name + custom domain"
```

## Task 12: /agency/audit page

**Files:**
- Create: agency/audit/page.tsx

- [ ] **Step 1: Write the page**

```tsx
"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export default function AuditPage() {
  const [resultFilter, setResultFilter] = React.useState<"" | "allow" | "deny">("");
  const [actionFilter, setActionFilter] = React.useState("");
  const rows = useQuery(api.audit.list, {
    limit: 200,
    actionFilter: actionFilter || undefined,
    resultFilter: resultFilter || undefined,
  });

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-white/60">
          Every sensitive action across your sub-accounts.
        </p>
      </header>
      <div className="flex gap-3">
        <input
          value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
          placeholder="action prefix (e.g. members.)"
          className="rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
        />
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as "" | "allow" | "deny")}
          className="rounded border border-white/15 bg-black/40 px-3 py-2 text-sm"
        >
          <option value="">All results</option>
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-white/50">
            <th className="p-2">When</th>
            <th className="p-2">Viewer</th>
            <th className="p-2">Action</th>
            <th className="p-2">Org</th>
            <th className="p-2">Result</th>
            <th className="p-2">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {(rows ?? []).map((r) => (
            <tr key={r._id}>
              <td className="p-2 text-xs text-white/60">
                {new Date(r._creationTime).toLocaleString()}
              </td>
              <td className="p-2 text-xs">{r.viewerId}</td>
              <td className="p-2 font-mono text-xs">{r.action}</td>
              <td className="p-2 text-xs text-white/50">{r.orgId ?? "-"}</td>
              <td className="p-2 text-xs">
                <span className={r.result === "allow" ? "text-emerald-400" : "text-red-400"}>
                  {r.result}
                </span>
              </td>
              <td className="p-2 text-xs text-white/50">{r.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/app
git commit -m "feat(ui): /agency/audit page - filterable audit log table"
```

## Phase E - Studio members surface (Task 13)

## Task 13: Expand /settings/members

**Files:**
- Modify: existing studio members page (path discovered at task time)

- [ ] **Step 1: Find the existing members page**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
find src/app -path '*members*' -type d
```

- [ ] **Step 2: Adapt the existing dialog to use RolePicker + CapabilityOverrides**

Inside the members component, replace the existing role select with `<RolePicker layer="studio" value={role} onChange={setRole} />` and add `<CapabilityOverrides overrides={overrides} onChange={setOverrides} />` below.

The submit handler should call `api.members.invite` or `api.members.updateRole` with the role + overrides args.

- [ ] **Step 3: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/app src/components
git commit -m "feat(ui): /settings/members uses RolePicker + CapabilityOverrides

Studio members now pick from 8 roles. Power users can customize
permissions with +cap / -cap tokens."
```

## Phase F - Final smoke (Task 14)

## Task 14: Full smoke check

- [ ] **Step 1: Run the full quality bar**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
rm -f tsconfig.tsbuildinfo
npm run typecheck && npm test && npm run build
```

Expected: typecheck clean, all tests green (≥ 47 tests across ≥ 7 files), build succeeds.

- [ ] **Step 2: Tag the cycle**

```bash
git tag agency-mode-surfaces-complete
git log --oneline -25
```

---

## Out of scope for cycle 2 (deferred to cycle 3)

- Stripe Checkout + webhook handlers
- /onboard flow + plan upgrade
- HTTP action for magic-link token exchange (`/g/[token]` works only after this lands)
- Artist portal (`/portal/[token]`)
- Demo persona switcher extension to browse agency + guest viewers

These are functionally lighter than the cycle 1 + 2 work and form a coherent third cycle.

## Verification gates per "test every mode"

After Task 14:

1. **Agency Owner** can invite, role-edit, and remove agency staff - covered by `agencyStaff.test.ts`.
2. **Agency Staff** can be scoped to a subset of sub-accounts - covered by `agencyStaff.test.ts` (`setScopes` + the Cycle-1 scope test).
3. **Studio Owner** can invite + role-edit studio members across 8 roles - covered by member-related tests.
4. **Studio Intern** is blocked from branding edits - covered by `branding.test.ts`.
5. **Plan-tier gates** (custom domain requires Agency) - covered by `branding.test.ts`.
6. **Audit log** rolls up by agency - covered by Cycle-1 `access-audit.test.ts` + the `/agency/audit` UI exercises the same query.

All six verifiable via `npm test`.
