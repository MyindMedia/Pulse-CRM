# Session File Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A studio team marks session files Final and taps Ready to deliver; the client is emailed a branded download link once the delivery is ready and the booking's balance is zero.

**Architecture:** One `sessionDeliveries` row per booking holds the link token, state and stats; one optional flag on `mediaAssets` marks Final files. `settlePayment` and `sessions.setComp` call one internal function that releases a waiting delivery exactly once. A public page reads only through the token and mints 10 minute signed R2 links per click.

**Tech Stack:** Convex (convex-test + vitest, `@convex-dev/r2`), Next.js App Router, Clerk middleware, Tailwind, existing `studioEmailHtml` and `notify`.

**Spec:** `./rd.md` (requirements), `./eval.md` (the checks that decide done; never edit it), `./mockup.html` (design reference, pixel match expected).

## Global Constraints

- Worktree `~/Dev/pulse-session-delivery`, branch `feat/session-file-delivery`. Commit after each task. Never push, never deploy, never run `npx convex deploy` or `npx convex dev` against any deployment, never run `seed:run`.
- Read `AGENTS.md` first (it requires reading `node_modules/next/dist/docs/` before Next.js work) and `docs/ENVIRONMENTS.md` for the known failing tests.
- If `convex/_generated/api.d.ts` needs the new modules and codegen cannot run without a deployment, add the module entries by hand, following the existing pattern in that file.
- Every new schema field is `v.optional`. No rename or removal of any existing field.
- The studio always comes from the caller's identity or the token's row, never from an argument.
- Every query uses an index and a bound (`.take(n)` or `.first()`); no `.collect()` on a table that can grow.
- No em dashes in any copy, comment or commit message. US spelling.
- Copy is exactly the mockup's wording unless this plan gives other words.
- Icons: the set the file already imports (`lucide-react` in the calendar components). No emoji.
- Hit targets at least 44 px on the client page, 36 px in the dense staff panel. Text never below 11 px.
- Constants (in `convex/sessionDelivery.ts`): `LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000`, `URL_TTL_S = 600`, `URL_RATE_MAX = 120`, `URL_RATE_WINDOW_MS = 3_600_000`, `OPENED_MIN_GAP_MS = 60_000`.
- Before editing `settlePayment`, `setComp` or `SessionFilesPanel`, run a GitNexus upstream impact check on it and put the blast radius in your report.

## Review Focus

1. A file name with quotes, non-ASCII letters, a slash or a newline: the download saves under a safe version of that name and the response header cannot be broken. (Task 4)
2. A Final file gets a newer version uploaded: the client page lists and serves only the latest version; an older version id is refused. (Task 4)
3. Two people tap Ready to deliver at the same moment, or one double-clicks: one delivery row, one email. (Task 3)
4. A booking whose rate is 0 (comped before anyone taps Ready): it releases straight away. (Task 3)
5. Every Final file is unmarked or deleted after release, or the booking is cancelled: the page answers like an unknown link. (Task 4)

---

### Task 1: Schema and tests that pin today's behavior

**Files:**
- Modify: `convex/schema.ts` (new `sessionDeliveries` table; three optional fields on `notifications`)
- Modify: `convex/mediaLibraryTables.ts` (`clientFinal` on `mediaAssets`)
- Create: `convex/testing/sessionDeliveryFixture.ts`
- Create: `convex/sessionFiles.test.ts`, `convex/payments.test.ts`

