# Studio Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studios connect their own social accounts inside Pulse, schedule posts through the GHL Social Planner API, attach time-boxed promo codes, and see bookings per post.

**Architecture:** Three new Convex tables (`socialAccounts`, `promos`, `socialPosts`) plus a per-org GHL client (`convex/lib/ghl.ts`). Convex actions call GHL to start OAuth, attach accounts and create scheduled posts; a cron polls GHL for status. Checkout resolves a Promo before a legacy discount code. AI drafts ride the existing `opsActions` approval inbox with a new `social_post` payload kind. The Next.js app gets a `/marketing` route group (calendar, composer, accounts, promos, results) and a brand-card image route.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` first), Convex, convex-test + vitest (`npm test`), Clerk, lucide-react icons (existing nav convention), `next/og` ImageResponse (satori), GHL LeadConnector API v2.

**Spec:** `docs/superpowers/specs/2026-08-26-studio-marketing-design.md`. Alignment: `../../Grilled.md`. Glossary: `CONTEXT.md`.

## Global Constraints

- No em dashes in any copy, code comment, or test string (`stripEmDashes` exists in `convex/lib/text.ts`; the AI layer already enforces it).
- Every GHL call is scoped to the org's own `socialAccounts` rows. A post may never carry another org's `ghlAccountId`. This is a tested invariant (Task 7).
- The GHL Private Integration Token never leaves Convex. Env names: `GHL_API_KEY`, `GHL_LOCATION_ID` (existing), `GHL_SOCIAL_USER_ID` (new).
- GHL requests always send `Version` and `User-Agent: Pulse/1.0 (+https://pulse.myindsound.com)` headers (GHL's Cloudflare rejects default agents).
- Missing GHL env = simulated mode, never a crash (same convention as `convex/lib/sms.ts`).
- AI drafts are always `status: "draft"`. There is no auto-publish path.
- Studio tier caps: 3 connected accounts, 20 scheduled posts per month. Pro, growth, agency: unlimited.
- Attribution: tracked link (`?src=<postId>`) or the post's promo code, within 7 days of `publishedAt`; `postId` wins over `code`.
- Run `npm test` and `npm run typecheck` before every commit. Commit messages: imperative, no em dashes.
- Untitled UI components where a new control is needed; icons via lucide-react to match `src/lib/nav.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `convex/schema.ts` | Add `socialAccounts`, `promos`, `socialPosts`; add `orgs.ghl`, `bookingVisits.postId`, `artists.okToFeature`; add `opsActions` type + payload |
| `convex/lib/ghl.ts` (new) | Per-org GHL context + fetch wrapper + typed Social Planner calls |
| `convex/lib/ghl.test.ts` (new) | Client tests with mocked fetch |
| `convex/lib/accessPolicies.ts`, `convex/lib/entitlements.ts`, `convex/lib/modules.ts`, `convex/lib/plans.ts`, `convex/usage.ts` | Capabilities, entitlement, module, caps, metering |
| `convex/promos.ts` (new) + `convex/promos.test.ts` | Promo CRUD + `resolveCode` |
| `convex/booking.ts` | Checkout honours Promo then legacy code; `src` attribution |
| `convex/bookingFunnel.ts` | `postId` on visits |
| `convex/marketing/accounts.ts` (new) | Connect / attach / list / remove accounts |
| `convex/marketing/posts.ts` (new) | Post lifecycle, GHL scheduling, status sync |
| `convex/marketing/rules.ts` (new) | Per-platform validation (pure) |
| `convex/marketing/results.ts` (new) | Attribution query |
| `convex/marketing/*.test.ts` | Tests per module |
| `convex/opsActions.ts`, `convex/aiActions.ts` | `social_post` payload; rate-cut drafts |
| `convex/crons.ts` | `social-status-sync`, `social-stats` |
| `src/app/api/brand-card/[postId]/route.tsx` (new) | Brand Card PNG |
| `src/lib/nav.ts`, `src/lib/features.ts`, `src/app/(app)/inbox/page.tsx` | Nav, route gate, inbox label |
| `src/app/(app)/marketing/**` (new), `src/components/social/**` (new) | UI |
| `src/app/book/[slug]/[roomId]/page.tsx`, `src/lib/use-booking-funnel.ts` | `src` param passthrough |

---

### Task 1: Schema, capabilities, entitlements, plan caps

**Files:**
- Modify: `convex/schema.ts` (orgs block near line 370; `bookingVisits` near 2206; `artists` near 937; `opsActions` near 1950; new tables after `waitlistEntries`)
- Modify: `convex/lib/accessPolicies.ts:98-200` (role lists)
- Modify: `convex/lib/entitlements.ts:210-241`
- Modify: `convex/lib/modules.ts` (MODULES array, `CapabilityKey` union)
- Modify: `convex/lib/plans.ts` (TierLimits, each tier, STUDIO_CAPS)
- Modify: `convex/usage.ts:110-123`
- Test: `convex/lib/accessPolicies.test.ts`, `convex/lib/marketingEntitlement.test.ts` (new)

**Interfaces:**
- Produces: capabilities `"marketing.read"`, `"marketing.edit"`, `"marketing.approve"`; entitlement key `"marketing"`; usage metrics `"social_accounts"` and `"social_posts"`; tables `socialAccounts`, `promos`, `socialPosts`; `opsActions.type` `"social_post_draft"`; `opsActions.payload` `{ kind: "social_post", postId: Id<"socialPosts"> }`.

- [ ] **Step 1: Write the failing capability tests**

Append to `convex/lib/accessPolicies.test.ts`:

```ts
describe("marketing capabilities", () => {
  it("owner and manager can approve posts", () => {
    expect(STUDIO_ROLE_CAPABILITIES.owner).toContain("marketing.approve");
    expect(STUDIO_ROLE_CAPABILITIES.manager).toContain("marketing.approve");
  });
  it("engineer can submit but not approve", () => {
    expect(STUDIO_ROLE_CAPABILITIES.engineer).toContain("marketing.edit");
    expect(STUDIO_ROLE_CAPABILITIES.engineer).not.toContain("marketing.approve");
  });
  it("intern can read only", () => {
    expect(STUDIO_ROLE_CAPABILITIES.intern).toContain("marketing.read");
    expect(STUDIO_ROLE_CAPABILITIES.intern).not.toContain("marketing.edit");
  });
});
```

Create `convex/lib/marketingEntitlement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entitlementForCapability, capabilitiesForTier } from "./entitlements";
import { PLAN_LIMITS } from "./plans";

describe("marketing entitlement", () => {
  it("maps every marketing capability to the marketing module", () => {
    expect(entitlementForCapability("marketing.read")).toBe("marketing");
    expect(entitlementForCapability("marketing.edit")).toBe("marketing");
    expect(entitlementForCapability("marketing.approve")).toBe("marketing");
  });
  it("every paid tier has marketing, with caps only on studio", () => {
    expect(capabilitiesForTier("studio").has("marketing")).toBe(true);
    expect(capabilitiesForTier("pro").has("marketing")).toBe(true);
    expect(PLAN_LIMITS.studio.socialAccountCap).toBe(3);
    expect(PLAN_LIMITS.studio.socialPostsPerMonth).toBe(20);
    expect(PLAN_LIMITS.pro.socialAccountCap).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run convex/lib/accessPolicies.test.ts convex/lib/marketingEntitlement.test.ts`
Expected: FAIL (capabilities missing, `socialAccountCap` undefined).

- [ ] **Step 3: Add capabilities to roles**

In `convex/lib/accessPolicies.ts`, inside `STUDIO_ROLE_CAPABILITIES`:
- `owner` and `manager`: add `"marketing.read", "marketing.edit", "marketing.approve",` after `"activity.read",`.
- `engineer`, `assistant_engineer`, `producer`, `artist_relations`: add `"marketing.read", "marketing.edit",`.
- `intern`, `accountant`: add `"marketing.read",`.
- Agency `owner` and `admin` (the act-as-studio block): add `"marketing.read", "marketing.edit", "marketing.approve",`.

In `convex/lib/entitlements.ts` `ENTITLEMENT_FOR_CAPABILITY` add:

```ts
  "marketing.read": "marketing",
  "marketing.edit": "marketing",
  "marketing.approve": "marketing",
```

- [ ] **Step 4: Register the module and plan caps**

In `convex/lib/modules.ts`: add `"marketing"` to the `CapabilityKey` union, and in `MODULES` under the `// ── Communication ──` group:

```ts
  { key: "marketing", label: "Marketing", area: "comms", nav: true,
    blurb: "Scheduled social posts, promos and results" },
```

In `convex/lib/plans.ts` `TierLimits` add after `staffCap: number;`:

```ts
  /** Connected social accounts (Marketing). */
  socialAccountCap: number;
  /** Scheduled social posts per month (Marketing). */
  socialPostsPerMonth: number;
```

Set on every tier: the $0 flow tier and `studio`: `socialAccountCap: 3, socialPostsPerMonth: 20`; `pro`, `growth`, `agency`, and the custom tier: `socialAccountCap: UNLIMITED, socialPostsPerMonth: UNLIMITED`. Add `"marketing"` to `STUDIO_CAPS` (every higher bundle inherits it).

In `convex/usage.ts` `capForMetric` add:

```ts
    case "social_accounts":
      return limits.socialAccountCap;
    case "social_posts":
      return limits.socialPostsPerMonth;
```

- [ ] **Step 5: Schema additions**

In `convex/schema.ts`:

On `orgs`, after `defaultRateCutPct`:

```ts
    // Marketing: which GHL location this org publishes through. Absent means
    // the platform default (GHL_LOCATION_ID + GHL_API_KEY). tokenRef names an
    // env var; the token itself is never stored in the database.
    ghl: v.optional(v.object({ locationId: v.string(), tokenRef: v.string() })),
```

On `artists`, after `instagram`:

```ts
    // Marketing: the artist agreed to be named in the studio's posts.
    okToFeature: v.optional(v.boolean()),
```

On `bookingVisits`, after `utmSource`:

```ts
    postId: v.optional(v.id("socialPosts")),  // ?src=<postId> post attribution
```

On `opsActions.type` add `v.literal("social_post_draft"),` after `v.literal("studio_risk"),`. On `opsActions.payload` add a fourth branch:

```ts
      v.object({ kind: v.literal("social_post"), postId: v.id("socialPosts") }),
```

New tables after `waitlistEntries`:

```ts
  // ── Marketing: a studio's own social profiles, attached through GHL. ──
  socialAccounts: defineTable({
    orgId: v.string(),
    platform: v.union(
      v.literal("google"), v.literal("facebook"), v.literal("instagram"),
      v.literal("linkedin"), v.literal("tiktok"), v.literal("tiktok-business"),
      v.literal("youtube"), v.literal("pinterest"), v.literal("threads"), v.literal("bluesky"),
    ),
    ghlAccountId: v.string(),
    ghlLocationId: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    status: v.union(v.literal("connected"), v.literal("needs_reconnect"), v.literal("removed")),
    connectedBy: v.string(),
    connectedAt: v.number(),
    lastCheckedAt: v.optional(v.number()),
    stats: v.optional(v.object({
      followers: v.optional(v.number()),
      reach: v.optional(v.number()),
      refreshedAt: v.number(),
    })),
  })
    .index("by_org", ["orgId"])
    .index("by_ghl_account", ["ghlAccountId"]),

  // ── Marketing: time-boxed promo codes. Checkout resolves these before
  //    the legacy orgs.discountCodes list. ──
  promos: defineTable({
    orgId: v.string(),
    code: v.string(),
    pct: v.number(),
    label: v.optional(v.string()),
    startsAt: v.number(),
    endsAt: v.number(),
    roomId: v.optional(v.id("rooms")),
    maxRedemptions: v.optional(v.number()),
    redemptions: v.number(),
    source: v.union(v.literal("owner"), v.literal("rate_cut")),
    active: v.boolean(),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_code", ["orgId", "code"]),

  // ── Marketing: one scheduled post. Pulse is the source of truth; GHL
  //    holds and fires it. ──
  socialPosts: defineTable({
    orgId: v.string(),
    template: v.union(
      v.literal("session_bts"), v.literal("before_after"), v.literal("client_win"),
      v.literal("room_gear"), v.literal("tip"), v.literal("rate_promo"),
      v.literal("open_slot"), v.literal("engineer_story"), v.literal("custom"),
    ),
    status: v.union(
      v.literal("draft"), v.literal("approved"), v.literal("scheduled"),
      v.literal("published"), v.literal("failed"), v.literal("cancelled"),
    ),
    caption: v.string(),
    captionOverrides: v.optional(v.record(v.string(), v.string())),
    media: v.array(v.object({
      storageId: v.optional(v.id("_storage")),
      brandCard: v.optional(v.union(v.literal("rate_card"), v.literal("open_slot"), v.literal("promo"))),
      type: v.union(v.literal("image"), v.literal("video")),
    })),
    accountIds: v.array(v.id("socialAccounts")),
    scheduledFor: v.number(),
    timezone: v.string(),
    promoId: v.optional(v.id("promos")),
    link: v.optional(v.string()),
    artistId: v.optional(v.id("artists")),
    roomId: v.optional(v.id("rooms")),
    sourceActionId: v.optional(v.id("opsActions")),
    ghlPostId: v.optional(v.string()),
    ghlType: v.union(v.literal("post"), v.literal("story"), v.literal("reel")),
    submittedBy: v.string(),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    failure: v.optional(v.string()),
    stats: v.optional(v.object({
      impressions: v.optional(v.number()),
      engagements: v.optional(v.number()),
      refreshedAt: v.number(),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_scheduled", ["orgId", "scheduledFor"])
    .index("by_ghl_post", ["ghlPostId"]),
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run convex/lib && npm run typecheck`
Expected: PASS. If `opsActions` consumers fail typecheck on the new payload kind (`convex/opsActions.ts` `enrichmentContext`, `finalize`; `src/app/(app)/inbox/page.tsx`), the existing `payload.kind === "email"` guards already narrow; add nothing yet.

- [ ] **Step 7: Commit**

```bash
git add convex/schema.ts convex/lib/accessPolicies.ts convex/lib/accessPolicies.test.ts convex/lib/entitlements.ts convex/lib/marketingEntitlement.test.ts convex/lib/modules.ts convex/lib/plans.ts convex/usage.ts
git commit -m "Marketing module: schema, capabilities, entitlement and plan caps"
```

---

### Task 2: Per-org GHL client

**Files:**
- Create: `convex/lib/ghl.ts`
- Test: `convex/lib/ghl.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type GhlCtx = { locationId: string; token: string; userId: string };
  export type Platform = "google" | "facebook" | "instagram" | "linkedin" | "tiktok" | "tiktok-business" | "youtube" | "pinterest" | "threads" | "bluesky";
  export function ghlFromEnv(org: { ghl?: { locationId: string; tokenRef: string } } | null): GhlCtx | null;
  export async function ghlFetch<T>(g: GhlCtx, path: string, init?: { method?: string; body?: unknown; version?: string }): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }>;
  export async function startOAuth(g, platform: Platform, reconnect?: boolean): Promise<{ url: string } | null>;
  export async function listOAuthAccounts(g, platform, accountId): Promise<GhlChoice[]>;
  export async function attachOAuthAccount(g, platform, accountId, choice: { id: string; name: string; type?: string }): Promise<{ id: string; name: string; avatar?: string } | null>;
  export async function createScheduledPost(g, input: GhlPostInput): Promise<{ id: string } | { error: string }>;
  export async function deletePost(g, ghlPostId): Promise<boolean>;
  export async function listPosts(g, input: { accountIds: string[]; fromDate: string; toDate: string }): Promise<GhlPostSummary[]>;
  export async function accountStats(g, accountIds: string[]): Promise<Record<string, { followers?: number; reach?: number }>>;
  ```

- [ ] **Step 1: Write the failing tests**

`convex/lib/ghl.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ghlFromEnv, ghlFetch, startOAuth, createScheduledPost } from "./ghl";

describe("ghl client", () => {
  beforeEach(() => {
    vi.stubEnv("GHL_API_KEY", "pit_default");
    vi.stubEnv("GHL_LOCATION_ID", "loc_default");
    vi.stubEnv("GHL_SOCIAL_USER_ID", "user_pulse");
    vi.stubEnv("GHL_TOKEN_SLANG", "pit_slang");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("resolves the platform default when the org has no override", () => {
    expect(ghlFromEnv(null)).toEqual({ locationId: "loc_default", token: "pit_default", userId: "user_pulse" });
  });

  it("resolves a per-org location and token by env var name, never by value", () => {
    const g = ghlFromEnv({ ghl: { locationId: "loc_slang", tokenRef: "GHL_TOKEN_SLANG" } });
    expect(g).toEqual({ locationId: "loc_slang", token: "pit_slang", userId: "user_pulse" });
  });

  it("returns null (simulated mode) when the token env is missing", () => {
    vi.stubEnv("GHL_API_KEY", "");
    expect(ghlFromEnv(null)).toBeNull();
  });

  it("sends Authorization, Version and User-Agent on every call", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const g = ghlFromEnv(null)!;
    await ghlFetch(g, "/social-media-posting/loc_default/accounts", { version: "2021-07-28" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://services.leadconnectorhq.com/social-media-posting/loc_default/accounts");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer pit_default");
    expect(h.Version).toBe("2021-07-28");
    expect(h["User-Agent"]).toContain("Pulse/1.0");
  });

  it("startOAuth passes locationId and userId as query params", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: "https://oauth.example/x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await startOAuth(ghlFromEnv(null)!, "instagram");
    expect(res).toEqual({ url: "https://oauth.example/x" });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/social-media-posting/oauth/instagram/start?locationId=loc_default&userId=user_pulse");
  });

  it("createScheduledPost sends status scheduled and returns the GHL id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: { post: { _id: "post_1" } } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await createScheduledPost(ghlFromEnv(null)!, {
      accountIds: ["acc_1"], summary: "Open Thursday", media: [{ url: "https://x/y.png", type: "image/png" }],
      scheduleDate: "2026-09-01T18:00:00.000Z", type: "post",
    });
    expect(res).toEqual({ id: "post_1" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.status).toBe("scheduled");
    expect(body.accountIds).toEqual(["acc_1"]);
  });

  it("surfaces a GHL error message instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "Invalid JWT" }), { status: 401 })));
    const res = await createScheduledPost(ghlFromEnv(null)!, {
      accountIds: ["acc_1"], summary: "x", media: [], scheduleDate: "2026-09-01T18:00:00.000Z", type: "post",
    });
    expect(res).toEqual({ error: "Invalid JWT" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/lib/ghl.test.ts`
Expected: FAIL, module `./ghl` not found.

- [ ] **Step 3: Implement the client**

`convex/lib/ghl.ts`:

```ts
/* GHL (LeadConnector) client for the Social Planner. Resolved PER ORG so a
   studio can be moved to its own GHL sub-account by setting orgs.ghl; the
   default is the platform location Pulse already uses for SMS. Returns null
   when unconfigured so every caller degrades to simulated mode. */

export type GhlCtx = { locationId: string; token: string; userId: string };
export type Platform =
  | "google" | "facebook" | "instagram" | "linkedin" | "tiktok"
  | "tiktok-business" | "youtube" | "pinterest" | "threads" | "bluesky";

export const PLATFORMS: Platform[] = [
  "google", "facebook", "instagram", "linkedin", "tiktok",
  "tiktok-business", "youtube", "pinterest", "threads", "bluesky",
];

const BASE = "https://services.leadconnectorhq.com";
const UA = "Pulse/1.0 (+https://pulse.myindsound.com)";

export function ghlFromEnv(
  org: { ghl?: { locationId: string; tokenRef: string } } | null,
): GhlCtx | null {
  const userId = process.env.GHL_SOCIAL_USER_ID ?? "";
  if (org?.ghl) {
    const token = process.env[org.ghl.tokenRef] ?? "";
    if (!token || !org.ghl.locationId || !userId) return null;
    return { locationId: org.ghl.locationId, token, userId };
  }
  const token = process.env.GHL_API_KEY ?? "";
  const locationId = process.env.GHL_LOCATION_ID ?? "";
  if (!token || !locationId || !userId) return null;
  return { locationId, token, userId };
}

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; status: number; message: string };

export async function ghlFetch<T>(
  g: GhlCtx,
  path: string,
  init: { method?: string; body?: unknown; version?: string } = {},
): Promise<Ok<T> | Err> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${g.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Version: init.version ?? "2021-07-28",
        "User-Agent": UA,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const message =
        (json as { message?: string | string[] } | null)?.message ?? `GHL ${res.status}`;
      return { ok: false, status: res.status, message: Array.isArray(message) ? message.join("; ") : String(message) };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : "network error" };
  }
}

export async function startOAuth(g: GhlCtx, platform: Platform, reconnect = false) {
  const q = new URLSearchParams({ locationId: g.locationId, userId: g.userId });
  if (reconnect) q.set("reconnect", "true");
  const r = await ghlFetch<{ url?: string; redirectUrl?: string }>(
    g, `/social-media-posting/oauth/${platform}/start?${q.toString()}`,
  );
  if (!r.ok) return null;
  const url = r.data.url ?? r.data.redirectUrl;
  return url ? { url } : null;
}

export type GhlChoice = { id: string; name: string; type?: string; avatar?: string };

export async function listOAuthAccounts(g: GhlCtx, platform: Platform, accountId: string): Promise<GhlChoice[]> {
  const r = await ghlFetch<{ results?: { pages?: GhlChoice[]; accounts?: GhlChoice[]; profiles?: GhlChoice[] } }>(
    g, `/social-media-posting/oauth/${g.locationId}/${platform}/accounts/${accountId}`,
  );
  if (!r.ok) return [];
  const res = r.data.results ?? {};
  return res.pages ?? res.accounts ?? res.profiles ?? [];
}

export async function attachOAuthAccount(
  g: GhlCtx, platform: Platform, accountId: string, choice: { id: string; name: string; type?: string },
) {
  const r = await ghlFetch<{ results?: { id?: string; name?: string; avatar?: string } }>(
    g, `/social-media-posting/oauth/${g.locationId}/${platform}/accounts/${accountId}`,
    { method: "POST", body: { originId: choice.id, name: choice.name, type: choice.type ?? "page" } },
  );
  if (!r.ok) return null;
  const a = r.data.results ?? {};
  return { id: a.id ?? accountId, name: a.name ?? choice.name, avatar: a.avatar };
}

export type GhlPostInput = {
  accountIds: string[];
  summary: string;
  media: { url: string; type: string }[];
  scheduleDate: string;            // ISO, UTC
  type: "post" | "story" | "reel";
  followUpComment?: string;
  gmbPostDetails?: { title?: string; offerDetails?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string }; startDate?: string; endDate?: string };
  tiktokPostDetails?: { privacyLevel: "PUBLIC_TO_EVERYONE" | "SELF_ONLY"; promoteOtherBrand?: boolean; enableComment?: boolean };
};

export async function createScheduledPost(g: GhlCtx, input: GhlPostInput): Promise<{ id: string } | { error: string }> {
  const r = await ghlFetch<{ results?: { post?: { _id?: string; id?: string } } }>(
    g, `/social-media-posting/${g.locationId}/posts`,
    { method: "POST", body: { ...input, status: "scheduled", userId: g.userId } },
  );
  if (!r.ok) return { error: r.message };
  const id = r.data.results?.post?._id ?? r.data.results?.post?.id;
  return id ? { id } : { error: "GHL returned no post id" };
}

export async function deletePost(g: GhlCtx, ghlPostId: string): Promise<boolean> {
  const r = await ghlFetch(g, `/social-media-posting/${g.locationId}/posts/${ghlPostId}`, { method: "DELETE" });
  return r.ok;
}

export type GhlPostSummary = { _id: string; status: string; publishedAt?: string; error?: string };

export async function listPosts(
  g: GhlCtx, input: { accountIds: string[]; fromDate: string; toDate: string },
): Promise<GhlPostSummary[]> {
  const r = await ghlFetch<{ results?: { posts?: GhlPostSummary[] } }>(
    g, `/social-media-posting/${g.locationId}/posts/list`,
    { method: "POST", body: { type: "all", accounts: input.accountIds.join(","), fromDate: input.fromDate, toDate: input.toDate, skip: 0, limit: 200 } },
  );
  return r.ok ? (r.data.results?.posts ?? []) : [];
}

export async function accountStats(
  g: GhlCtx, accountIds: string[],
): Promise<Record<string, { followers?: number; reach?: number }>> {
  const r = await ghlFetch<{ results?: Record<string, { followers?: number; reach?: number }> }>(
    g, `/social-media-posting/statistics`,
    { method: "POST", body: { locationId: g.locationId, accountIds } },
  );
  return r.ok ? (r.data.results ?? {}) : {};
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run convex/lib/ghl.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/lib/ghl.ts convex/lib/ghl.test.ts
git commit -m "Per-org GHL Social Planner client with simulated mode"
```

---

### Task 3: Promos and checkout resolution

**Files:**
- Create: `convex/promos.ts`
- Modify: `convex/booking.ts:65-76` (`findDiscount`), `:418-435` (`validateCode`), `:753-765` (booking handler), `:865-880` (`recordBooked` call)
- Test: `convex/promos.test.ts`

**Interfaces:**
- Produces: `promos.create({code, pct, label?, startsAt, endsAt, roomId?, maxRedemptions?})`, `promos.update`, `promos.deactivate`, `promos.list`, internal `promos.createInternal` (for AI), exported helper `resolveCode(ctx, org, raw, roomId, now)` returning `{ code, pct, label, promoId?, expiresAt? } | null`, and internal mutation `promos.recordRedemption({promoId})`.
- Consumes: capabilities from Task 1.

- [ ] **Step 1: Write the failing tests**

`convex/promos.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;

describe("promos", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  let other: Id<"rooms">;
  const now = Date.now();

  beforeEach(async () => {
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Studio", slug: "studio", plan: "studio", status: "active",
        discountCodes: [{ code: "LEGACY10", pct: 10, active: true }],
      });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      const r = await ctx.db.insert("rooms", { orgId: "org1", name: "A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30 });
      const o = await ctx.db.insert("rooms", { orgId: "org1", name: "B", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 1, depositPct: 30 });
      return { r, o };
    });
    room = ids.r; other = ids.o;
  });

  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });

  it("owner creates a promo and checkout resolves it before a legacy code", async () => {
    await owner().mutation(api.promos.create, { code: "thu20", pct: 20, startsAt: now - DAY, endsAt: now + DAY, roomId: room });
    const res = await t.query(api.booking.validateCode, { roomId: room, code: "THU20" });
    expect(res).toMatchObject({ valid: true, code: "THU20", pct: 20 });
    expect((res as { expiresAt?: number }).expiresAt).toBe(now + DAY);
  });

  it("a promo scoped to one room does not validate on another", async () => {
    await owner().mutation(api.promos.create, { code: "THU20", pct: 20, startsAt: now - DAY, endsAt: now + DAY, roomId: room });
    expect(await t.query(api.booking.validateCode, { roomId: other, code: "THU20" })).toEqual({ valid: false });
  });

  it("an expired or not-yet-started promo does not validate", async () => {
    await owner().mutation(api.promos.create, { code: "PAST", pct: 20, startsAt: now - 3 * DAY, endsAt: now - DAY });
    await owner().mutation(api.promos.create, { code: "SOON", pct: 20, startsAt: now + DAY, endsAt: now + 3 * DAY });
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "PAST" })).toEqual({ valid: false });
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "SOON" })).toEqual({ valid: false });
  });

  it("legacy codes still work when no promo matches", async () => {
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "LEGACY10" })).toMatchObject({ valid: true, pct: 10 });
  });

  it("a promo at its redemption cap stops validating", async () => {
    const id = await owner().mutation(api.promos.create, { code: "CAP1", pct: 15, startsAt: now - DAY, endsAt: now + DAY, maxRedemptions: 1 });
    await t.run(async (ctx) => { await ctx.db.patch(id, { redemptions: 1 }); });
    expect(await t.query(api.booking.validateCode, { roomId: room, code: "CAP1" })).toEqual({ valid: false });
  });

  it("an engineer cannot create promos", async () => {
    await t.run(async (ctx) => { await ctx.db.insert("members", { orgId: "org1", name: "Eng", role: "engineer", clerkUserId: "u2", skills: [] }); });
    const eng = t.withIdentity({ subject: "u2", name: "Eng", orgId: "org1" });
    await expect(eng.mutation(api.promos.create, { code: "X", pct: 5, startsAt: now, endsAt: now + DAY })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/promos.test.ts`
Expected: FAIL, `api.promos` undefined.

- [ ] **Step 3: Implement `convex/promos.ts`**

```ts
import { mutation, query, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";

export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");

/** Resolve a submitted code for checkout: an active Promo whose window
 *  contains `now`, whose room matches (or is unscoped) and which is under its
 *  cap wins; otherwise the legacy orgs.discountCodes entry. Never returns a
 *  list. */
export async function resolveCode(
  ctx: QueryCtx | MutationCtx,
  org: Doc<"orgs"> | null,
  raw: string | undefined,
  roomId: Id<"rooms"> | undefined,
  now: number,
): Promise<{ code: string; pct: number; label: string | null; promoId?: Id<"promos">; expiresAt?: number } | null> {
  const code = raw ? normalizeCode(raw) : "";
  if (!code || !org) return null;
  const promo = await ctx.db
    .query("promos")
    .withIndex("by_org_code", (q) => q.eq("orgId", org.orgId).eq("code", code))
    .filter((q) => q.eq(q.field("active"), true))
    .first();
  if (promo) {
    const inWindow = promo.startsAt <= now && now <= promo.endsAt;
    const roomOk = !promo.roomId || !roomId || promo.roomId === roomId;
    const underCap = promo.maxRedemptions === undefined || promo.redemptions < promo.maxRedemptions;
    if (inWindow && roomOk && underCap) {
      const pct = Math.min(Math.max(promo.pct, 0), 100);
      return { code: promo.code, pct, label: promo.label ?? null, promoId: promo._id, expiresAt: promo.endsAt };
    }
    return null; // a matching but inactive-by-rule promo never falls through to a legacy code of the same name
  }
  const legacy = (org.discountCodes ?? []).find((c) => c.code === code && c.active);
  if (!legacy) return null;
  return { code: legacy.code, pct: Math.min(Math.max(legacy.pct, 0), 100), label: legacy.label ?? null };
}

const promoArgs = {
  code: v.string(),
  pct: v.number(),
  label: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
  roomId: v.optional(v.id("rooms")),
  maxRedemptions: v.optional(v.number()),
};

function validate(a: { code: string; pct: number; startsAt: number; endsAt: number }) {
  if (!normalizeCode(a.code)) throw new Error("Enter a code.");
  if (a.pct < 1 || a.pct > 90) throw new Error("Discount must be between 1 and 90 percent.");
  if (a.endsAt <= a.startsAt) throw new Error("The promo has to end after it starts.");
}

export const create = mutation({
  args: promoArgs,
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    validate(args);
    const code = normalizeCode(args.code);
    const dup = await ctx.db.query("promos").withIndex("by_org_code", (q) => q.eq("orgId", orgId).eq("code", code)).filter((q) => q.eq(q.field("active"), true)).first();
    if (dup) throw new Error(`Code ${code} is already active. Deactivate it first or pick another code.`);
    const actor = await currentActor(ctx);
    return await ctx.db.insert("promos", {
      orgId, code, pct: Math.round(args.pct), label: args.label, startsAt: args.startsAt, endsAt: args.endsAt,
      roomId: args.roomId, maxRedemptions: args.maxRedemptions, redemptions: 0,
      source: "owner", active: true, createdBy: actor, createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: { id: v.id("promos"), ...promoArgs },
  handler: async (ctx, { id, ...args }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const p = await ctx.db.get(id);
    if (!p || p.orgId !== orgId) throw new Error("Not found");
    validate(args);
    await ctx.db.patch(id, { ...args, code: normalizeCode(args.code), pct: Math.round(args.pct) });
  },
});

export const deactivate = mutation({
  args: { id: v.id("promos") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const p = await ctx.db.get(id);
    if (!p || p.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { active: false });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const rows = await ctx.db.query("promos").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** AI / cron path: create or refresh a rate-cut promo. Same code twice in a
 *  window is refreshed, not duplicated. */
export const createInternal = internalMutation({
  args: { orgId: v.string(), ...promoArgs, source: v.union(v.literal("owner"), v.literal("rate_cut")) },
  handler: async (ctx, args) => {
    const code = normalizeCode(args.code);
    const existing = await ctx.db.query("promos").withIndex("by_org_code", (q) => q.eq("orgId", args.orgId).eq("code", code)).filter((q) => q.eq(q.field("active"), true)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { pct: args.pct, startsAt: args.startsAt, endsAt: args.endsAt, roomId: args.roomId, label: args.label });
      return existing._id;
    }
    return await ctx.db.insert("promos", {
      orgId: args.orgId, code, pct: args.pct, label: args.label, startsAt: args.startsAt, endsAt: args.endsAt,
      roomId: args.roomId, maxRedemptions: args.maxRedemptions, redemptions: 0,
      source: args.source, active: true, createdBy: "pulse-ai", createdAt: Date.now(),
    });
  },
});

export async function recordRedemption(ctx: MutationCtx, promoId: Id<"promos">) {
  const p = await ctx.db.get(promoId);
  if (p) await ctx.db.patch(promoId, { redemptions: p.redemptions + 1 });
}
```

- [ ] **Step 4: Wire checkout in `convex/booking.ts`**

Replace the body of `validateCode` so it calls the new resolver (keep `findDiscount` for any other caller; if none, delete it):

```ts
import { resolveCode, recordRedemption } from "./promos";
// ...
export const validateCode = query({
  args: { roomId: v.id("rooms"), code: v.string() },
  handler: async (ctx, { roomId, code }) => {
    const room = await ctx.db.get(roomId);
    if (!room || room.status === "retired") return { valid: false as const };
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", room.orgId)).first();
    const match = await resolveCode(ctx, org, code, roomId, Date.now());
    if (!match) return { valid: false as const };
    return { valid: true as const, code: match.code, pct: match.pct, label: match.label, ...(match.expiresAt ? { expiresAt: match.expiresAt } : {}) };
  },
});
```

In the booking handler, replace `discount = findDiscount(org, args.discountCode);` with `discount = await resolveCode(ctx, org, args.discountCode, args.roomId, Date.now());` (keep the throw on null). After the session insert, where `recordBooked` is called, add:

```ts
    if (discount?.promoId) await recordRedemption(ctx, discount.promoId);
```

The `discount` variable type becomes `Awaited<ReturnType<typeof resolveCode>>`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run convex/promos.test.ts convex/discountCodes.test.ts convex/bookingConversion.test.ts && npm run typecheck`
Expected: PASS. `discountCodes.test.ts` "validates an active code and returns exactly that one code" still passes because `expiresAt` is only spread when present.

- [ ] **Step 6: Commit**

```bash
git add convex/promos.ts convex/promos.test.ts convex/booking.ts
git commit -m "Promos: time-boxed codes that checkout resolves before legacy discount codes"
```

---

### Task 4: Post attribution in the booking funnel

**Files:**
- Modify: `convex/bookingFunnel.ts:49-58` (`track` args), `:107-135` (`recordBooked`)
- Modify: `convex/booking.ts` (createBooking args + `recordBooked` call)
- Modify: `src/lib/use-booking-funnel.ts:60-70`, `src/app/book/[slug]/[roomId]/page.tsx:58-62,148-165`
- Test: `convex/bookingFunnel.test.ts` (extend)

**Interfaces:**
- Produces: `track` accepts `src?: string`; visits carry `postId` when `src` is a valid `socialPosts` id in the same org; `recordBooked(ctx, orgId, visitorKey, sessionId, amountCents, { ref, code, postId })`.

- [ ] **Step 1: Write the failing test**

Append to `convex/bookingFunnel.test.ts` (reuse its existing seeding helpers; if it seeds an org with slug `studio`, use that):

```ts
it("records the post id from ?src= on a page visit and ignores foreign or garbage ids", async () => {
  const t = convexTest(schema);
  const { postId, foreign } = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
    await ctx.db.insert("orgs", { orgId: "org2", name: "T", slug: "other", plan: "studio", status: "active" });
    const base = { template: "custom" as const, status: "published" as const, caption: "x", media: [], accountIds: [], scheduledFor: 0, timezone: "UTC", ghlType: "post" as const, submittedBy: "u", createdAt: 0, updatedAt: 0 };
    const postId = await ctx.db.insert("socialPosts", { orgId: "org1", ...base });
    const foreign = await ctx.db.insert("socialPosts", { orgId: "org2", ...base });
    return { postId, foreign };
  });
  await t.mutation(api.bookingFunnel.track, { slug: "studio", visitorKey: "v1", step: "page", src: postId });
  await t.mutation(api.bookingFunnel.track, { slug: "studio", visitorKey: "v2", step: "page", src: foreign });
  await t.mutation(api.bookingFunnel.track, { slug: "studio", visitorKey: "v3", step: "page", src: "not-an-id" });
  const rows = await t.run((ctx) => ctx.db.query("bookingVisits").collect());
  expect(rows.find((r) => r.visitorKey === "v1")?.postId).toBe(postId);
  expect(rows.find((r) => r.visitorKey === "v2")?.postId).toBeUndefined();
  expect(rows.find((r) => r.visitorKey === "v3")?.postId).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/bookingFunnel.test.ts`
Expected: FAIL, `src` is not a valid arg.

- [ ] **Step 3: Implement**

In `convex/bookingFunnel.ts` `track`: add `src: v.optional(v.string()),` to args. Inside the handler after `orgId` is known:

```ts
    let postId: Id<"socialPosts"> | undefined;
    if (args.src) {
      const id = ctx.db.normalizeId("socialPosts", args.src);
      if (id) {
        const post = await ctx.db.get(id);
        if (post && post.orgId === orgId) postId = id;
      }
    }
```

and include `postId` in the `bookingVisits` insert. In `recordBooked`, change the `extra` type to `{ ref?: string; code?: string; postId?: Id<"socialPosts"> }` and write `postId: extra.postId` on the row.

In `convex/booking.ts` `createBooking` args add `src: v.optional(v.string())`; resolve it the same way (`normalizeId` + same-org check) into `postId` and pass `{ ref: args.ref, code: discount?.code, postId }` to `recordBooked`.

In `src/lib/use-booking-funnel.ts` add `src: params.get("src") ?? undefined,` to the `track` call. In `src/app/book/[slug]/[roomId]/page.tsx` read `const srcFromLink = searchParams.get("src") ?? undefined;` next to `refFromLink` and pass `src: srcFromLink` into `createBooking`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run convex/bookingFunnel.test.ts convex/bookingConversion.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/bookingFunnel.ts convex/bookingFunnel.test.ts convex/booking.ts src/lib/use-booking-funnel.ts "src/app/book/[slug]/[roomId]/page.tsx"
git commit -m "Booking funnel: attribute visits and bookings to a social post via ?src="
```

---

### Task 5: Per-platform rules (pure)

**Files:**
- Create: `convex/marketing/rules.ts`
- Test: `convex/marketing/rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MediaKind = "image" | "video";
  export function validateForPlatform(platform: Platform, input: { caption: string; media: MediaKind[]; hasLink: boolean }): string[]; // empty = ok
  export function captionLimit(platform: Platform): number;
  ```

- [ ] **Step 1: Write the failing tests**

`convex/marketing/rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateForPlatform, captionLimit } from "./rules";

describe("platform rules", () => {
  it("tiktok and youtube require exactly one video", () => {
    expect(validateForPlatform("tiktok", { caption: "x", media: ["image"], hasLink: false })).toContain("TikTok needs one video.");
    expect(validateForPlatform("youtube", { caption: "x", media: [], hasLink: false })).toContain("YouTube needs one video.");
    expect(validateForPlatform("tiktok", { caption: "x", media: ["video"], hasLink: false })).toEqual([]);
  });
  it("instagram needs media and allows up to ten images", () => {
    expect(validateForPlatform("instagram", { caption: "x", media: [], hasLink: false })).toContain("Instagram needs a photo or video.");
    expect(validateForPlatform("instagram", { caption: "x", media: Array(11).fill("image"), hasLink: false })).toContain("Instagram allows up to 10 photos.");
  });
  it("google rejects phone numbers and long captions", () => {
    expect(validateForPlatform("google", { caption: "Call 213-444-5199", media: ["image"], hasLink: false })).toContain("Google rejects phone numbers in the text. Use the call button instead.");
    expect(validateForPlatform("google", { caption: "a".repeat(1501), media: [], hasLink: false })).toContain("Google allows 1,500 characters.");
  });
  it("caption limits", () => {
    expect(captionLimit("bluesky")).toBe(300);
    expect(captionLimit("threads")).toBe(500);
    expect(captionLimit("instagram")).toBe(2200);
  });
  it("facebook and linkedin accept text only", () => {
    expect(validateForPlatform("facebook", { caption: "hi", media: [], hasLink: true })).toEqual([]);
    expect(validateForPlatform("linkedin", { caption: "hi", media: [], hasLink: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/marketing/rules.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `convex/marketing/rules.ts`**

```ts
import type { Platform } from "../lib/ghl";

export type MediaKind = "image" | "video";

const LIMITS: Record<Platform, number> = {
  google: 1500, facebook: 63206, instagram: 2200, linkedin: 3000, tiktok: 2200,
  "tiktok-business": 2200, youtube: 5000, pinterest: 500, threads: 500, bluesky: 300,
};

export function captionLimit(platform: Platform): number {
  return LIMITS[platform];
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/** Pure validation, one message per problem. Empty array means the post is
 *  acceptable for that platform as far as Pulse can tell; GHL may still
 *  reject it and that message is surfaced verbatim. */
export function validateForPlatform(
  platform: Platform,
  input: { caption: string; media: MediaKind[]; hasLink: boolean },
): string[] {
  const out: string[] = [];
  const images = input.media.filter((m) => m === "image").length;
  const videos = input.media.filter((m) => m === "video").length;
  if (input.caption.length > LIMITS[platform]) {
    out.push(`${label(platform)} allows ${LIMITS[platform].toLocaleString("en-US")} characters.`);
  }
  switch (platform) {
    case "tiktok":
    case "tiktok-business":
      if (videos !== 1 || images > 0) out.push("TikTok needs one video.");
      break;
    case "youtube":
      if (videos !== 1 || images > 0) out.push("YouTube needs one video.");
      break;
    case "instagram":
      if (images + videos === 0) out.push("Instagram needs a photo or video.");
      if (images > 10) out.push("Instagram allows up to 10 photos.");
      if (videos > 1) out.push("Instagram allows one video per post.");
      break;
    case "pinterest":
      if (images !== 1 || videos > 0) out.push("Pinterest needs one image.");
      break;
    case "google":
      if (images > 1 || videos > 0) out.push("Google allows one photo.");
      if (PHONE.test(input.caption)) out.push("Google rejects phone numbers in the text. Use the call button instead.");
      break;
    case "bluesky":
      if (images > 4 || videos > 0) out.push("Bluesky allows up to 4 photos.");
      break;
    case "threads":
      if (images + videos > 20) out.push("Threads allows up to 20 items.");
      break;
    case "facebook":
    case "linkedin":
      break;
  }
  return out;
}

function label(p: Platform): string {
  return { google: "Google", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok", "tiktok-business": "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads", bluesky: "Bluesky" }[p];
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run convex/marketing/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/marketing/rules.ts convex/marketing/rules.test.ts
git commit -m "Marketing: per-platform post validation rules"
```

---

### Task 6: Connected accounts (OAuth start, attach, list, remove)

**Files:**
- Create: `convex/marketing/accounts.ts`
- Test: `convex/marketing/accounts.test.ts`

**Interfaces:**
- Consumes: `ghlFromEnv`, `startOAuth`, `listOAuthAccounts`, `attachOAuthAccount` (Task 2); `assertWithinLimit`, `recordUsage` (`convex/usage.ts`); `currentOrgWithCapability` (`convex/lib/tenant.ts`).
- Produces:
  - `accounts.startConnect({ platform, reconnect? })` action → `{ url } | { simulated: true }`
  - `accounts.choices({ platform, ghlAccountId })` action → `GhlChoice[]`
  - `accounts.attach({ platform, ghlAccountId, choice: { id, name, type? } })` action → `Id<"socialAccounts">`
  - `accounts.list()` query
  - `accounts.remove({ id })` mutation (status `removed`)
  - internal `accounts.insertInternal`, `accounts.orgContext` (org doc for actions)

- [ ] **Step 1: Write the failing tests**

`convex/marketing/accounts.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";

describe("marketing accounts", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "T", slug: "other", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      await ctx.db.insert("members", { orgId: "org2", name: "Owner2", role: "owner", clerkUserId: "u2", skills: [] });
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
  const owner2 = () => t.withIdentity({ subject: "u2", name: "Owner2", orgId: "org2" });

  it("startConnect is simulated without GHL env", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    expect(await owner().action(api.marketing.accounts.startConnect, { platform: "instagram" })).toEqual({ simulated: true });
  });

  it("insertInternal refuses a GHL account id already owned by another org", async () => {
    await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Studio IG", connectedBy: "u1",
    });
    await expect(t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org2", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Stolen", connectedBy: "u2",
    })).rejects.toThrow(/already connected/);
  });

  it("studio tier caps connected accounts at 3", async () => {
    for (const n of [1, 2, 3]) {
      await t.mutation(internal.marketing.accounts.insertInternal, {
        orgId: "org1", platform: "facebook", ghlAccountId: `acc_${n}`, ghlLocationId: "loc", name: `P${n}`, connectedBy: "u1",
      });
    }
    await expect(t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "facebook", ghlAccountId: "acc_4", ghlLocationId: "loc", name: "P4", connectedBy: "u1",
    })).rejects.toThrow(/LIMIT_REACHED|limit/i);
  });

  it("list returns only the caller's org and remove soft-deletes", async () => {
    const id = await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "Studio IG", connectedBy: "u1",
    });
    await t.mutation(internal.marketing.accounts.insertInternal, {
      orgId: "org2", platform: "instagram", ghlAccountId: "acc_9", ghlLocationId: "loc", name: "Other", connectedBy: "u2",
    });
    expect((await owner().query(api.marketing.accounts.list, {})).map((a) => a.name)).toEqual(["Studio IG"]);
    await owner().mutation(api.marketing.accounts.remove, { id });
    expect(await owner().query(api.marketing.accounts.list, {})).toEqual([]);
    expect((await owner2().query(api.marketing.accounts.list, {})).map((a) => a.name)).toEqual(["Other"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/marketing/accounts.test.ts`
Expected: FAIL, `api.marketing` undefined.

- [ ] **Step 3: Implement `convex/marketing/accounts.ts`**

```ts
import { action, mutation, query, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "../lib/tenant";
import { assertWithinLimit, recordUsage } from "../usage";
import { ghlFromEnv, startOAuth, listOAuthAccounts, attachOAuthAccount, PLATFORMS, type Platform } from "../lib/ghl";

const platformArg = v.union(...PLATFORMS.map((p) => v.literal(p)));

/** Org doc + GHL override for actions (they have no ctx.db). */
export const orgContext = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return org ? { orgId: org.orgId, slug: org.slug, name: org.name, ghl: org.ghl ?? undefined } : null;
  },
});

export const startConnect = action({
  args: { platform: platformArg, reconnect: v.optional(v.boolean()) },
  handler: async (ctx, { platform, reconnect }): Promise<{ url: string } | { simulated: true }> => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (!g) return { simulated: true };
    const r = await startOAuth(g, platform as Platform, reconnect ?? false);
    if (!r) throw new ConvexError({ code: "GHL_UNAVAILABLE", message: "Could not start the connection. Try again in a minute." });
    return r;
  },
});

/** Capability + cap check for the connect flow, callable from an action. */
export const myOrgForConnect = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    await assertWithinLimit(ctx, orgId, "social_accounts", 1);
    return orgId;
  },
});

export const choices = action({
  args: { platform: platformArg, ghlAccountId: v.string() },
  handler: async (ctx, { platform, ghlAccountId }) => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (!g) return [{ id: ghlAccountId, name: "Simulated account" }];
    return await listOAuthAccounts(g, platform as Platform, ghlAccountId);
  },
});

export const attach = action({
  args: { platform: platformArg, ghlAccountId: v.string(), choice: v.object({ id: v.string(), name: v.string(), type: v.optional(v.string()) }) },
  handler: async (ctx, { platform, ghlAccountId, choice }): Promise<Id<"socialAccounts">> => {
    const orgId = await ctx.runQuery(api.marketing.accounts.myOrgForConnect, {});
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    let attached: { id: string; name: string; avatar?: string } = { id: ghlAccountId, name: choice.name };
    if (g) {
      const r = await attachOAuthAccount(g, platform as Platform, ghlAccountId, choice);
      if (!r) throw new ConvexError({ code: "GHL_ATTACH_FAILED", message: "The account could not be attached. Reconnect and try again." });
      attached = r;
    }
    const actor = await ctx.runQuery(api.marketing.accounts.whoAmI, {});
    return await ctx.runMutation(internal.marketing.accounts.insertInternal, {
      orgId, platform, ghlAccountId: attached.id, ghlLocationId: g?.locationId ?? "simulated",
      name: attached.name, avatarUrl: attached.avatar, connectedBy: actor,
    });
  },
});

export const whoAmI = query({ args: {}, handler: async (ctx) => currentActor(ctx) });

export const insertInternal = internalMutation({
  args: {
    orgId: v.string(), platform: platformArg, ghlAccountId: v.string(), ghlLocationId: v.string(),
    name: v.string(), avatarUrl: v.optional(v.string()), connectedBy: v.string(),
  },
  handler: async (ctx, args) => {
    // Invariant: one GHL account belongs to exactly one org, forever.
    const owned = await ctx.db.query("socialAccounts").withIndex("by_ghl_account", (q) => q.eq("ghlAccountId", args.ghlAccountId)).first();
    if (owned && owned.orgId !== args.orgId) {
      throw new ConvexError({ code: "ACCOUNT_TAKEN", message: "That profile is already connected to another studio." });
    }
    if (owned) {
      await ctx.db.patch(owned._id, { status: "connected", name: args.name, avatarUrl: args.avatarUrl, lastCheckedAt: Date.now() });
      return owned._id;
    }
    await assertWithinLimit(ctx, args.orgId, "social_accounts", 1);
    const id = await ctx.db.insert("socialAccounts", { ...args, status: "connected", connectedAt: Date.now() });
    await recordUsage(ctx, args.orgId, "social_accounts", 1);
    return id;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const rows = await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.filter((r) => r.status !== "removed").map((r) => ({
      _id: r._id, platform: r.platform, name: r.name, avatarUrl: r.avatarUrl, status: r.status, stats: r.stats, connectedAt: r.connectedAt,
    }));
  },
});

export const remove = mutation({
  args: { id: v.id("socialAccounts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { status: "removed" });
    await recordUsage(ctx, orgId, "social_accounts", -1);
  },
});
```

Note: `usage.periodFor` must treat `social_accounts` as a non-resetting metric. In `convex/usage.ts` `periodFor`, add `social_accounts` to whatever list returns `"all"` (storage_bytes and subaccounts are there today).

- [ ] **Step 4: Run tests**

Run: `npx vitest run convex/marketing/accounts.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/marketing/accounts.ts convex/marketing/accounts.test.ts convex/usage.ts
git commit -m "Marketing: connect, attach, list and remove social accounts through GHL"
```

---

### Task 7: Posts lifecycle and GHL scheduling

**Files:**
- Create: `convex/marketing/posts.ts`
- Test: `convex/marketing/posts.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 5, 6; `promos` (Task 3); `assertWithinLimit`, `recordUsage`.
- Produces:
  - `posts.create(input)` mutation → `Id<"socialPosts">` (status `draft`)
  - `posts.update({ id, ...input })` mutation (draft/approved only)
  - `posts.approve({ id })` mutation (`draft -> approved`, schedules `posts.schedule`)
  - `posts.schedule({ id })` internal action (`approved -> scheduled`)
  - `posts.cancel({ id })` mutation
  - `posts.list({ from, to })`, `posts.get({ id })` queries
  - `posts.syncStatusAll` internal action (cron), `posts.markStatus` internal mutation
  - `posts.createInternal` internal mutation (AI drafts)
  - `buildTrackedLink({ host, slug, roomId?, postId, code? })` pure helper

Post input shape (shared by `create`, `update`, `createInternal`):

```ts
const postInput = {
  template: v.union(v.literal("session_bts"), v.literal("before_after"), v.literal("client_win"), v.literal("room_gear"), v.literal("tip"), v.literal("rate_promo"), v.literal("open_slot"), v.literal("engineer_story"), v.literal("custom")),
  caption: v.string(),
  captionOverrides: v.optional(v.record(v.string(), v.string())),
  media: v.array(v.object({ storageId: v.optional(v.id("_storage")), brandCard: v.optional(v.union(v.literal("rate_card"), v.literal("open_slot"), v.literal("promo"))), type: v.union(v.literal("image"), v.literal("video")) })),
  accountIds: v.array(v.id("socialAccounts")),
  scheduledFor: v.number(),
  timezone: v.string(),
  promoId: v.optional(v.id("promos")),
  artistId: v.optional(v.id("artists")),
  roomId: v.optional(v.id("rooms")),
  ghlType: v.union(v.literal("post"), v.literal("story"), v.literal("reel")),
  includeBookingLink: v.boolean(),
};
```

- [ ] **Step 1: Write the failing tests**

`convex/marketing/posts.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { buildTrackedLink } from "./posts";

const HOUR = 3_600_000;

describe("marketing posts", () => {
  let t: ReturnType<typeof convexTest>;
  let ig: Id<"socialAccounts">;
  let foreignIg: Id<"socialAccounts">;
  let artist: Id<"artists">;
  const now = Date.now();

  beforeEach(async () => {
    t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org2", name: "T", slug: "other", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      await ctx.db.insert("members", { orgId: "org1", name: "Eng", role: "engineer", clerkUserId: "u3", skills: [] });
      const ig = await ctx.db.insert("socialAccounts", { orgId: "org1", platform: "instagram", ghlAccountId: "acc_1", ghlLocationId: "loc", name: "IG", status: "connected", connectedBy: "u1", connectedAt: now });
      const foreignIg = await ctx.db.insert("socialAccounts", { orgId: "org2", platform: "instagram", ghlAccountId: "acc_2", ghlLocationId: "loc", name: "Other IG", status: "connected", connectedBy: "u2", connectedAt: now });
      const artist = await ctx.db.insert("artists", { orgId: "org1", name: "Sky", tags: [], okToFeature: false } as never);
      return { ig, foreignIg, artist };
    });
    ig = ids.ig; foreignIg = ids.foreignIg; artist = ids.artist;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const owner = () => t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
  const eng = () => t.withIdentity({ subject: "u3", name: "Eng", orgId: "org1" });
  const base = { template: "custom" as const, caption: "Open Thursday", captionOverrides: undefined, media: [{ type: "image" as const, brandCard: "open_slot" as const }], scheduledFor: now + 2 * HOUR, timezone: "America/Los_Angeles", ghlType: "post" as const, includeBookingLink: true };

  it("engineer creates a draft; approving requires marketing.approve", async () => {
    const id = await eng().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).toBe("draft");
    await expect(eng().mutation(api.marketing.posts.approve, { id })).rejects.toThrow();
  });

  it("a post can never reference another org's account", async () => {
    await expect(owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig, foreignIg] })).rejects.toThrow(/not one of this studio/);
  });

  it("per-platform rules block an invalid draft", async () => {
    await expect(owner().mutation(api.marketing.posts.create, { ...base, media: [], accountIds: [ig] })).rejects.toThrow(/Instagram needs a photo or video/);
  });

  it("client_win needs the artist's OK to feature at approve time", async () => {
    const id = await owner().mutation(api.marketing.posts.create, { ...base, template: "client_win", artistId: artist, accountIds: [ig] });
    await expect(owner().mutation(api.marketing.posts.approve, { id })).rejects.toThrow(/OK to feature/);
    await t.run(async (ctx) => { await ctx.db.patch(artist, { okToFeature: true }); });
    await owner().mutation(api.marketing.posts.approve, { id });
    expect((await owner().query(api.marketing.posts.get, { id }))?.status).not.toBe("draft");
  });

  it("approve meters the monthly cap and schedules through GHL in simulated mode", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await owner().mutation(api.marketing.posts.approve, { id });
    await t.finishAllScheduledFunctions(() => {});
    const post = await owner().query(api.marketing.posts.get, { id });
    expect(post?.status).toBe("scheduled");
    expect(post?.ghlPostId?.startsWith("simulated:")).toBe(true);
    expect(post?.link).toContain("?src=");
    const usage = await t.run((ctx) => ctx.db.query("usageCounters").collect());
    expect(usage.find((u) => u.metric === "social_posts")?.value).toBe(1);
  });

  it("schedule sends only this org's GHL account ids and stores the GHL post id", async () => {
    vi.stubEnv("GHL_API_KEY", "pit"); vi.stubEnv("GHL_LOCATION_ID", "loc"); vi.stubEnv("GHL_SOCIAL_USER_ID", "user");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: { post: { _id: "ghl_9" } } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await owner().mutation(api.marketing.posts.create, { ...base, accountIds: [ig] });
    await owner().mutation(api.marketing.posts.approve, { id });
    await t.finishAllScheduledFunctions(() => {});
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.accountIds).toEqual(["acc_1"]);
    expect(body.status).toBe("scheduled");
    expect((await owner().query(api.marketing.posts.get, { id }))?.ghlPostId).toBe("ghl_9");
  });

  it("buildTrackedLink carries src and code", () => {
    expect(buildTrackedLink({ host: "https://pulse.myindsound.com", slug: "studio", roomId: "r1", postId: "p1", code: "THU20" }))
      .toBe("https://pulse.myindsound.com/book/studio/r1?src=p1&code=THU20");
    expect(buildTrackedLink({ host: "https://pulse.myindsound.com", slug: "studio", postId: "p1" }))
      .toBe("https://pulse.myindsound.com/book/studio?src=p1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/marketing/posts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `convex/marketing/posts.ts`**

```ts
import { mutation, query, internalMutation, internalAction, internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { currentOrgWithCapability, currentActor } from "../lib/tenant";
import { assertWithinLimit, recordUsage } from "../usage";
import { stripEmDashes } from "../lib/text";
import { validateForPlatform, type MediaKind } from "./rules";
import { ghlFromEnv, createScheduledPost, deletePost, listPosts, type GhlPostInput } from "../lib/ghl";

export const APP_HOST = process.env.PULSE_PUBLIC_HOST ?? "https://pulse.myindsound.com";

export function buildTrackedLink(a: { host: string; slug: string; roomId?: string; postId: string; code?: string }): string {
  const path = a.roomId ? `/book/${a.slug}/${a.roomId}` : `/book/${a.slug}`;
  const q = new URLSearchParams({ src: a.postId });
  if (a.code) q.set("code", a.code);
  return `${a.host}${path}?${q.toString()}`;
}

const postInput = { /* exactly the block in the Interfaces section above */ };

/** Shared validation for create/update: accounts belong to this org, media
 *  and caption satisfy every chosen platform. Throws the first problem. */
async function validateInput(ctx: MutationCtx, orgId: string, input: { caption: string; media: { type: MediaKind }[]; accountIds: Id<"socialAccounts">[]; includeBookingLink: boolean; scheduledFor: number; promoId?: Id<"promos"> }) {
  if (input.accountIds.length === 0) throw new Error("Pick at least one account.");
  if (input.scheduledFor < Date.now() + 5 * 60_000) throw new Error("Schedule at least five minutes from now.");
  const accounts: Doc<"socialAccounts">[] = [];
  for (const id of input.accountIds) {
    const a = await ctx.db.get(id);
    if (!a || a.orgId !== orgId || a.status === "removed") {
      throw new ConvexError({ code: "FOREIGN_ACCOUNT", message: "One of the selected accounts is not one of this studio's connected accounts." });
    }
    accounts.push(a);
  }
  if (input.promoId) {
    const p = await ctx.db.get(input.promoId);
    if (!p || p.orgId !== orgId) throw new Error("That promo does not belong to this studio.");
  }
  const media = input.media.map((m) => m.type);
  for (const a of accounts) {
    const problems = validateForPlatform(a.platform, { caption: input.caption, media, hasLink: input.includeBookingLink });
    if (problems.length) throw new Error(problems.join(" "));
  }
  return accounts;
}

export const create = mutation({
  args: postInput,
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.edit");
    await validateInput(ctx, orgId, args);
    const actor = await currentActor(ctx);
    const now = Date.now();
    const { includeBookingLink, ...rest } = args;
    const id = await ctx.db.insert("socialPosts", {
      orgId, ...rest, caption: stripEmDashes(args.caption), status: "draft", submittedBy: actor, createdAt: now, updatedAt: now,
    });
    if (includeBookingLink) await ctx.db.patch(id, { link: await linkFor(ctx, orgId, id, args.roomId, args.promoId) });
    return id;
  },
});

async function linkFor(ctx: MutationCtx, orgId: string, postId: Id<"socialPosts">, roomId?: Id<"rooms">, promoId?: Id<"promos">) {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  const promo = promoId ? await ctx.db.get(promoId) : null;
  return buildTrackedLink({ host: APP_HOST, slug: org?.slug ?? orgId, roomId, postId, code: promo?.code });
}

export const update = mutation({
  args: { id: v.id("socialPosts"), ...postInput },
  handler: async (ctx, { id, ...args }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.edit");
    const post = await ctx.db.get(id);
    if (!post || post.orgId !== orgId) throw new Error("Not found");
    if (post.status !== "draft" && post.status !== "approved" && post.status !== "failed") throw new Error(`A ${post.status} post cannot be edited. Cancel it and create a new one.`);
    await validateInput(ctx, orgId, args);
    const { includeBookingLink, ...rest } = args;
    await ctx.db.patch(id, {
      ...rest, caption: stripEmDashes(args.caption), status: "draft", approvedBy: undefined, approvedAt: undefined, failure: undefined, updatedAt: Date.now(),
      link: includeBookingLink ? await linkFor(ctx, orgId, id, args.roomId, args.promoId) : undefined,
    });
  },
});

export const approve = mutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const post = await ctx.db.get(id);
    if (!post || post.orgId !== orgId) throw new Error("Not found");
    if (post.status !== "draft" && post.status !== "failed") throw new Error(`Cannot approve a ${post.status} post.`);
    if (post.template === "client_win") {
      const artist = post.artistId ? await ctx.db.get(post.artistId) : null;
      if (!artist?.okToFeature) throw new Error("This artist has not given the OK to feature. Ask them, tick it on their profile, then approve.");
    }
    await assertWithinLimit(ctx, orgId, "social_posts", 1);
    const actor = await currentActor(ctx);
    await ctx.db.patch(id, { status: "approved", approvedBy: actor, approvedAt: Date.now(), failure: undefined, updatedAt: Date.now() });
    await recordUsage(ctx, orgId, "social_posts", 1);
    await ctx.scheduler.runAfter(0, internal.marketing.posts.schedule, { id });
  },
});

/** Everything an action needs to build the GHL payload, in one read. */
export const payloadContext = internalQuery({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const post = await ctx.db.get(id);
    if (!post) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", post.orgId)).first();
    const accounts = [];
    for (const aid of post.accountIds) {
      const a = await ctx.db.get(aid);
      if (a && a.orgId === post.orgId && a.status !== "removed") accounts.push({ ghlAccountId: a.ghlAccountId, platform: a.platform });
    }
    const media: { url: string; type: string }[] = [];
    for (const m of post.media) {
      if (m.storageId) {
        const url = await ctx.storage.getUrl(m.storageId);
        if (url) media.push({ url, type: m.type === "video" ? "video/mp4" : "image/jpeg" });
      } else if (m.brandCard) {
        media.push({ url: `${APP_HOST}/api/brand-card/${post._id}?kind=${m.brandCard}&v=${post.updatedAt}`, type: "image/png" });
      }
    }
    const promo = post.promoId ? await ctx.db.get(post.promoId) : null;
    return { post, org: org ? { ghl: org.ghl ?? undefined, slug: org.slug } : null, accounts, media, promo };
  },
});

export const schedule = internalAction({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const c = await ctx.runQuery(internal.marketing.posts.payloadContext, { id });
    if (!c || c.post.status !== "approved") return;
    // Invariant re-checked at the boundary: every id is this org's own.
    if (c.accounts.length !== c.post.accountIds.length) {
      await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "failed", failure: "An account on this post is no longer connected." });
      return;
    }
    const g = ghlFromEnv(c.org);
    if (!g) {
      await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "scheduled", ghlPostId: `simulated:${id}` });
      return;
    }
    const summary = c.post.link ? `${c.post.caption}\n\n${c.post.link}` : c.post.caption;
    const input: GhlPostInput = {
      accountIds: c.accounts.map((a) => a.ghlAccountId),
      summary,
      media: c.media,
      scheduleDate: new Date(c.post.scheduledFor).toISOString(),
      type: c.post.ghlType,
    };
    if (c.accounts.some((a) => a.platform === "google") && c.promo) {
      input.gmbPostDetails = {
        title: c.promo.label ?? `${c.promo.pct}% off`,
        offerDetails: { couponCode: c.promo.code, redeemOnlineUrl: c.post.link, termsConditions: "Valid on new bookings only." },
        startDate: new Date(c.promo.startsAt).toISOString(), endDate: new Date(c.promo.endsAt).toISOString(),
      };
    }
    if (c.accounts.some((a) => a.platform.startsWith("tiktok"))) {
      input.tiktokPostDetails = { privacyLevel: "PUBLIC_TO_EVERYONE", enableComment: true };
    }
    const r = await createScheduledPost(g, input);
    if ("error" in r) {
      await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "failed", failure: r.error });
      return;
    }
    await ctx.runMutation(internal.marketing.posts.markStatus, { id, status: "scheduled", ghlPostId: r.id });
  },
});

export const markStatus = internalMutation({
  args: {
    id: v.id("socialPosts"),
    status: v.union(v.literal("scheduled"), v.literal("published"), v.literal("failed"), v.literal("approved")),
    ghlPostId: v.optional(v.string()),
    failure: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const post = await ctx.db.get(id);
    if (!post) return;
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    if (patch.status === "failed") {
      await ctx.db.insert("activity", { orgId: post.orgId, kind: "social.post.failed", summary: `A scheduled post did not publish: ${patch.failure ?? "unknown error"}`, entityType: "socialPost", entityId: id, accent: "critical" });
    }
    if (patch.status === "published") {
      await ctx.db.insert("activity", { orgId: post.orgId, kind: "social.post.published", summary: `Published: ${post.caption.slice(0, 60)}`, entityType: "socialPost", entityId: id, accent: "positive" });
    }
  },
});

export const cancel = mutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    const post = await ctx.db.get(id);
    if (!post || post.orgId !== orgId) throw new Error("Not found");
    if (post.status === "published") throw new Error("A published post cannot be cancelled from Pulse.");
    await ctx.db.patch(id, { status: "cancelled", updatedAt: Date.now() });
    if (post.status === "scheduled" && post.ghlPostId && !post.ghlPostId.startsWith("simulated:")) {
      await ctx.scheduler.runAfter(0, internal.marketing.posts.deleteInGhl, { orgId, ghlPostId: post.ghlPostId });
    }
  },
});

export const deleteInGhl = internalAction({
  args: { orgId: v.string(), ghlPostId: v.string() },
  handler: async (ctx, { orgId, ghlPostId }) => {
    const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId });
    const g = ghlFromEnv(org);
    if (g) await deletePost(g, ghlPostId);
  },
});

export const list = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const rows = await ctx.db.query("socialPosts").withIndex("by_org_scheduled", (q) => q.eq("orgId", orgId).gte("scheduledFor", from).lte("scheduledFor", to)).collect();
    return rows.filter((r) => r.status !== "cancelled");
  },
});

export const get = query({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const post = await ctx.db.get(id);
    return post && post.orgId === orgId ? post : null;
  },
});

/** AI path: a Draft created by the rate-cut recommender or the ops brain.
 *  Skips platform validation when no accounts are connected yet (the owner
 *  picks accounts when they approve), so the draft still lands in the inbox. */
export const createInternal = internalMutation({
  args: { orgId: v.string(), ...postInput, sourceActionId: v.optional(v.id("opsActions")) },
  handler: async (ctx, { orgId, includeBookingLink, sourceActionId, ...rest }) => {
    const now = Date.now();
    const id = await ctx.db.insert("socialPosts", { orgId, ...rest, caption: stripEmDashes(rest.caption), status: "draft", submittedBy: "pulse-ai", sourceActionId, createdAt: now, updatedAt: now });
    if (includeBookingLink) await ctx.db.patch(id, { link: await linkFor(ctx, orgId, id, rest.roomId, rest.promoId) });
    return id;
  },
});

/** Cron: pull status for every scheduled post whose time has passed. */
export const scheduledDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("socialPosts").withIndex("by_org_status").collect();
    const due = rows.filter((r) => r.status === "scheduled" && r.scheduledFor <= Date.now() && r.ghlPostId && !r.ghlPostId.startsWith("simulated:"));
    const byOrg = new Map<string, typeof due>();
    for (const r of due) byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), r]);
    return [...byOrg.entries()].map(([orgId, posts]) => ({ orgId, posts: posts.map((p) => ({ id: p._id, ghlPostId: p.ghlPostId!, scheduledFor: p.scheduledFor })) }));
  },
});

export const syncStatusAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.runQuery(internal.marketing.posts.scheduledDue, {});
    for (const group of groups) {
      const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId: group.orgId });
      const g = ghlFromEnv(org);
      if (!g) continue;
      const accounts = await ctx.runQuery(internal.marketing.accounts.ghlAccountIdsForOrg, { orgId: group.orgId });
      const from = new Date(Math.min(...group.posts.map((p) => p.scheduledFor)) - 86_400_000).toISOString();
      const to = new Date().toISOString();
      const ghlPosts = await listPosts(g, { accountIds: accounts, fromDate: from, toDate: to });
      for (const p of group.posts) {
        const remote = ghlPosts.find((r) => r._id === p.ghlPostId);
        if (!remote) continue;
        const s = remote.status.toLowerCase();
        if (s === "published" || s === "success") {
          await ctx.runMutation(internal.marketing.posts.markStatus, { id: p.id, status: "published", publishedAt: remote.publishedAt ? Date.parse(remote.publishedAt) : Date.now() });
        } else if (s === "failed" || s === "error") {
          await ctx.runMutation(internal.marketing.posts.markStatus, { id: p.id, status: "failed", failure: remote.error ?? "GHL reported a failure." });
        }
      }
    }
  },
});
```

Add to `convex/marketing/accounts.ts`:

```ts
export const ghlAccountIdsForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db.query("socialAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    return rows.filter((r) => r.status !== "removed").map((r) => r.ghlAccountId);
  },
});
```

For simulated posts, the cron cannot know when they "publish". Add to `scheduledDue` a second list of simulated posts past their time and mark them `published` directly in `syncStatusAll` (so the demo studio shows results). Implement as: in `scheduledDue` also return `simulated: due-like list where ghlPostId starts with "simulated:"`, and at the top of `syncStatusAll` loop over them calling `markStatus` with `status: "published", publishedAt: scheduledFor`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run convex/marketing && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Register the cron**

In `convex/crons.ts` after the rate-cut sweep:

```ts
// Marketing: GHL has no post webhooks, so poll for published/failed.
crons.interval("social-status-sync", { minutes: 30 }, internal.marketing.posts.syncStatusAll, {});
```

- [ ] **Step 6: Commit**

```bash
git add convex/marketing/posts.ts convex/marketing/posts.test.ts convex/marketing/accounts.ts convex/crons.ts
git commit -m "Marketing: post lifecycle, GHL scheduling and status sync"
```

---

### Task 8: Results (attribution) query and account stats

**Files:**
- Create: `convex/marketing/results.ts`
- Modify: `convex/crons.ts`
- Test: `convex/marketing/results.test.ts`

**Interfaces:**
- Produces: `results.perPost({ from, to })` query → `{ postId, caption, template, publishedAt, clicks, bookings, revenueCents, redemptions }[]`; `results.refreshStatsAll` internal action (daily).

- [ ] **Step 1: Write the failing test**

`convex/marketing/results.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

const DAY = 86_400_000;

describe("marketing results", () => {
  it("counts clicks, bookings and revenue per post inside the 7-day window, postId over code", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      const promoA = await ctx.db.insert("promos", { orgId: "org1", code: "A20", pct: 20, startsAt: now - 10 * DAY, endsAt: now + 10 * DAY, redemptions: 0, source: "owner", active: true, createdBy: "u1", createdAt: now });
      const base = { orgId: "org1", template: "rate_promo" as const, status: "published" as const, caption: "A", media: [], accountIds: [], scheduledFor: now - 5 * DAY, timezone: "UTC", ghlType: "post" as const, submittedBy: "u1", createdAt: now, updatedAt: now };
      const postA = await ctx.db.insert("socialPosts", { ...base, promoId: promoA, publishedAt: now - 5 * DAY });
      const postB = await ctx.db.insert("socialPosts", { ...base, caption: "B", publishedAt: now - 5 * DAY });
      const visit = (extra: Record<string, unknown>) => ctx.db.insert("bookingVisits", { orgId: "org1", visitorKey: Math.random().toString(), step: "page", day: "2026-08-20", createdAt: now - 4 * DAY, ...extra } as never);
      await visit({ postId: postA }); await visit({ postId: postA }); await visit({ postId: postB });
      const booked = (extra: Record<string, unknown>) => ctx.db.insert("bookingVisits", { orgId: "org1", visitorKey: Math.random().toString(), step: "booked", day: "2026-08-21", createdAt: now - 3 * DAY, amountCents: 20000, ...extra } as never);
      await booked({ postId: postA });                 // link click
      await booked({ code: "A20" });                   // code only, still post A
      await booked({ postId: postB, code: "A20" });    // postId wins: post B
      await ctx.db.insert("bookingVisits", { orgId: "org1", visitorKey: "late", step: "booked", day: "2026-09-10", createdAt: now + 10 * DAY, amountCents: 99900, postId: postA } as never); // outside window
      return { postA, postB };
    });
    const owner = t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
    const rows = await owner.query(api.marketing.results.perPost, { from: now - 30 * DAY, to: now + 30 * DAY });
    const a = rows.find((r) => r.postId === ids.postA)!;
    const b = rows.find((r) => r.postId === ids.postB)!;
    expect(a).toMatchObject({ clicks: 2, bookings: 2, revenueCents: 40000, redemptions: 2 });
    expect(b).toMatchObject({ clicks: 1, bookings: 1, revenueCents: 20000 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/marketing/results.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `convex/marketing/results.ts`**

```ts
import { query, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { currentOrgWithCapability } from "../lib/tenant";
import { ghlFromEnv, accountStats } from "../lib/ghl";

const WINDOW = 7 * 86_400_000;

export const perPost = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.read");
    const posts = (await ctx.db.query("socialPosts").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "published")).collect())
      .filter((p) => (p.publishedAt ?? p.scheduledFor) >= from && (p.publishedAt ?? p.scheduledFor) <= to);
    if (posts.length === 0) return [];
    const promoCode = new Map<string, string>();
    for (const p of posts) {
      if (p.promoId) { const promo = await ctx.db.get(p.promoId); if (promo) promoCode.set(p._id, promo.code); }
    }
    const codeToPost = new Map<string, string>();
    for (const [postId, code] of promoCode) if (!codeToPost.has(code)) codeToPost.set(code, postId);
    const visits = await ctx.db.query("bookingVisits").withIndex("by_org_step", (q) => q.eq("orgId", orgId)).collect();
    const acc = new Map(posts.map((p) => [p._id as string, { clicks: 0, bookings: 0, revenueCents: 0, redemptions: 0 }]));
    const publishedAt = new Map(posts.map((p) => [p._id as string, p.publishedAt ?? p.scheduledFor]));
    for (const vRow of visits) {
      const byId = vRow.postId ? (vRow.postId as string) : undefined;
      const byCode = vRow.code ? codeToPost.get(vRow.code.toUpperCase()) : undefined;
      const target = byId && acc.has(byId) ? byId : byCode;
      if (!target) continue;
      const row = acc.get(target)!;
      const t0 = publishedAt.get(target)!;
      if (vRow.step === "page") { row.clicks += 1; continue; }
      if (vRow.step !== "booked") continue;
      if (vRow.createdAt < t0 || vRow.createdAt > t0 + WINDOW) continue;
      row.bookings += 1;
      row.revenueCents += vRow.amountCents ?? 0;
      if (vRow.code && promoCode.get(target) === vRow.code.toUpperCase()) row.redemptions += 1;
    }
    return posts.map((p) => ({ postId: p._id, caption: p.caption, template: p.template, publishedAt: p.publishedAt ?? p.scheduledFor, stats: p.stats, ...acc.get(p._id as string)! }))
      .sort((a, b) => b.publishedAt - a.publishedAt);
  },
});

export const orgsWithAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("socialAccounts").collect();
    const byOrg = new Map<string, { id: string; ghlAccountId: string }[]>();
    for (const r of rows) if (r.status === "connected") byOrg.set(r.orgId, [...(byOrg.get(r.orgId) ?? []), { id: r._id, ghlAccountId: r.ghlAccountId }]);
    return [...byOrg.entries()].map(([orgId, accounts]) => ({ orgId, accounts }));
  },
});

export const writeStats = internalMutation({
  args: { id: v.id("socialAccounts"), followers: v.optional(v.number()), reach: v.optional(v.number()) },
  handler: async (ctx, { id, followers, reach }) => {
    await ctx.db.patch(id, { stats: { followers, reach, refreshedAt: Date.now() } });
  },
});

export const refreshStatsAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.runQuery(internal.marketing.results.orgsWithAccounts, {});
    for (const g of groups) {
      const org = await ctx.runQuery(internal.marketing.accounts.orgContext, { orgId: g.orgId });
      const ghl = ghlFromEnv(org);
      if (!ghl) continue;
      const stats = await accountStats(ghl, g.accounts.map((a) => a.ghlAccountId));
      for (const a of g.accounts) {
        const s = stats[a.ghlAccountId];
        if (s) await ctx.runMutation(internal.marketing.results.writeStats, { id: a.id as never, followers: s.followers, reach: s.reach });
      }
    }
  },
});
```

Cron in `convex/crons.ts`:

```ts
crons.daily("social-stats", { hourUTC: 9, minuteUTC: 0 }, internal.marketing.results.refreshStatsAll, {});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run convex/marketing/results.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add convex/marketing/results.ts convex/marketing/results.test.ts convex/crons.ts
git commit -m "Marketing: per-post results with 7-day attribution and daily account stats"
```

---

### Task 9: AI drafts through the approval inbox

**Files:**
- Modify: `convex/opsActions.ts:271-345` (`approve`, `execute`), `:75-160` (`enrichmentContext` guards already narrow on `kind === "email"`)
- Modify: `convex/aiActions.ts:389-475` (`writeRateCutPromos`)
- Modify: `convex/opsBrain.ts` (`promote_underused_room` block near line 223)
- Modify: `src/app/(app)/inbox/page.tsx:29-46` (`AGENT_META`) and the payload line near 99
- Test: `convex/marketing/drafts.test.ts`

**Interfaces:**
- Consumes: `promos.createInternal`, `posts.createInternal`, `posts.approve` logic (re-implemented as internal mutation `posts.approveInternal({ id, actor })` so the inbox can approve without the caller's identity being re-resolved inside an action).
- Produces: `opsActions` rows of type `social_post_draft` with payload `{ kind: "social_post", postId }`; approving one approves and schedules the post.

- [ ] **Step 1: Write the failing test**

`convex/marketing/drafts.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";

describe("AI social drafts", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("approving a social_post_draft action approves and schedules the post", async () => {
    vi.stubEnv("GHL_API_KEY", "");
    const t = convexTest(schema);
    const now = Date.now();
    const { actionId, postId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u1", skills: [] });
      const ig = await ctx.db.insert("socialAccounts", { orgId: "org1", platform: "facebook", ghlAccountId: "acc", ghlLocationId: "loc", name: "FB", status: "connected", connectedBy: "u1", connectedAt: now });
      const postId = await ctx.db.insert("socialPosts", { orgId: "org1", template: "rate_promo", status: "draft", caption: "20% off Tuesdays", media: [], accountIds: [ig], scheduledFor: now + 3_600_000, timezone: "UTC", ghlType: "post", submittedBy: "pulse-ai", createdAt: now, updatedAt: now });
      const actionId = await ctx.db.insert("opsActions", { orgId: "org1", type: "social_post_draft", priority: "low", title: "Post: 20% off Tuesdays", rationale: "Room A is empty on Tuesday afternoons.", payload: { kind: "social_post", postId }, status: "proposed", autonomy: false, source: "rule", dedupeKey: `social_post_draft:${postId}`, createdAt: now });
      return { actionId, postId };
    });
    const owner = t.withIdentity({ subject: "u1", name: "Owner", orgId: "org1" });
    await owner.mutation(api.opsActions.approve, { id: actionId });
    await t.finishAllScheduledFunctions(() => {});
    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.status).toBe("scheduled");
    const action = await t.run((ctx) => ctx.db.get(actionId));
    expect(action?.status).toBe("executed");
  });

  it("the rate-cut sweep creates a promo and a draft post for each recommendation", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "S", slug: "studio", plan: "studio", status: "active" });
      await ctx.db.insert("rooms", { orgId: "org1", name: "Room A", status: "available", bookable: true, hourlyRateCents: 10000, minimumHours: 2, depositPct: 30 });
    });
    await t.action(internal.aiActions.generateRateCutPromosForOrg, { orgId: "org1" });
    const promos = await t.run((ctx) => ctx.db.query("promos").collect());
    const posts = await t.run((ctx) => ctx.db.query("socialPosts").collect());
    expect(promos.length).toBeGreaterThan(0);
    expect(posts.length).toBe(promos.length);
    expect(posts.every((p) => p.status === "draft" && p.template === "rate_promo" && p.promoId)).toBe(true);
    const actions = await t.run((ctx) => ctx.db.query("opsActions").collect());
    expect(actions.filter((a) => a.type === "social_post_draft").length).toBe(posts.length);
  });
});
```

If `rateCutContextForOrg` returns no recommendations for a fresh org with zero sessions (utilization is 0%, so it should recommend), adjust the seed to whatever `convex/aiContext.ts` needs (check `rateCutFor`: it analyses the last 8 weeks; an empty room yields 0% utilization and recommendations).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run convex/marketing/drafts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `approveInternal` to `convex/marketing/posts.ts`**

Refactor `approve` so its body lives in a shared function and add:

```ts
async function approvePost(ctx: MutationCtx, orgId: string, id: Id<"socialPosts">, actor: string) {
  /* the exact body of approve after the capability check, unchanged */
}

