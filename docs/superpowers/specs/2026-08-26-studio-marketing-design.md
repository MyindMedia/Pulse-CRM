# Studio Marketing: scheduled social posts + promos via GHL Social Planner

**Date:** 2026-08-26
**Status:** Draft (design), awaiting owner review
**Area:** Marketing (new `convex/marketing/*`, `convex/lib/ghl.ts` new, `convex/promos.ts` new, `convex/booking.ts`, `convex/aiActions.ts`, `convex/opsBrain.ts`, `convex/lib/plans.ts`, `convex/lib/modules.ts`, `convex/schema.ts`, `src/app/(app)/marketing/*` new)
**Alignment:** `../../../Grilled.md` (decisions), `../../../pulse/CONTEXT.md` (glossary), `../../../Pulse Studio Marketing Research (2026-08-26).md` (research)

## Problem

Studios have no way to market themselves from Pulse. The pieces that would feed marketing already exist and sit idle as email drafts: owner discount codes, the weekly AI rate-cut recommender, `rate_cut_promo` artifacts, a booking page that pre-fills `?code=`, and `bookingVisits` attribution. No studio-management competitor ships social scheduling; adjacent booking SaaS (Fresha, Vagaro, Booksy) charge 20 to 30% commissions to fill empty slots. Lawrence's constraint is $0 recurring cost.

## Decision

Build Marketing as a Pulse-owned surface (composer, calendar, results) on top of the GoHighLevel Social Planner API, using the GHL location Pulse already pays for. Studios connect their own accounts from inside Pulse through GHL's OAuth popup and never log into GHL. Promos become a first-class time-boxed record that checkout honours alongside legacy discount codes. Every AI-generated post is a Draft that a Studio owner or manager approves. Attribution is per post: tracked link or promo code, 7-day window.

The GHL client is written per-org from day one (`{locationId, token}` resolved per org, defaulting to the Myind Sound location and the existing PIT) so a studio can be moved to its own GHL sub-account later by setting two fields.

## Backend

### Schema

```ts
// Which GHL location + token an org publishes through. Absent = platform default.
// On orgs:
ghl: v.optional(v.object({
  locationId: v.string(),
  tokenRef: v.string(),          // name of the env var holding the PIT, never the token itself
})),

socialAccounts: defineTable({
  orgId: v.string(),
  platform: v.union(
    v.literal("google"), v.literal("facebook"), v.literal("instagram"),
    v.literal("linkedin"), v.literal("tiktok"), v.literal("tiktok-business"),
    v.literal("youtube"), v.literal("pinterest"), v.literal("threads"), v.literal("bluesky"),
  ),
  ghlAccountId: v.string(),      // GHL's id for the connected profile/page
  ghlLocationId: v.string(),     // the location it was attached under
  name: v.string(),
  avatarUrl: v.optional(v.string()),
  status: v.union(v.literal("connected"), v.literal("needs_reconnect"), v.literal("removed")),
  connectedBy: v.string(),       // userId
  connectedAt: v.number(),
  lastCheckedAt: v.optional(v.number()),
  stats: v.optional(v.object({ followers: v.optional(v.number()), reach: v.optional(v.number()), refreshedAt: v.number() })),
})
  .index("by_org", ["orgId"])
  .index("by_ghl_account", ["ghlAccountId"]),   // must be unique: one org per account

promos: defineTable({
  orgId: v.string(),
  code: v.string(),              // normalized uppercase, unique per org while active
  pct: v.number(),               // 1..100
  label: v.optional(v.string()),
  startsAt: v.number(),
  endsAt: v.number(),
  roomId: v.optional(v.id("rooms")),
  maxRedemptions: v.optional(v.number()),
  redemptions: v.number(),       // counter, written by booking
  source: v.union(v.literal("owner"), v.literal("rate_cut")),
  active: v.boolean(),
  createdBy: v.string(),
  createdAt: v.number(),
})
  .index("by_org", ["orgId"])
  .index("by_org_code", ["orgId", "code"]),

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
  captionOverrides: v.optional(v.record(v.string(), v.string())), // platform -> caption
  media: v.array(v.object({
    storageId: v.optional(v.id("_storage")),   // uploaded
    brandCard: v.optional(v.string()),         // "rate_card" | "open_slot" | "promo"; rendered on demand
    type: v.union(v.literal("image"), v.literal("video")),
  })),
  accountIds: v.array(v.id("socialAccounts")),
  scheduledFor: v.number(),
  timezone: v.string(),
  promoId: v.optional(v.id("promos")),
  link: v.optional(v.string()),  // full tracked URL, built server-side
  artistId: v.optional(v.id("artists")),        // client_win only; requires artist.okToFeature
  sourceActionId: v.optional(v.id("opsActions")), // when AI-drafted
  ghlPostId: v.optional(v.string()),
  ghlType: v.union(v.literal("post"), v.literal("story"), v.literal("reel")),
  submittedBy: v.string(),
  approvedBy: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  publishedAt: v.optional(v.number()),
  failure: v.optional(v.string()),
  stats: v.optional(v.object({           // from GHL statistics, if per-post metrics exist
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

// bookingVisits gains one optional field:
postId: v.optional(v.id("socialPosts")),   // ?src=<postId>

// artists gains one optional field:
okToFeature: v.optional(v.boolean()),
```