**Interfaces:**
- Produces, schema:
  ```ts
  sessionDeliveries: defineTable({
    orgId: v.string(), sessionId: v.id("sessions"),
    status: v.union(v.literal("awaiting_payment"), v.literal("released"), v.literal("off")),
    token: v.string(), expiresAt: v.number(),
    readyAt: v.number(), readyBy: v.string(),
    releasedAt: v.optional(v.number()), releasedBy: v.optional(v.string()), // "payment" or a member's name
    offAt: v.optional(v.number()),
    sentTo: v.optional(v.string()), lastSentAt: v.optional(v.number()), sendCount: v.number(),
    firstOpenedAt: v.optional(v.number()), lastOpenedAt: v.optional(v.number()), downloadCount: v.number(),
    urlWindowStart: v.optional(v.number()), urlCount: v.optional(v.number()),
  }).index("by_session", ["sessionId"]).index("by_token", ["token"]).index("by_org", ["orgId"])
  // mediaAssets: clientFinal: v.optional(v.boolean())
  // notifications: html: v.optional(v.string()), ctaLabel: v.optional(v.string()), ctaUrl: v.optional(v.string()), accent: v.optional(v.string())
  ```
- Produces, fixture (`convex/testing/sessionDeliveryFixture.ts`), modeled on the setup in `convex/mediaLibrary.test.ts`:
  ```ts
  export function r2Env(): void                       // the vi.stubEnv block
  export async function setupStudios(): Promise<{
    t, as: (user: string) => IdentityClient,
    A: { orgId: "studio_a"; owner: "u_owner"; manager: "u_mgr"; engineer: "u_eng"; artistId; sessionId; otherSessionId },
    B: { orgId: "studio_b"; owner: "u_b"; sessionId },
  }>
  // Studio A: accentColor "#3b63e6", slug "studio-a". Artist "Jordan Ellis", email "jordan.ellis@example.com".
  // sessionId: title "Vocal tracking", rateCents 36000, depositCents 18000, amountPaidCents 18000, status "confirmed".
  // otherSessionId: same artist, unpaid.
  export async function uploadSessionFile(t, who, sessionId, fileName?: string, mimeType?: string, size?: number):
    Promise<{ assetId: Id<"mediaAssets">; versionId: Id<"mediaVersions"> }>
  export async function clientEmails(t, sessionId): Promise<Array<Doc<"notifications">>>  // channel "email", recipient the artist
  ```

- [ ] **Step 1:** Add the table and the optional fields. Run `npx tsc --noEmit`. Expected: no new errors.
- [ ] **Step 2:** Write the fixture.
- [ ] **Step 3:** `convex/sessionFiles.test.ts`, tests named `R-01 ...`: an engineer uploads and the file is listed with its name and size; a signed-out caller gets `null` from `list` and an error from `prepareUpload`; a member of studio B gets `null` for studio A's booking; `downloadUrl` returns a URL for staff; an engineer can delete their own file and not another member's; an owner can delete any. These pin current behavior, so they must pass without touching `sessionFiles.ts`.
- [ ] **Step 4:** `convex/payments.test.ts`, tests named `R-02 ...`, calling `settlePayment` through `t.run`: a deposit on an unpaid booking sets `amountPaidCents` to the deposit, `depositPaid` true, confirms a `tentative` booking, and queues one client email with subject `Deposit received - <title>`; a balance payment sets `amountPaidCents` to `rateCents` and queues one client email with subject `Paid in full - <title>`; settling a fully paid booking throws `This booking is already paid in full.`; a cancelled booking throws. Must pass without touching `payments.ts`.
- [ ] **Step 5:** Run `npx vitest run convex/sessionFiles.test.ts convex/payments.test.ts`. Expected: all pass.
- [ ] **Step 6:** Commit: `Session delivery: schema and tests that pin current file and payment behavior`.

### Task 2: Email template and the notification button

**Files:**
- Create: `convex/lib/emailTemplates/sessionDelivery.ts`, `convex/lib/emailTemplates/sessionDelivery.test.ts`
- Modify: `convex/lib/notify.ts` (optional args), `convex/notifications.ts` (`deliver` uses them)

