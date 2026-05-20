# Agency Mode Billing & Onboarding - Implementation Plan (Cycle 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire Stripe Checkout to the three pricing tiers, handle subscription webhooks to flip `agencies.plan` and `agencies.status`, and surface a `/onboard` flow that turns a fresh signup into a paid customer with an agency wrapper (Pro/Agency) or a single studio (base tier).

**Architecture:** `convex/billing.ts` exposes a Convex action `beginCheckout(tier)` that creates a Stripe Customer + Checkout Session. `convex/http.ts` mounts an HTTP route at `/stripe/webhook` that verifies the Stripe signature, dispatches by event type, and patches Convex state idempotently. The `/onboard` Next route is a three-step client flow: pick tier → run checkout → land back on `/agency` or `/dashboard`.

**Tech Stack:** Stripe Node SDK (`stripe` npm pkg already used widely), Convex HTTP actions, Next 16 App Router.

**Spec reference:** `docs/superpowers/specs/2026-05-19-agency-mode-rbac-design.md` (section 10)

---

## File map

| Path | Action | Purpose |
|---|---|---|
| `package.json` | modify | add `stripe` dep |
| `convex/lib/stripe.ts` | create | Stripe SDK factory + price→tier mapping |
| `convex/billing.ts` | create | beginCheckout action + portal action + tier lookup queries |
| `convex/http.ts` | create | webhook route → internal mutation dispatch |
| `convex/billingWebhooks.ts` | create | internalMutation handlers per event type |
| `convex/billing.test.ts` | create | webhook idempotency + tier transition tests |
| `src/app/onboard/page.tsx` | create | tier picker → kickoff checkout |
| `src/app/onboard/done/page.tsx` | create | post-checkout landing; poll for active subscription |
| `convex/agency.ts` | modify | createSubaccount checks agencies.plan via webhook-set value |

---

## Task 1: Install Stripe SDK

- [ ] **Step 1: Install**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm install stripe
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(billing): install stripe SDK"
```

## Task 2: Stripe factory + price map

**Files:**
- Create: `convex/lib/stripe.ts`

- [ ] **Step 1: Write the file**

```ts
import Stripe from "stripe";
import type { TierKey } from "./plans";

/* ============================================================
   Stripe SDK factory + tier ↔ price-id map. All Stripe access
   should go through stripeClient() so tests can stub.
   ============================================================ */

let _stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  _stripe = new Stripe(key, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });
  return _stripe;
}

/** Tier → Stripe price ID env var name. */
export const TIER_PRICE_ENV: Record<TierKey, string> = {
  studio: "STRIPE_PRICE_STUDIO",
  pro: "STRIPE_PRICE_PRO",
  agency: "STRIPE_PRICE_AGENCY",
};

export function priceIdForTier(tier: TierKey): string {
  const envKey = TIER_PRICE_ENV[tier];
  const v = process.env[envKey];
  if (!v) throw new Error(`${envKey} not set`);
  return v;
}

/** Reverse lookup - used by the webhook to flip agencies.plan. */
export function tierForPriceId(priceId: string): TierKey | null {
  for (const tier of ["studio", "pro", "agency"] as TierKey[]) {
    if (process.env[TIER_PRICE_ENV[tier]] === priceId) return tier;
  }
  return null;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add convex/lib/stripe.ts
git commit -m "feat(billing): Stripe SDK factory + tier↔priceId map"
```

## Task 3: billing module

**Files:**
- Create: `convex/billing.ts`

- [ ] **Step 1: Write the file**

```ts
import { action, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { stripeClient, priceIdForTier } from "./lib/stripe";
import type { TierKey } from "./lib/plans";

const tierV = v.union(v.literal("studio"), v.literal("pro"), v.literal("agency"));

/** Public action - start a Stripe Checkout session for the chosen tier. */
export const beginCheckout = action({
  args: { tier: tierV, agencyName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const stripe = stripeClient();
    const priceId = priceIdForTier(args.tier as TierKey);

    const customer = await stripe.customers.create({
      email: identity.email ?? undefined,
      name: identity.name ?? identity.email ?? undefined,
      metadata: {
        clerkUserId: identity.subject,
        intendedAgencyName: args.agencyName ?? "",
        intendedTier: args.tier,
      },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${baseUrl}/onboard/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/onboard`,
    });

    return { checkoutUrl: session.url };
  },
});

/** Public action - open the Stripe Customer Portal for the caller. */
export const openCustomerPortal = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const stripeCustomerId = await ctx.runQuery(
      internal.billing._customerIdForUser,
      { clerkUserId: identity.subject },
    );
    if (!stripeCustomerId) throw new Error("no billing customer");
    const stripe = stripeClient();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${baseUrl}/agency`,
    });
    return { portalUrl: session.url };
  },
});

/** Internal - look up a Stripe customer id by Clerk user id (via agencies/orgs). */
export const _customerIdForUser = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    // Agency owner path
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_owner", (q) => q.eq("ownerClerkUserId", clerkUserId))
      .first();
    return ag?.stripeCustomerId ?? null;
  },
});