export const approve = mutation({
  args: { id: v.id("socialPosts") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "marketing.approve");
    await approvePost(ctx, orgId, id, await currentActor(ctx));
  },
});

export const approveInternal = internalMutation({
  args: { id: v.id("socialPosts"), orgId: v.string(), actor: v.string() },
  handler: async (ctx, { id, orgId, actor }) => { await approvePost(ctx, orgId, id, actor); },
});
```

- [ ] **Step 4: Teach `opsActions` about the new payload**

In `convex/opsActions.ts` `approve`, before `await ctx.db.patch(id, patch);` add:

```ts
    if (action.payload.kind === "social_post") {
      // Approving the inbox card approves the post itself; the post's own
      // guards (OK to feature, monthly cap, foreign accounts) run here.
      await approvePost(ctx, action.orgId, action.payload.postId, actor);
    }
```

Export `approvePost` from `convex/marketing/posts.ts` and import it. In `execute`, the `email` branch is untouched; `finalize` marks `executed` for a `social_post` payload with `result: "Post approved and scheduled"` (add a branch mirroring the email one that writes no `notifications` row).

- [ ] **Step 5: Rate-cut sweep writes a promo + draft + inbox card**

In `convex/aiActions.ts` `writeRateCutPromos`, inside the `for (const rec of data.recommendations)` loop, after `ensureDiscountCode` (keep it for the email path), add:

```ts
      // Marketing: the same recommendation as a time-boxed Promo plus a Draft
      // post in the approval inbox. Window = the next four weeks of that slot.
      const startsAt = Date.now();
      const endsAt = startsAt + 28 * 86_400_000;
      const promoId = await ctx.runMutation(internal.promos.createInternal, {
        orgId: data.orgId, code: rec.discountCode, pct: rec.cutPct, label: `${rec.roomName} ${rec.windowLabel}`,
        startsAt, endsAt, roomId: rec.roomId, source: "rate_cut",
      });
      const caption = `${rec.windowLabel} in ${rec.roomName} is open. Book it for ${rec.cutPct}% off with code ${rec.discountCode}: ${fmtCents(rec.newRateCents)}/hr instead of ${fmtCents(rec.currentRateCents)}/hr. Link in bio or tap the link.`;
      const postId = await ctx.runMutation(internal.marketing.posts.createInternal, {
        orgId: data.orgId, template: "rate_promo", caption, media: [{ type: "image", brandCard: "promo" }],
        accountIds: [], scheduledFor: Date.now() + 26 * 3_600_000, timezone: "America/Los_Angeles",
        promoId, roomId: rec.roomId, ghlType: "post", includeBookingLink: true,
      });
      await ctx.runMutation(internal.opsActions.insertInternal, {
        orgId: data.orgId, type: "social_post_draft", priority: "low",
        title: `Post: ${rec.cutPct}% off ${rec.roomName}, ${rec.windowLabel}`,
        rationale: `${rec.roomName} runs ${rec.lowUtilHours}h under 40% utilization in that window. A promo post with code ${rec.discountCode} fills it.`,
        entityType: "socialPost", entityId: postId,
        payload: { kind: "social_post", postId }, dedupeKey: `social_post_draft:${rec.roomId}:${rec.discountCode}`,
      });