**Interfaces:**
- Consumes: `escapeEmailHtml`, `studioEmailHtml`, `readableEmailInk` from `convex/lib/emailTemplates/layout.ts`; `money` from `convex/lib/money.ts`.
- Produces:
  ```ts
  export type DeliveryFile = { name: string; size: number };
  export function formatBytes(n: number): string   // 212_000 -> "212 KB", 58_200_000 -> "58.2 MB", 1_420_000_000 -> "1.42 GB" (decimal units, 3 significant figures)
  export function filesReadyEmail(a: { firstName: string; title: string; sessionDate: string; files: DeliveryFile[];
    url: string; expiresOn: string; paidCents?: number }): { subject: string; text: string; html: string; ctaLabel: string; ctaUrl: string }
  export function payToUnlockEmail(a: { firstName: string; title: string; sessionDate: string; files: DeliveryFile[];
    url: string; balanceCents: number }): { subject: string; text: string; html: string; ctaLabel: string; ctaUrl: string }
  // notify(ctx, { ...existing, html?: string, ctaLabel?: string, ctaUrl?: string, accent?: string })
  ```
  `html` is the inner body only (heading, paragraphs, file list); `deliver` wraps it with `studioEmailHtml({ studioName, bodyHtml: n.html, ctaLabel, ctaUrl, accent, accentInk: readableEmailInk(accent) })`. `text` is the plain version stored in `notifications.body` for the booking's message log. Copy:
  - Files ready. Subject `Your files from <title> are ready`. Heading `Your files are ready, <firstName>`. Body `Everything from your <title> session on <sessionDate> is ready to download.` plus, when `paidCents` is set, ` Payment received: <money>. Thank you.` Button `Download your files`. Small print `The link works until <expiresOn>. If it stops working, reply to this email for a new one.`
  - Pay to unlock. Subject `Your files are ready. One step left`. Heading `Your files are finished, <firstName>`. Body `Your <title> session from <sessionDate> is finished and waiting. There is a <money> balance on this booking. Once it is paid, your download link arrives right away.` Button `Pay <money> and unlock`. Small print `Already paid? Reply to this email and the studio will sort it out.`
  - No first name on file: the headings drop the comma and the name.