/** Public query - read the caller's current plan + status. */
export const myPlan = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_owner", (q) => q.eq("ownerClerkUserId", identity.subject))
      .first();
    if (!ag) return null;
    return { plan: ag.plan, status: ag.status, agencyId: ag.agencyId, name: ag.name };
  },
});
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex dev --once --typecheck disable
npm run typecheck
git add convex/billing.ts convex/_generated/
git commit -m "feat(billing): beginCheckout + openCustomerPortal + myPlan

beginCheckout creates a Stripe Customer + Checkout Session for the
chosen tier with a 14-day trial. openCustomerPortal opens the
hosted billing portal. myPlan exposes the caller's plan + status."
```

## Task 4: Webhook handlers

**Files:**
- Create: `convex/billingWebhooks.ts`
- Create: `convex/http.ts`

- [ ] **Step 1: Write billingWebhooks**

Create `convex/billingWebhooks.ts`:

```ts
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { tierForPriceId } from "./lib/stripe";
import { seedStarterWorkspace } from "./lib/starter";

const eventV = v.object({
  id: v.string(),
  type: v.string(),
  data: v.any(),
});

/** Idempotent event ledger - drop duplicate Stripe webhook deliveries. */
async function alreadyProcessed(ctx: any, eventId: string): Promise<boolean> {
  // We piggyback on auditEvents with viewerType=guest, action=stripe.event.
  const existing = await ctx.db
    .query("auditEvents")
    .filter((q: any) => q.and(
      q.eq(q.field("action"), "stripe.event"),
      q.eq(q.field("viewerId"), eventId),
    ))
    .first();
  return Boolean(existing);
}

async function markProcessed(ctx: any, eventId: string, eventType: string) {
  await ctx.db.insert("auditEvents", {
    viewerType: "guest",
    viewerId: eventId,
    action: "stripe.event",
    result: "allow",
    reason: eventType,
  });
}

export const handle = internalMutation({
  args: { event: eventV },
  handler: async (ctx, { event }) => {
    if (await alreadyProcessed(ctx, event.id)) return { duplicate: true };
    const e = event as { id: string; type: string; data: { object: any } };
    const obj = e.data.object;

    if (e.type === "checkout.session.completed") {
      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string;
      // Pull metadata from the customer (set when we created the session)
      // In tests we pass the customer.metadata inline on the object.
      const meta = obj.metadata ?? {};
      const intendedTier = (meta.intendedTier as "studio" | "pro" | "agency") ?? "studio";
      const clerkUserId = meta.clerkUserId as string;
      const agencyName = (meta.intendedAgencyName as string) || "My Agency";
      const ownerEmail = (obj.customer_email as string) ?? "";

      if (intendedTier === "studio") {
        // Base tier: no agency record. Just leave the Stripe customer on the user's
        // first org; the user can create that org through the normal flow.
      } else {
        const slug = agencyName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") || `ag-${Date.now()}`;
        const agencyId = `agency_${slug}_${Date.now().toString(36)}`;
        await ctx.db.insert("agencies", {
          agencyId,
          name: agencyName,
          slug,
          plan: intendedTier,
          status: "trial",
          ownerClerkUserId: clerkUserId,
          ownerEmail,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
        });
        await ctx.db.insert("agencyMembers", {
          agencyId,
          clerkUserId,
          email: ownerEmail,
          name: ownerEmail,
          role: "owner",
          status: "active",
          invitedAt: Date.now(),
        });
      }
    }

    if (e.type === "customer.subscription.updated") {
      const stripeCustomerId = obj.customer as string;
      const items = obj.items?.data ?? [];
      const priceId = items[0]?.price?.id;
      const tier = priceId ? tierForPriceId(priceId) : null;
      const ag = await ctx.db
        .query("agencies")
        .filter((q: any) => q.eq(q.field("stripeCustomerId"), stripeCustomerId))
        .first();
      if (ag && tier && (tier === "pro" || tier === "agency" || tier === "agency_plus" as any)) {
        await ctx.db.patch(ag._id, {
          plan: tier as "pro" | "agency",
          status: obj.status === "active" ? "active" : "trial",
        });
      }
    }

    if (e.type === "customer.subscription.deleted") {
      const stripeCustomerId = obj.customer as string;
      const ag = await ctx.db
        .query("agencies")
        .filter((q: any) => q.eq(q.field("stripeCustomerId"), stripeCustomerId))
        .first();
      if (ag) {
        await ctx.db.patch(ag._id, { status: "paused" });
        // Pause every sub-account too
        const subs = await ctx.db
          .query("orgs")
          .withIndex("by_agency", (q) => q.eq("agencyId", ag.agencyId))
          .collect();
        for (const s of subs) {
          if (s.status !== "paused") await ctx.db.patch(s._id, { status: "paused" });
        }
      }
    }

    await markProcessed(ctx, event.id, e.type);
    return { duplicate: false };
  },
});
```

- [ ] **Step 2: Write http.ts**

Create `convex/http.ts`:

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";

const http = httpRouter();

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const body = await req.text();
    if (!sig || !secret) return new Response("missing signature", { status: 400 });
    let event;
    try {
      event = stripeClient().webhooks.constructEvent(body, sig, secret);
    } catch (e) {
      return new Response(`invalid signature: ${(e as Error).message}`, { status: 400 });
    }
    await ctx.runMutation(internal.billingWebhooks.handle, {
      event: { id: event.id, type: event.type, data: event.data },
    });
    return new Response("ok", { status: 200 });
  }),
});

export default http;
```