```

`internal.opsActions.insertInternal` does not exist yet: add to `convex/opsActions.ts` an `internalMutation` that inserts a `proposed`, `autonomy: false`, `source: "rule"` row and skips when an open row with the same `dedupeKey` exists (use the `by_org_dedupe` index; open = status `proposed` or `snoozed`). `accountIds: []` on the draft is allowed because `createInternal` skips platform validation; the owner picks accounts in the composer before approving (the composer's Approve button calls `posts.update` then `posts.approve`).

In `convex/opsBrain.ts`, the `promote_underused_room` block stays as is (note only). No draft there in v1; the weekly rate-cut sweep is the draft source.

- [ ] **Step 6: Inbox label**

In `src/app/(app)/inbox/page.tsx` `AGENT_META` add:

```ts
  social_post_draft: { label: "Social Post", group: "Marketing", order: 12 },
```

Near line 99 where `note_only` renders, add a branch: `{p.kind === "social_post" && <a href={`/marketing/compose?post=${p.postId}`} className="underline">open in composer</a>}`.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run convex/marketing convex/opsBrain.test.ts convex/aiDeliverability.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add convex/opsActions.ts convex/aiActions.ts convex/marketing/posts.ts convex/marketing/drafts.test.ts "src/app/(app)/inbox/page.tsx"
git commit -m "Marketing: rate-cut sweep drafts a promo post into the approval inbox"
```