`orgs.discountCodes` is untouched.

### GHL client (`convex/lib/ghl.ts`)

One module replaces the inline fetch in `lib/sms.ts` over time; `sms.ts` keeps working as is for now.

```ts
type GhlCtx = { locationId: string; token: string; userId: string };
export async function ghlFor(ctx, orgId): Promise<GhlCtx | null>
  // org.ghl ? env[org.ghl.tokenRef] + org.ghl.locationId : GHL_API_KEY + GHL_LOCATION_ID
  // userId = GHL_SOCIAL_USER_ID (the "Pulse" service user). null = simulated mode.
export async function ghlFetch(g: GhlCtx, path, init, version = "2021-07-28")
  // Authorization, Version, User-Agent "Pulse/1.0 (+https://pulse.myindsound.com)"
```

Social Planner calls used:

| Purpose | Call |
|---|---|
| Start OAuth | `GET /social-media-posting/oauth/{platform}/start?locationId&userId` |
| List accounts under an OAuth result | `GET /social-media-posting/oauth/{locationId}/{platform}/accounts/{accountId}` |
| Attach chosen page/profile | `POST /social-media-posting/oauth/{locationId}/{platform}/accounts/{accountId}` |
| List connected accounts | `GET /social-media-posting/{locationId}/accounts` |
| Remove account | `DELETE /social-media-posting/{locationId}/accounts/{id}` |
| Create scheduled post | `POST /social-media-posting/{locationId}/posts` |
| Read / edit / delete post | `GET`/`PUT`/`DELETE /social-media-posting/{locationId}/posts/{id}` |
| List posts (status sync) | `POST /social-media-posting/{locationId}/posts/list` |
| Statistics | `POST /social-media-posting/statistics` with `accountIds`, `locationId` |

The `Version` header value per endpoint is taken from the docs page for that endpoint; the client accepts it per call.

### Functions (`convex/marketing/`)

`accounts.ts`
- `startConnect(platform)` action: `requireCapability("marketing")`, role owner|manager, `ghlFor(org)`, returns the OAuth URL. Enforces the studio-tier account cap before returning a URL.
- `completeConnect({platform, ghlAccountId})` action: called by the client after `postMessage`. Fetches accounts for that result, returns the choice list.
- `attachAccount({platform, ghlAccountId, choiceId})` action: attaches in GHL, then `insertAccount` mutation. Rejects if `by_ghl_account` already belongs to a different org (invariant, see Security).
- `list()` query, `remove(id)` action, `reconnect(id)` action (same as start with `reconnect=true`).