- [ ] **Step 1:** Tests first (`E-01` to `E-04`, `E-06`): exact subjects and button labels above; every file name and size appears in `html` and `text`; `<script>alert(1)</script>` and `"><img src=x>` as `firstName`, `title` and a file name appear escaped in `html` and never raw; `readableEmailInk` gives dark ink on `#fdb913` and `#ffffff`, light ink on `#0a0a0a`; no U+2014 in any output; `formatBytes` values above.
- [ ] **Step 2:** Run them. Expected: fail, module missing.
- [ ] **Step 3:** Implement the template. The file list is an email-safe table (inline styles, no classes), matching the mockup's bordered list with the size right-aligned in a monospace stack.
- [ ] **Step 4:** Extend `notify` and `deliver`. A row without `html` must render exactly as before (assert with a test on `deliver`'s HTML builder, extracted as `notificationEmailHtml(n): string` in `convex/notifications.ts`).
- [ ] **Step 5:** Run `npx vitest run convex/lib/emailTemplates convex/notifications`. Expected: pass.
- [ ] **Step 6:** Commit: `Session delivery: branded file emails and a button on booking notifications`.

### Task 3: Staff functions and the payment trigger

**Files:**
- Create: `convex/sessionDelivery.ts`, `convex/sessionDelivery.test.ts`
- Modify: `convex/payments.ts` (`settlePayment`), `convex/sessions.ts` (`setComp`), `convex/sessionFiles.ts` (`list` returns `clientFinal`; `remove` unchanged)

**Interfaces:**
- Consumes: Task 1 fixture and schema; Task 2 `filesReadyEmail`, `payToUnlockEmail`, `notify`; `staffSession`, `staffSessionOrNull`, `canModerate` from `convex/lib/sessionAccess.ts`; `currentMoneySight` from `convex/lib/tenant.ts`; the app URL helper `automation.ts` uses for pay links.
- Produces:
  ```ts
  export const setFinal: mutation({ assetId: v.id("mediaAssets"), final: v.boolean() }) => null   // deliverables.upload
  export const status: query({ sessionId }) => null | {
    state: "none" | "awaiting_payment" | "released" | "off";
    finalCount: number; clientFirstName: string; clientEmail: string | null;
    balanceDue: boolean; balanceCents: number | null;        // cents only with money sight
    sentTo: string | null; lastSentAt: number | null; sendCount: number;
    firstOpenedAt: number | null; downloadCount: number; expiresAt: number | null; offAt: number | null;
    canMarkReady: boolean; canRelease: boolean; canTurnOff: boolean;
  }
  export const markReady: mutation({ sessionId }) => { state: "awaiting_payment" | "released" }   // deliverables.upload
  export const releaseNow: mutation({ sessionId }) => null   // schedule.manage, state awaiting_payment only
  export const turnOff:    mutation({ sessionId }) => null   // schedule.manage
  export const resend:     mutation({ sessionId }) => null   // deliverables.upload; re-sends the email for the current state, expiresAt = now + LINK_TTL_MS
  export const link:       query({ sessionId }) => { url: string } | null   // deliverables.upload; called on demand, never subscribed
  export async function onBalanceSettled(ctx: MutationCtx, sessionId: Id<"sessions">, opts?: { paidCents?: number }): Promise<boolean>
  export function deliveryUrl(token: string): string   // `${appUrl}/delivery/${token}`
  ```
  Rules: `markReady` throws `Mark at least one file Final first.` with no Final file, `Add an email for this client first.` with no client email, `This booking was released.` when cancelled. It reuses the booking's row when one exists (`by_session`), issuing a new token only when the row was `off`. `releaseNow`, `onBalanceSettled` and a paid `markReady` all go through one internal `release(ctx, delivery, by, paidCents?)` that patches `status: "released"`, `releasedAt`, `releasedBy`, `expiresAt = now + LINK_TTL_MS`, `sentTo`, `lastSentAt`, `sendCount + 1` and queues the files email with the studio's `accentColor`. `onBalanceSettled` returns `true` only when it released an `awaiting_payment` delivery; any other state returns `false` and writes nothing. Notification kinds: `delivery.ready`, `delivery.pay`.
  `settlePayment`: when `fullyPaid`, call `onBalanceSettled(ctx, sessionId, { paidCents: amountCents })` and skip the existing client email when it returned `true`. Everything else in the function stays as it is. `setComp`: after the rate patch, when nothing is owed, call `onBalanceSettled(ctx, id)`.

- [ ] **Step 1:** Tests first, named by eval id: `A-08` to `A-11`, `G-01` to `G-10`, `G-12` to `G-14`, plus Review Focus 3 (two `markReady` calls leave one row and one client email) and 4 (rate 0 releases on `markReady`). `A-11`: as the engineer, `status` has `balanceCents: null` and `balanceDue: true`; as the owner, `balanceCents: 18000`. `G-04`: `settlePayment` with `provider: "stripe"`. `G-07`: with a waiting delivery, the settling payment leaves exactly one client email (kind `delivery.ready`) and none with subject `Paid in full - ...`.
- [ ] **Step 2:** Run. Expected: fail, module missing.
- [ ] **Step 3:** Implement `sessionDelivery.ts` staff side and the two call sites. Add `clientFinal: asset.clientFinal === true` to each file in `sessionFiles.list`.
- [ ] **Step 4:** Run `npx vitest run convex/sessionDelivery.test.ts convex/payments.test.ts convex/sessionFiles.test.ts`. Expected: all pass, Task 1 tests untouched.
- [ ] **Step 5:** Commit: `Session delivery: mark Final, Ready to deliver, release on payment`.

### Task 4: Public functions

**Files:**
- Modify: `convex/sessionDelivery.ts`, `convex/sessionDelivery.test.ts`
- Modify: `convex/lib/media.ts` only if a signed URL with a download file name needs a new helper
- Create: `specs/liability/data-map.md` rows (create the file if missing)

**Interfaces:**
- Consumes: Task 3 rows and helpers; `fileUrl` and `r2For` from `convex/lib/media.ts`.
- Produces:
  ```ts
  export const page: query({ token: v.string() }) => null | {
    studio: { name: string; logoUrl: string | null; accent: string | null };
    booking: { title: string; startTime: number; roomName: string | null };
    clientFirstName: string;
    state: "unlocked" | "locked";
    files: Array<{ versionId: Id<"mediaVersions">; name: string; size: number; mimeType: string }>;
    totalBytes: number;
    balanceCents: number | null; payUrl: string | null;   // set only when locked
    expiresAt: number;
  }
  export const fileUrl: mutation({ token: v.string(), versionId: v.id("mediaVersions") }) => { url: string; fileName: string }
  export const opened: mutation({ token: v.string() }) => null
  export function safeDownloadName(name: string): string   // strips control characters, quotes, slashes and backslashes; max 150 chars; "download" when empty
  ```
  `page` answers `null`, identically, for: a token that is not 64 hex characters, an unknown token, status `off`, `expiresAt` in the past, a cancelled or missing booking, or no Final file left. Files are the latest version of each `clientFinal` asset on that booking in that studio, newest upload first, at most 200. `payUrl` is `<appUrl>/book/<org.slug>/checkout/<sessionId>`. `fileUrl` repeats every `page` check, requires `released`, requires `versionId` to be the latest version of a `clientFinal` asset of this booking and studio, applies the rate limit (error `Too many downloads. Try again in an hour.`), increments `downloadCount`, and returns a `URL_TTL_S` signed GET that saves as `safeDownloadName(fileName)`. If the R2 component cannot set the response file name, sign the GET directly (S3 `response-content-disposition`, RFC 5987 `filename*` for non-ASCII) in a helper next to `r2For`. Every refusal in `fileUrl` uses one message: `That file is not available.` `opened` stamps `firstOpenedAt` once and `lastOpenedAt` at most every `OPENED_MIN_GAP_MS`; it never throws for a bad token.

- [ ] **Step 1:** Tests first: `A-01` to `A-07`, `A-12` to `A-15`, `G-11`, Review Focus 1 (`safeDownloadName('a"b/c\\d\n.wav')` has none of those characters; a name of only quotes gives `download`; `Ünïcode ✓.wav` keeps its letters), 2 (older version id refused, latest served) and 5. `A-07`: `JSON.stringify(page)` contains neither `r2.cloudflarestorage.com` nor the stubbed key prefix nor the token. `A-14`: 120 calls succeed, the 121st throws, and after `vi.setSystemTime` moves past the window the next succeeds.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Add the data map rows: delivery link token; open and download counts and times; where each is stored and who can read it.
- [ ] **Step 5:** Run `npx vitest run convex/sessionDelivery.test.ts`, then `npm run check`. Expected: no failures beyond those listed in `docs/ENVIRONMENTS.md`. Record the counts.
- [ ] **Step 6:** Commit: `Session delivery: token page, signed downloads, rate limit`.

### Task 5: Team panel

**Files:**
- Modify: `src/lib/r2-upload.ts`, `src/components/calendar/session-extras.tsx` (the Files block of `SessionFilesPanel`)
- Create: `src/components/calendar/session-upload-queue.tsx`, `src/components/calendar/session-delivery-card.tsx`, `src/lib/upload-queue.ts`, `src/lib/upload-queue.test.ts`

**Interfaces:**
- Consumes: `api.sessionFiles.*` (unchanged three-step upload), `api.sessionDelivery.setFinal | status | markReady | releaseNow | turnOff | resend | link`.
- Produces:
  ```ts
  // src/lib/r2-upload.ts
  export function putToR2WithProgress(file: Blob, prep: PreparedUpload, onProgress: (sent: number, total: number) => void, signal?: AbortSignal): Promise<void>  // XMLHttpRequest; rejects with DOMException "AbortError" on abort
  // src/lib/upload-queue.ts (pure reducer, unit tested)
  export type QueueItem = { id: string; name: string; size: number; sent: number; status: "queued" | "uploading" | "done" | "failed" | "canceled"; error?: string };
  export function queueReducer(state: QueueItem[], action: QueueAction): QueueItem[]
  export function etaText(sent: number, total: number, startedAt: number, now: number): string  // "about 2 min left", "a few seconds left", "" before 2 seconds of data
  export const MAX_PARALLEL = 2;
  ```
  The panel matches `mockup.html` view 1 in every delivery state and both roles: drop zone (drag and drop plus browse, several files), one queue row per upload with a progress bar, bytes sent of total, time left and a cancel button; a Final toggle on each file row (`aria-pressed`, only for callers who can upload); the delivery card with states none, waiting for payment, sent, link off, plus "no email on file" (button disabled, text `Add an email for Jordan to deliver.` using the client's first name). The amount appears only when `status.balanceCents` is not null. "Send now anyway" and "Turn off link" render only when `canRelease` / `canTurnOff`. Copy link calls `link` on demand and writes to the clipboard, with a toast. A refused file type shows the server's reason on that queue row and uploads nothing else differently. "Upload as new song" stays.

- [ ] **Step 1:** Reducer and `etaText` tests first, then implement both.
- [ ] **Step 2:** `putToR2WithProgress`, then the two components, then wire them into `SessionFilesPanel`. Keep `data-testid="session-file-input"` and `data-testid="session-files"`.
- [ ] **Step 3:** Run `npm run check`. Expected: no new failures.
- [ ] **Step 4:** Run the local demo per `AGENTS.md` and check at 1280 px and 390 px: every delivery state, keyboard use of the Final toggle, no horizontal scroll. Save screenshots under `specs/features/session-file-delivery/evidence/build/`.
- [ ] **Step 5:** Commit: `Session delivery: drop zone, upload progress, Final toggle, delivery card`.

### Task 6: Client page

**Files:**
- Create: `src/app/delivery/[token]/page.tsx`, `src/app/delivery/layout.tsx`, `src/components/delivery/*` as needed
- Modify: `src/middleware.ts` (add `"/delivery/(.*)"` to the public routes, with a comment like its neighbors), `next.config.*` (headers for `/delivery/:path*`: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`)

**Interfaces:**
- Consumes: `api.sessionDelivery.page | fileUrl | opened`.
- Produces: the route `/delivery/<token>`, matching `mockup.html` view 3 at desktop and 390 px in all states: loading skeleton, unlocked, balance due, and the generic expired page (no studio name or logo). The studio accent arrives as `page.studio.accent` and is applied as a CSS variable on the page root, with button ink chosen for contrast the same way `readableEmailInk` does; no logo means the studio's initials in the accent tile. Audio rows get a play button that fetches a signed URL through `fileUrl` on first play and uses a native `<audio>` element; zips and documents get no player. Each Download click calls `fileUrl` and navigates to the URL. Download all calls them in turn, 600 ms apart, and shows `Starting 2 of 4`. `opened` is called once on first unlocked render. Footer: `Delivered with Pulse`, links to `/privacy` and `/terms`. `layout.tsx` sets `robots: { index: false, follow: false }` and `referrer: "no-referrer"`, and loads no analytics or third-party script. The page imports nothing from the signed-in app shell.

- [ ] **Step 1:** Build the page and layout against the mockup. Add the middleware entry and headers.
- [ ] **Step 2:** Run `npm run check` and `npm run build`. Expected: build succeeds; note the route's First Load JS.
- [ ] **Step 3:** Local demo: with a released delivery, a waiting one and a bad token, check each state at 1280 px and 390 px, reduced motion, and 200% text. `curl -sI http://localhost:<port>/delivery/x` shows 200 and both headers. Save screenshots under `specs/features/session-file-delivery/evidence/build/`.
- [ ] **Step 4:** Commit: `Session delivery: public download page`.