---

### Task 10: Brand Card image route

**Files:**
- Create: `src/app/api/brand-card/[postId]/route.tsx`
- Create: `convex/marketing/brandCard.ts` (public query for the card data, safe fields only)
- Test: manual (`curl -o card.png "http://localhost:3311/api/brand-card/<id>?kind=promo"`) plus a unit test for the data query

**Interfaces:**
- Produces: `GET /api/brand-card/[postId]?kind=rate_card|open_slot|promo&v=<n>` → PNG 1080x1350; `brandCard.data({ postId })` public query returning `{ studioName, accent, logoUrl, roomName, rateLabel, promoCode, promoPct, windowLabel, kind }` for a post that exists in any org (no secrets; the id is unguessable).

- [ ] **Step 1: Data query test**

Append to `convex/marketing/results.test.ts` or create `convex/marketing/brandCard.test.ts`:

```ts
it("brand card data exposes only display fields", async () => {
  const t = convexTest(schema);
  const now = Date.now();
  const postId = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "org1", name: "Slang City", slug: "slang", plan: "studio", status: "active", accentColor: "#FDB913" });
    const room = await ctx.db.insert("rooms", { orgId: "org1", name: "Room A", status: "available", bookable: true, hourlyRateCents: 8000, minimumHours: 2, depositPct: 30 });
    const promo = await ctx.db.insert("promos", { orgId: "org1", code: "TUE20", pct: 20, label: "Tuesday afternoons", startsAt: now, endsAt: now + 86_400_000, redemptions: 0, source: "owner", active: true, createdBy: "u1", createdAt: now });
    return await ctx.db.insert("socialPosts", { orgId: "org1", template: "rate_promo", status: "draft", caption: "x", media: [], accountIds: [], scheduledFor: now, timezone: "UTC", ghlType: "post", submittedBy: "u1", createdAt: now, updatedAt: now, promoId: promo, roomId: room });
  });
  const d = await t.query(api.marketing.brandCard.data, { postId });
  expect(d).toEqual({ studioName: "Slang City", accent: "#FDB913", logoUrl: null, roomName: "Room A", rateLabel: "$80/hr", promoCode: "TUE20", promoPct: 20, windowLabel: "Tuesday afternoons" });
});
```