`posts.ts`
- `create(input)` mutation: any staff member; status `draft`; validates template rules and per-platform media rules (below); builds `link` server-side when a promo or booking link is requested.
- `approve(id)` mutation: owner|manager; `draft -> approved`; enforces the monthly scheduled-post cap via `usageCounters` metric `social_posts`.
- `schedule(id)` action: `approved -> scheduled`; resolves media URLs (`ctx.storage.getUrl` or rendered brand card URL), posts to GHL with `status: "scheduled"`, stores `ghlPostId`. On GHL error: status stays `approved`, `failure` set, owner alerted.
- `update(id)`, `cancel(id)` (deletes in GHL if scheduled), `list({from, to, status})` for the calendar, `get(id)`.
- `syncStatus` internal action, cron every 30 min: lists posts in GHL for each org with `scheduled` rows in the window, maps published/failed back. Failures create a `notifications` row for the owner.
- Approval also runs through the existing inbox: an AI Draft is represented as an `opsActions` row (`type: "social_post_draft"`, `artifactId -> socialPosts`), so the owner sees it where every other agent draft lives. Approving the action calls `posts.approve` then `posts.schedule`.

`stats.ts`
- `refresh` internal action, cron daily: GHL statistics per account, stored on `socialAccounts.stats` (followers, reach) and on `socialPosts.stats` if GHL returns per-post metrics (open question 4 in Grilled.md; if it does not, the Results view shows Pulse attribution only).
- `results({from, to})` query: per post: clicks (`bookingVisits` step page with `postId`), attributed bookings, revenue (`amountCents` on `booked`), promo redemptions.

`brandCards.ts` (Next route, not Convex): `GET /api/brand-card/[postId]?kind=rate_card|open_slot|promo` renders a 1080x1350 PNG with satori, same pipeline as `src/app/opengraph-image.tsx`. Inputs: org logo (`logoId`), `accentColor`, room name, rate, promo code, window. Cached by `(postId, updatedAt)`. GHL fetches this URL, so it must be public and fast.

### Promos (`convex/promos.ts`)

- `create`, `update`, `deactivate`, `list` (owner|manager).
- `booking.ts`: `findDiscount(org, code)` becomes `resolveCode(ctx, org, code, roomId, now)`: Promo first (active, window contains now, room matches or unset, redemptions under cap), then legacy `orgs.discountCodes`. On booked, increment `promos.redemptions`. The public `validateCode` query returns the same shape it does today plus `expiresAt` so the booking page can show "ends Sunday".
- Rate-cut recommender: `generateRateCutPromosForOrg` creates a `promos` row (`source: "rate_cut"`, window = the underused slot, room set) instead of, or in addition to, the email draft, and a `socialPosts` Draft with template `rate_promo` and `promoId`. `defaultRateCutPct` still applies.
- `promote_underused_room` in `opsBrain.ts` gets the same treatment: a Draft `open_slot` post.

### Tracked links and attribution

- `link` = `https://<studio host>/book/<slug>[/<roomId>]?src=<postId>[&code=<CODE>]`.
- Booking page reads `src`, writes `postId` on every `bookingVisits` step for that visitor (it already writes `code`).
- A booking is attributed to a post when its `booked` visit has `postId` = that post, or its `code` = that post's promo code, and `booked.createdAt` is within 7 days of `socialPosts.publishedAt`. One booking, at most one post: `postId` wins over `code` if both exist.

### Per-platform rules (validated in `posts.create` and shown in the composer)

| Platform | Media | Caption | Notes |
|---|---|---|---|
| instagram | 1 image, or carousel up to 10, or 1 video (reel); JPEG/MP4 | 2,200 chars | Links are not clickable; link goes to bio guidance |
| facebook | image(s) or video, or text-only | long | |
| google (GBP) | 1 image 5 MB min 250x250, or none | 1,500 chars, no phone numbers | promo posts use `gmbPostDetails` OFFER with couponCode, redeemOnlineUrl, terms, start/end |
| tiktok, tiktok-business | video only | 2,200 chars | Business accounts only; `tiktokPostDetails` privacy required |
| youtube | video only | title + description | |
| linkedin | image or video or text | 3,000 chars | |
| pinterest | 1 image | title + description + link | |
| threads | image/video/text | 500 chars | |
| bluesky | up to 4 images or text | 300 chars | |

Unknown GHL-side rules are learned from error responses and surfaced verbatim in the composer; this table is the v1 baseline, not a promise.