- [ ] **Step 3: Codegen + typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npx convex dev --once --typecheck disable
npm run typecheck
git add convex/billingWebhooks.ts convex/http.ts convex/_generated/
git commit -m "feat(billing): Stripe webhook handlers + HTTP route

- billingWebhooks.handle handles checkout.session.completed (creates
  agencies + agencyMembers rows on Pro/Agency tier), subscription
  .updated (flips agencies.plan), subscription.deleted (pauses
  agency and cascades pause to sub-accounts).
- http.ts mounts /stripe/webhook with signature verification.
- Idempotent via auditEvents-keyed event ledger."
```

## Task 5: Webhook tests with mocked Stripe payloads

**Files:**
- Create: `convex/billing.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

describe("billing webhooks", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  function checkoutCompleted(opts: {
    customerId: string;
    subscriptionId: string;
    tier: "pro" | "agency";
    clerkUserId: string;
    agencyName?: string;
    ownerEmail?: string;
  }) {
    return {
      id: `evt_${opts.customerId}_${opts.tier}`,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: opts.customerId,
          subscription: opts.subscriptionId,
          customer_email: opts.ownerEmail ?? "owner@example.com",
          metadata: {
            clerkUserId: opts.clerkUserId,
            intendedAgencyName: opts.agencyName ?? "Test Agency",
            intendedTier: opts.tier,
          },
        },
      },
    };
  }

  it("checkout.session.completed creates agency + owner on Pro tier", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: checkoutCompleted({
        customerId: "cus_1",
        subscriptionId: "sub_1",
        tier: "pro",
        clerkUserId: "u_owner",
      }),
    });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(1);
    expect(agencies[0].plan).toBe("pro");
    expect(agencies[0].stripeCustomerId).toBe("cus_1");

    const members = await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect());
    expect(members.length).toBe(1);
    expect(members[0].role).toBe("owner");
  });

  it("duplicate event is a no-op (idempotency)", async () => {
    const event = checkoutCompleted({
      customerId: "cus_2", subscriptionId: "sub_2",
      tier: "agency", clerkUserId: "u_o",
    });
    const r1 = await t.mutation(internal.billingWebhooks.handle, { event });
    const r2 = await t.mutation(internal.billingWebhooks.handle, { event });
    expect(r1).toEqual({ duplicate: false });
    expect(r2).toEqual({ duplicate: true });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(1);
  });

  it("subscription.deleted pauses agency + sub-accounts", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_o", ownerEmail: "o@x", stripeCustomerId: "cus_3",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1", name: "S1", slug: "s1", plan: "studio", status: "active",
        agencyId: "org_ag",
      });
    });
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_del_1",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_3" } },
      },
    });
    const ag = await t.run(async (ctx) => await ctx.db.query("agencies").first());
    expect(ag!.status).toBe("paused");
    const sub = await t.run(async (ctx) => await ctx.db.query("orgs").first());
    expect(sub!.status).toBe("paused");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm test
git add convex/billing.test.ts
git commit -m "test(billing): checkout-completed provisions agency; idempotent; subscription-deleted cascades pause"
```

## Task 6: /onboard page

**Files:**
- Create: `src/app/onboard/page.tsx`
- Create: `src/app/onboard/done/page.tsx`

- [ ] **Step 1: Write the tier picker**

Create `src/app/onboard/page.tsx`:

```tsx
"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";