- [ ] **Step 2: Implement `convex/marketing/brandCard.ts`**

```ts
import { query } from "../_generated/server";
import { v } from "convex/values";

export const data = query({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", post.orgId)).first();
    if (!org) return null;
    const room = post.roomId ? await ctx.db.get(post.roomId) : null;
    const promo = post.promoId ? await ctx.db.get(post.promoId) : null;
    const logoUrl = org.logoId ? await ctx.storage.getUrl(org.logoId) : null;
    const rate = room?.hourlyRateCents ?? 0;
    return {
      studioName: org.name,
      accent: org.accentColor ?? "#FDB913",
      logoUrl,
      roomName: room?.name ?? null,
      rateLabel: rate ? `$${Math.round(rate / 100)}/hr` : null,
      promoCode: promo?.code ?? null,
      promoPct: promo?.pct ?? null,
      windowLabel: promo?.label ?? null,
    };
  },
});
```

- [ ] **Step 3: Implement the route**

`src/app/api/brand-card/[postId]/route.tsx`:

```tsx
import { ImageResponse } from "next/og";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export const runtime = "nodejs";
const W = 1080, H = 1350;

export async function GET(req: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const kind = new URL(req.url).searchParams.get("kind") ?? "promo";
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const d = await client.query(api.marketing.brandCard.data, { postId: postId as Id<"socialPosts"> });
  if (!d) return new Response("Not found", { status: 404 });
  const accent = d.accent;
  const headline =
    kind === "rate_card" ? (d.rateLabel ?? "Book the room")
    : kind === "open_slot" ? "This slot is open"
    : d.promoPct ? `${d.promoPct}% off` : "Book now";
  const sub =
    kind === "rate_card" ? (d.roomName ?? d.studioName)
    : kind === "open_slot" ? (d.windowLabel ?? d.roomName ?? "")
    : [d.roomName, d.windowLabel].filter(Boolean).join(", ");
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 96, background: "#0b0b0c", color: "#f5f5f4", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {d.logoUrl ? <img src={d.logoUrl} width={96} height={96} style={{ borderRadius: 24, objectFit: "cover" }} /> : null}
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{d.studioName}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 168, fontWeight: 800, lineHeight: 0.95, letterSpacing: -6, color: accent }}>{headline}</div>
          <div style={{ fontSize: 56, fontWeight: 500, opacity: 0.9 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          {d.promoCode && kind !== "rate_card" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 28, opacity: 0.7, letterSpacing: 4 }}>CODE</div>
              <div style={{ fontSize: 72, fontWeight: 800, padding: "12px 32px", border: `4px solid ${accent}`, borderRadius: 20 }}>{d.promoCode}</div>
            </div>
          ) : <div />}
          <div style={{ fontSize: 28, opacity: 0.6 }}>Book online</div>
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  );
}
```