### Entitlements

- New `CapabilityKey` `"marketing"` in `lib/modules.ts` (area `comms`, nav true, blurb "Scheduled posts, promos and results").
- `PLAN_LIMITS` gains `socialAccountCap` and `socialPostsPerMonth`: studio 3 / 20, pro and growth and agency `UNLIMITED`. Beta/custom: follows whatever tier it mirrors.
- Metering: `usageCounters` metric `social_posts` per `YYYY-MM`, incremented on `approve`.

### Security invariants

1. A `socialAccounts` row's `ghlAccountId` belongs to exactly one org; `attachAccount` refuses an id already owned elsewhere.
2. `posts.schedule` sends only `accountIds` that resolve to `socialAccounts` rows with the same `orgId` as the post. Test: a post referencing another org's account id throws before any GHL call.
3. The PIT never leaves Convex; the browser only ever receives the OAuth URL and the post payloads it authored.
4. `client_win` posts require `artists.okToFeature === true` for the linked artist at approve time.
5. All marketing functions gate on `requireCapability("marketing")`; write functions additionally check role.

### Error handling

- `ghlFor` returns null when env is missing: every action degrades to simulated mode (same convention as SMS), posts move to `scheduled` with a `simulated:` prefix on `ghlPostId`, so the demo studio works without GHL.
- GHL 401/403 on any call: mark the org's accounts `needs_reconnect` only if the error is account-scoped; token-level failures alert the platform owner (Lawrence), not the studio.
- Post failed in GHL: `failed` with GHL's message, owner notification, one-tap "retry" which re-schedules.

## Frontend

Route group `src/app/(app)/marketing/`:

- `page.tsx` Calendar: week and month views of `socialPosts` for the org, status as a chip, click opens the post; "New post" and the AI draft count from the inbox.
- `compose/` Composer: template picker (nine cards) -> media (upload or brand card preview) -> caption with the AI assist button (existing AI layer, `aiArtifacts` kind `social_post`) -> accounts (multi-select with per-platform rule warnings) -> schedule (date, time, studio timezone, three suggested slots: evenings Tue to Thu and Sat morning as the v1 heuristic) -> submit (staff) or approve and schedule (owner/manager).
- `accounts/` Connected accounts: one row per account, Connect buttons per platform, reconnect state, cap indicator on studio tier. The Connect button opens the GHL URL in a popup and listens for `message` events with `page === "social-media-posting"`, then calls `completeConnect` and shows the page picker.
- `promos/` Promo list with window, room, redemptions, and a "Post this" button that opens the composer pre-filled.
- `results/` Results table per published post: clicks, attributed bookings, revenue, redemptions; account-level followers/reach from GHL where available.
- Nav entry in the app rail under Communication; the existing inbox gains the `social_post_draft` action card with Approve and schedule / Edit / Dismiss.

Components from Untitled UI (date picker, combobox, modal, table); icons from `@untitledui/icons`. Copy has no em dashes.

## Testing

- Unit (Convex test harness, as in `discountCodes.test.ts`): `resolveCode` precedence and window/room/cap rules; attribution query with the 7-day window and the `postId` over `code` tie-break; per-platform validation; the cross-org account invariant; tier caps.
- GHL client: fetch mocked; `schedule` payload snapshot per platform; simulated mode when env is absent.
- Booking funnel: `src` param writes `postId` on visits (extend `bookingFunnel.test.ts`).
- Manual: connect a real Instagram for Myind Sound, schedule a post 10 minutes out, confirm on Instagram, confirm `syncStatus` marks it published.

## Rollout

1. Prove the connector: `startConnect("facebook")` returns a URL with the current PIT. If not, add `socialplanner/*` scopes.
2. Ship behind the `marketing` capability enabled for Myind Sound and Slang City first.
3. Enable for all paid tiers after one week of real posts.

## Out of scope (v1)

Ads (phase 2, needs a GHL sub-account per studio because ad accounts connect only in the GHL UI), native Meta/Google/TikTok APIs, X, auto-publish, AI imagery, GHL white-label UI, evergreen queues, best-time model beyond the heuristic, Reserve with Google.