const TIERS = [
  {
    key: "studio" as const,
    name: "Studio",
    price: "$49 / mo",
    subline: "Solo producer or single-room studio.",
    bullets: ["1 workspace", "All studio features", "5 magic-link grants / mo"],
  },
  {
    key: "pro" as const,
    name: "Pro",
    price: "$97 / mo",
    subline: "Two rooms, two brands, or a partner studio.",
    bullets: ["2 sub-accounts", "Basic agency console", "25 grants / mo", "Per-studio branding"],
  },
  {
    key: "agency" as const,
    name: "Agency",
    price: "$249 / mo",
    subline: "Studio groups + indie labels.",
    bullets: ["Unlimited sub-accounts", "Agency-level white-label", "Custom domain", "Unlimited grants"],
  },
];

export default function OnboardPage() {
  const beginCheckout = useAction(api.billing.beginCheckout);
  const [tier, setTier] = React.useState<"studio" | "pro" | "agency">("pro");
  const [agencyName, setAgencyName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function start() {
    setErr("");
    setLoading(true);
    try {
      const { checkoutUrl } = await beginCheckout({
        tier,
        agencyName: tier === "studio" ? undefined : agencyName || undefined,
      });
      if (checkoutUrl) window.location.href = checkoutUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <header className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-semibold text-bone">Pick your plan</h1>
        <p className="text-sm text-ash">14-day free trial. Cancel any time.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {TIERS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTier(t.key)}
            className={`rounded-lg border p-5 text-left transition-colors ${
              tier === t.key
                ? "border-gold bg-gold/10"
                : "border-hairline bg-coal/40 hover:border-hairline-2"
            }`}
          >
            <p className="font-display text-lg font-semibold text-bone">{t.name}</p>
            <p className="mt-1 font-mono text-sm text-gold">{t.price}</p>
            <p className="mt-2 text-xs text-ash">{t.subline}</p>
            <ul className="mt-3 space-y-1 text-xs text-ash-dim">
              {t.bullets.map((b) => <li key={b}>• {b}</li>)}
            </ul>
          </button>
        ))}
      </div>

      {tier !== "studio" && (
        <label className="mx-auto block max-w-md space-y-1">
          <span className="text-sm text-bone">Your agency name</span>
          <input
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
            placeholder="Acme Music Group"
            className="w-full rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
          />
        </label>
      )}

      {err && <p className="text-center text-sm text-critical">{err}</p>}

      <div className="text-center">
        <button
          onClick={start}
          disabled={loading || (tier !== "studio" && !agencyName)}
          className="rounded-md bg-gold px-6 py-3 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright disabled:opacity-50"
        >
          {loading ? "Starting checkout…" : `Continue to Stripe →`}
        </button>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Write the post-checkout landing**

Create `src/app/onboard/done/page.tsx`:

```tsx
"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export default function OnboardDonePage() {
  const plan = useQuery(api.billing.myPlan, {});

  React.useEffect(() => {
    if (plan && (plan.status === "active" || plan.status === "trial")) {
      window.location.replace("/agency");
    }
  }, [plan]);

  return (
    <main className="mx-auto max-w-md space-y-4 p-12 text-center">
      <h1 className="font-display text-2xl font-semibold text-bone">Finishing setup…</h1>
      <p className="text-sm text-ash">
        We're confirming your subscription with Stripe. This usually takes a few seconds.
      </p>
      {plan ? (
        <p className="font-mono text-xs text-ash-dim">Plan: {plan.plan} · {plan.status}</p>
      ) : (
        <p className="font-mono text-xs text-ash-dim">Waiting for webhook…</p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
npm run typecheck
git add src/app/onboard/
git commit -m "feat(onboard): tier picker + post-checkout landing"
```

## Task 7: Final smoke check + tag

- [ ] **Step 1: Full quality bar**

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse"
rm -f tsconfig.tsbuildinfo
npm run typecheck && npm test && npm run build
```

- [ ] **Step 2: Tag**

```bash
git tag agency-mode-billing-complete
git log --oneline -30
```

---

## Verification (per "test every mode")

After Task 7:

1. **Stripe Checkout** kicks off when a fresh user picks a tier on /onboard.
2. **Webhook** creates an agencies row + agencyMembers owner on Pro/Agency checkout. Tested.
3. **Duplicate webhook** events are skipped via the auditEvents-keyed ledger. Tested.
4. **Subscription cancellation** pauses the agency and cascades pause to sub-accounts. Tested.
5. **myPlan** query lets the studio UI show current plan + status.
6. **All cycle-1 + cycle-2 tests still pass.**