The `v=` query param from `payloadContext` busts the cache when the post changes. The card is Studio-branded only (no Pulse mark), per the glossary.

- [ ] **Step 4: Run tests, typecheck, manual check**

Run: `npx vitest run convex/marketing && npm run typecheck`, then `PORT=3311 npm run dev` and open `http://localhost:3311/api/brand-card/<a draft post id>?kind=promo`. Expected: a 1080x1350 PNG with the studio name, headline in the accent colour, and the code box.

- [ ] **Step 5: Commit**

```bash
git add convex/marketing/brandCard.ts convex/marketing/brandCard.test.ts "src/app/api/brand-card/[postId]/route.tsx"
git commit -m "Marketing: studio-branded promo, open-slot and rate cards as PNG"
```

---

### Task 11: Nav, route gate, and Accounts page

**Files:**
- Modify: `src/lib/nav.ts:55-66`, `src/lib/features.ts:22-45`
- Create: `src/app/(app)/marketing/layout.tsx`, `src/app/(app)/marketing/accounts/page.tsx`, `src/components/social/connect-button.tsx`, `src/components/social/account-row.tsx`, `src/components/social/platforms.ts`

**Interfaces:**
- Consumes: `api.marketing.accounts.{startConnect, choices, attach, list, remove}`.
- Produces: `PLATFORM_META: Record<Platform, { label: string; icon: LucideIcon; color: string }>` in `platforms.ts`; `<ConnectButton platform />` component that runs the popup + postMessage flow.

- [ ] **Step 1: Nav + gate**

In `src/lib/nav.ts` add after the Releases entry:

```ts
  { label: "Marketing", href: "/marketing", icon: Megaphone, blurb: "Scheduled posts, promos and results", feature: "marketing", capability: "marketing.read" },
```

(import `Megaphone` from `lucide-react`). In `src/lib/features.ts` `featureForPath` map add `marketing: "marketing",`.

- [ ] **Step 2: Platform metadata**

`src/components/social/platforms.ts`:

```ts
import { Globe, Facebook, Instagram, Linkedin, Music2, Youtube, Pin, AtSign, Cloud, type LucideIcon } from "lucide-react";
import type { Platform } from "@convex/lib/ghl";

export const PLATFORM_META: Record<Platform, { label: string; icon: LucideIcon; hint: string }> = {
  google: { label: "Google Business Profile", icon: Globe, hint: "Offer posts with a coupon code and a Book button" },
  facebook: { label: "Facebook Page", icon: Facebook, hint: "Photos, video or text" },
  instagram: { label: "Instagram", icon: Instagram, hint: "Photo, carousel or Reel. Links are not clickable." },
  linkedin: { label: "LinkedIn", icon: Linkedin, hint: "Page or profile" },
  tiktok: { label: "TikTok", icon: Music2, hint: "Video only" },
  "tiktok-business": { label: "TikTok Business", icon: Music2, hint: "Video only" },
  youtube: { label: "YouTube", icon: Youtube, hint: "Video only" },
  pinterest: { label: "Pinterest", icon: Pin, hint: "One image with a link" },
  threads: { label: "Threads", icon: AtSign, hint: "500 characters" },
  bluesky: { label: "Bluesky", icon: Cloud, hint: "300 characters, up to 4 photos" },
};
export const PLATFORM_ORDER: Platform[] = ["instagram", "facebook", "google", "tiktok", "tiktok-business", "youtube", "linkedin", "threads", "pinterest", "bluesky"];
```

- [ ] **Step 3: Connect button (popup + postMessage)**

`src/components/social/connect-button.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Platform } from "@convex/lib/ghl";
import { Button } from "@/components/ui/button";
import { PLATFORM_META } from "./platforms";

type Choice = { id: string; name: string; type?: string };

/** Opens GHL's OAuth page in a popup and listens for its postMessage
 *  ({ actionType: "close", page: "social-media-posting", platform, accountId }),
 *  then lets the owner pick which page/profile to attach. */
export function ConnectButton({ platform, disabled }: { platform: Platform; disabled?: boolean }) {
  const start = useAction(api.marketing.accounts.startConnect);
  const choices = useAction(api.marketing.accounts.choices);
  const attach = useAction(api.marketing.accounts.attach);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<{ ghlAccountId: string; list: Choice[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);
  const meta = PLATFORM_META[platform];

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { actionType?: string; page?: string; platform?: string; accountId?: string } | undefined;
      if (!d || d.actionType !== "close" || d.page !== "social-media-posting" || !d.accountId) return;
      if (d.platform && d.platform !== platform) return;
      popup.current?.close();
      void (async () => {
        try {
          const list = await choices({ platform, ghlAccountId: d.accountId! });
          if (list.length === 1) await finish(d.accountId!, list[0]);
          else setOptions({ ghlAccountId: d.accountId!, list });
        } catch (err) { setError(err instanceof Error ? err.message : "Could not read the connected account."); }
        finally { setBusy(false); }
      })();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [platform, choices]);

  async function finish(ghlAccountId: string, choice: Choice) {
    await attach({ platform, ghlAccountId, choice });
    setOptions(null);
  }

  async function begin() {
    setBusy(true); setError(null);
    try {
      const r = await start({ platform });
      if ("simulated" in r) { setError("Social publishing is not configured on this server yet."); setBusy(false); return; }
      popup.current = window.open(r.url, "pulse-connect", "width=640,height=760");
      if (!popup.current) { setError("Your browser blocked the popup. Allow popups for Pulse and try again."); setBusy(false); }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start the connection."); setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={begin} disabled={disabled || busy} variant="secondary">
        <meta.icon className="size-4" /> Connect {meta.label}
      </Button>
      {options && (
        <ul className="flex flex-col gap-1 rounded-xl bg-[var(--surface-container-low)] p-2">
          {options.list.map((c) => (
            <li key={c.id}>
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white" onClick={() => void finish(options.ghlAccountId, c)}>{c.name}</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-[var(--error)]">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Accounts page**

`src/app/(app)/marketing/layout.tsx`: a small tab strip (Calendar `/marketing`, Compose `/marketing/compose`, Accounts `/marketing/accounts`, Promos `/marketing/promos`, Results `/marketing/results`) using `PageHeader` from `@/components/ui/page`, rendering `children` below.

`src/app/(app)/marketing/accounts/page.tsx`:

```tsx
"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Section } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/feedback";
import { ConnectButton } from "@/components/social/connect-button";
import { PLATFORM_META, PLATFORM_ORDER } from "@/components/social/platforms";
import { Button } from "@/components/ui/button";

export default function AccountsPage() {
  const accounts = useQuery(api.marketing.accounts.list, {});
  const remove = useMutation(api.marketing.accounts.remove);
  return (
    <>
      <Section title="Connected accounts" blurb="Your studio's own profiles. Pulse posts to these on your schedule.">
        {accounts === undefined ? null : accounts.length === 0 ? (
          <EmptyState title="Nothing connected yet" body="Connect Instagram or Facebook first. Google Business Profile gets you the Book button and coupon offers." />
        ) : (
          <ul className="flex flex-col gap-2">
            {accounts.map((a) => {
              const m = PLATFORM_META[a.platform];
              return (
                <li key={a._id} className="flex items-center justify-between rounded-xl bg-white px-4 py-3">
                  <div className="flex items-center gap-3">
                    <m.icon className="size-5" />
                    <div>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs opacity-70">{m.label}{a.stats?.followers ? ` · ${a.stats.followers.toLocaleString("en-US")} followers` : ""}{a.status === "needs_reconnect" ? " · needs reconnect" : ""}</div>
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => void remove({ id: a._id })}>Remove</Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Add an account">
        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORM_ORDER.map((p) => <ConnectButton key={p} platform={p} />)}
        </div>
      </Section>
    </>
  );
}
```

- [ ] **Step 5: Typecheck, lint, run**

Run: `npm run typecheck && npm run lint`, then `PORT=3311 npm run dev`, open `/marketing/accounts` in the demo studio. Expected: nav shows Marketing; the page renders; Connect buttons show "not configured" in dev demo mode (no GHL env), which is correct.

- [ ] **Step 6: Commit**

```bash
git add src/lib/nav.ts src/lib/features.ts "src/app/(app)/marketing" src/components/social
git commit -m "Marketing: nav entry, route gate, connected accounts page with GHL popup flow"
```

---

### Task 12: Composer

**Files:**
- Create: `src/app/(app)/marketing/compose/page.tsx`, `src/components/social/composer.tsx`, `src/components/social/template-picker.tsx`, `src/components/social/media-picker.tsx`, `src/components/social/schedule-picker.tsx`, `src/components/social/rules-preview.ts`
- Modify: `convex/marketing/posts.ts` (add `generateUploadUrl` mutation gated on `marketing.edit`; add `suggestCaption` action using `complete()` from `convex/lib/openai.ts`)

**Interfaces:**
- Consumes: `api.marketing.posts.{create, update, approve, get}`, `api.marketing.accounts.list`, `api.promos.list`, `api.rooms.list` (existing), `api.artists.list` (existing), `validateForPlatform` (client-side import from `@convex/marketing/rules` for live warnings).
- Produces: `/marketing/compose?post=<id>` edits an existing draft; `/marketing/compose?template=rate_promo&promo=<id>` prefills.

- [ ] **Step 1: Backend helpers**

In `convex/marketing/posts.ts` add:

```ts
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrgWithCapability(ctx, "marketing.edit");
    return await ctx.storage.generateUploadUrl();
  },
});

export const suggestCaption = action({
  args: { template: v.string(), facts: v.string(), platform: v.optional(v.string()) },
  handler: async (ctx, { template, facts, platform }) => {
    await ctx.runQuery(api.marketing.accounts.whoAmI, {}); // auth
    const limit = platform === "bluesky" ? 280 : platform === "threads" ? 480 : 600;
    const ai = await complete(
      `Write a social caption for a recording studio. Template: ${template}. Facts:\n${facts}\n\nUnder ${limit} characters. One idea, one call to action. No hashtags spam (max 3). Output only the caption.`,
      { system: "You are the social voice of an indie recording studio: warm, specific, never salesy.", maxOutputTokens: 300 },
    );
    return ai?.text?.trim() ?? null;
  },
});
```

(`action` and `complete` imports: `import { action } from "../_generated/server"; import { complete } from "../lib/openai";`.) Without `OPENAI_API_KEY` this returns null and the composer keeps the owner's text.

- [ ] **Step 2: Template picker**

`src/components/social/template-picker.tsx`: nine cards from a constant:

```ts
export const TEMPLATES = [
  { key: "session_bts", label: "Session behind the scenes", hint: "A clip or photo from a session in progress" },
  { key: "before_after", label: "Before / after", hint: "Rough take vs final mix" },
  { key: "client_win", label: "Client win", hint: "Release day or a testimonial. Needs the artist's OK." },
  { key: "room_gear", label: "Room + gear", hint: "A room, a mic, a chain" },
  { key: "tip", label: "Tip", hint: "One thing you fix every week" },
  { key: "rate_promo", label: "Rate promo", hint: "A code with a window. Uses a brand card." },
  { key: "open_slot", label: "Open slot", hint: "A specific day and time that is free" },
  { key: "engineer_story", label: "Engineer story", hint: "Why this room, who runs it" },
  { key: "custom", label: "Custom", hint: "Start blank" },
] as const;
```

Renders a `grid` of buttons; `onPick(key)`.

- [ ] **Step 3: Media picker**

`src/components/social/media-picker.tsx`: accepts `value: MediaItem[]`, `onChange`, `template`. Uses `PhotoUpload` from `@/components/ui/photo-upload` with `generateUploadUrl={() => generateUploadUrl({})}` and `onStorageId={(id) => onChange([...value, { storageId: id, type: "image" }])}` (video: same with `accept="video/mp4"` and `type: "video"`, add an `accept` prop to `PhotoUpload` if it has none). For `rate_promo`, `open_slot`, and a "Rate card" toggle, it offers "Use a brand card" which adds `{ brandCard: "promo" | "open_slot" | "rate_card", type: "image" }`. Preview a brand card with `<img src={`/api/brand-card/${postId}?kind=...`} />` once the draft exists; before that show a placeholder tile reading "Brand card renders after you save the draft".

- [ ] **Step 4: Schedule picker**

`src/components/social/schedule-picker.tsx`: date + time inputs (native `<input type="datetime-local">` is acceptable for v1; wrap in the `Field` component from `@/components/ui/field`) plus three suggestion chips computed from the studio timezone: next Tuesday 18:00, next Thursday 18:00, next Saturday 10:00. Emits `{ scheduledFor: number; timezone: string }`. Timezone defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`.

- [ ] **Step 5: Composer**

`src/components/social/composer.tsx` holds the state machine: template → media → caption (textarea, "Draft with AI" button calling `suggestCaption` with facts assembled from the chosen room/promo) → accounts (checkbox list from `accounts.list`, each showing live warnings from `validateForPlatform(platform, { caption, media: media.map(m => m.type), hasLink })`) → promo (select from `promos.list`, only for `rate_promo` and `open_slot`; a "New promo" link to `/marketing/promos`) → artist (select, only for `client_win`; shows "OK to feature" state) → schedule → footer with two buttons: **Save draft** (calls `create` or `update`) and, when the viewer has `marketing.approve` (read from `useQuery(api.orgs.current)` role, or attempt and surface the error), **Approve and schedule** (calls `update` then `approve`). `includeBookingLink` is a toggle defaulting to true except for Instagram-only selections (where the caption gets "Link in bio" appended instead).

`src/app/(app)/marketing/compose/page.tsx` reads `?post`, `?template`, `?promo` from `useSearchParams()` and renders `<Composer initialPostId template promoId />`.

- [ ] **Step 6: Typecheck, lint, run**

Run: `npm run typecheck && npm run lint`, then in the dev demo (`PORT=3311 npm run dev`) create a draft with the `open_slot` template and a brand card, save, reopen via `/marketing/compose?post=<id>`, approve. Expected: the post appears on the calendar as `scheduled` with `ghlPostId` `simulated:` and `link` containing `?src=`.

- [ ] **Step 7: Commit**

```bash
git add convex/marketing/posts.ts "src/app/(app)/marketing/compose" src/components/social
git commit -m "Marketing: composer with templates, media, AI caption, per-platform warnings and scheduling"
```

---

### Task 13: Calendar, Promos and Results pages

**Files:**
- Create: `src/app/(app)/marketing/page.tsx` (calendar), `src/app/(app)/marketing/promos/page.tsx`, `src/app/(app)/marketing/results/page.tsx`, `src/components/social/post-chip.tsx`, `src/components/social/promo-dialog.tsx`

**Interfaces:**
- Consumes: `api.marketing.posts.{list, cancel, approve}`, `api.promos.{list, create, update, deactivate}`, `api.marketing.results.perPost`, `api.rooms.list`.

- [ ] **Step 1: Calendar**

`src/app/(app)/marketing/page.tsx`: month grid (7 columns, weeks as rows) built from `date-fns`-free arithmetic (the repo's `@/lib/format` has `shortDate`; compute month bounds manually). Query `posts.list({ from: monthStart, to: monthEnd })`. Each day cell lists `<PostChip>`s: caption first 40 chars, status pill colours `draft` neutral, `approved` info, `scheduled` gold, `published` positive, `failed` critical. Clicking a chip opens a `Sheet` (from `@/components/ui/sheet`) with the full caption, accounts, link, failure text, and buttons: Edit (route to composer), Approve (draft only, `marketing.approve`), Cancel (not published), Retry (failed: calls `approve` again). Header stat tiles (`StatTile`): scheduled this month, published this month, drafts awaiting approval, bookings from posts (from `results.perPost` for the month).

- [ ] **Step 2: Promos**

`src/app/(app)/marketing/promos/page.tsx`: table (`@/components/ui/table`) of `promos.list`: code, pct, window (start to end), room or "All rooms", redemptions (`x / cap` or `x`), source pill (Owner / AI), active toggle (calls `deactivate`), and a "Post this" button linking to `/marketing/compose?template=rate_promo&promo=<id>`. "New promo" opens `promo-dialog.tsx` (Dialog from `@/components/ui/dialog`): code, percent, label, starts, ends, room select, max redemptions. Copy: "Codes are uppercase. A promo ends at the exact time you set."

- [ ] **Step 3: Results**

`src/app/(app)/marketing/results/page.tsx`: date range chips (Last 7 days, 30 days, 90 days), table from `results.perPost`: post (caption, template label, published date), clicks, bookings, revenue (`$` from cents), code redemptions, and GHL impressions/engagements when `stats` exists. Footer line: "A booking counts when it started from the post's link or used its code within 7 days of publishing." Empty state: "Publish a post with a booking link to see results here."

- [ ] **Step 4: Typecheck, lint, run**

Run: `npm run typecheck && npm run lint && npm test`. In the dev demo: create a promo, post it, approve, check it lands on the calendar, open results.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/marketing" src/components/social
git commit -m "Marketing: calendar, promos and results pages"
```

---

### Task 14: Env, artist consent toggle, and rollout checks

**Files:**
- Modify: `src/components/roster/*` artist profile panel (find the panel that edits `instagram` on an artist; add an "OK to feature in posts" toggle) and `convex/artists.ts` (`update` mutation accepts `okToFeature`)
- Modify: `.env.example` (if present) and the deploy runbook note in `docs/superpowers/plans/` (this file's footer)
- Test: `convex/artists.test.ts` if present (one assertion that `okToFeature` round-trips)

- [ ] **Step 1: Artist toggle**

In `convex/artists.ts` find the artist update mutation and add `okToFeature: v.optional(v.boolean())` to its args and patch. In the roster artist panel add a `Toggle` (from `@/components/ui/toggle`) labelled "OK to feature in the studio's posts" with hint "Ask the artist first. Client-win posts need this on."

- [ ] **Step 2: Environment**

Convex env (prod and dev deployments): `GHL_API_KEY` and `GHL_LOCATION_ID` already exist for SMS. Add `GHL_SOCIAL_USER_ID` (the "Pulse" user's id in the Myind Sound location: GHL Settings → My Staff → the user → id in the URL) and `PULSE_PUBLIC_HOST=https://pulse.myindsound.com`. Add the `socialplanner/*` scopes to the existing Private Integration (Lawrence confirmed Social Planner is enabled on the connector). Netlify: `NEXT_PUBLIC_CONVEX_URL` already set (the brand-card route uses it).

- [ ] **Step 3: Prove the connector once**

From a Convex dashboard "Run function" on `marketing.accounts.startConnect` as an owner of Myind Sound with `{ platform: "facebook" }`. Expected: `{ url: "https://..." }`. A `GHL_UNAVAILABLE` error means the scopes are missing or the `userId` is wrong; fix and rerun. Record the outcome in `Grilled.md` open question 1.

- [ ] **Step 4: Full suite and commit**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

```bash
git add convex/artists.ts src/components/roster
git commit -m "Artists: OK-to-feature consent for client-win posts"
```

- [ ] **Step 5: Ship behind the module flag**

Marketing is on for every paid tier by entitlement. For the first week keep it visible only to Myind Sound and Slang City by leaving the module switched off for other orgs (the existing per-org module toggle in Settings → Modules; `isToggleable("marketing")` is true because it is not `core`). After a week of real posts, flip it on everywhere.

---

## Self-review

**Spec coverage**
- Schema, per-org `ghl`, `okToFeature`, `bookingVisits.postId`, `opsActions` payload: Task 1.
- GHL client with per-org resolution and simulated mode: Task 2.
- Promo model, checkout precedence, redemption counter, `expiresAt` on `validateCode`: Task 3.
- Tracked link and `src` attribution end to end: Tasks 4, 7.
- Per-platform rules: Task 5.
- Accounts (start / choices / attach / list / remove / caps / cross-org invariant): Task 6.
- Post lifecycle, GHL scheduling, GBP offer details, TikTok privacy, status sync cron, failure alerts via `activity`: Task 7.
- Results with 7-day window and `postId` over `code`; daily stats: Task 8.
- AI drafts into the inbox; rate-cut sweep creates promo + draft; inbox label: Task 9.
- Brand cards: Task 10.
- Nav, gate, accounts UI, composer, calendar, promos, results: Tasks 11 to 13.
- Artist consent UI, env, connector proof, rollout: Task 14.
- Not in plan on purpose (spec out of scope): ads, native APIs, auto-publish, AI imagery, evergreen queues.

**Type consistency**
- `ghlFromEnv(org)` takes `{ ghl?: { locationId, tokenRef } } | null`; `orgContext` returns that shape plus `slug`/`name`, which is a superset: fine.
- `markStatus` status union covers `scheduled | published | failed | approved`; `schedule` and `syncStatusAll` only use those.
- `resolveCode` returns `promoId?` and `expiresAt?`; `validateCode` spreads `expiresAt` only when set so `discountCodes.test.ts` exact-shape assertions hold.
- `approvePost` is shared by `posts.approve`, `posts.approveInternal`, and `opsActions.approve`.
- `recordBooked` `extra.postId` type is `Id<"socialPosts">`; `createBooking` resolves `src` to that type before passing.

**Placeholder scan**: none. The `postInput` block in Task 7 is written once in its Interfaces section and referenced by name inside the code block; copy it verbatim when implementing.
