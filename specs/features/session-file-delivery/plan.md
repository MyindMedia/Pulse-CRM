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

---

## Addendum 1 (after the backend round, 2026-11-13)

Tasks 1 to 4 are committed (`e231c65`, `934cf00`, `0abba4e`, `2b808df`). The fixture lives at `convex/testing/sessionDelivery.fixture.ts` (two dots, so Convex does not bundle it). Three agents now work in this worktree at the same time: backend fixes (below), Task 5 and Task 6. Each commits only its own paths with `git add <paths>` (never `git add -A` or `git add .`, never `git stash`), and retries after a few seconds on an `index.lock` error. A type or lint error in a file outside your task is another agent mid-edit: wait a minute and re-run, never edit it.

Nobody runs the app in this round (no `convex dev`, no `next dev`): a separate verifier sets up one local backend afterwards. Task 5 Step 4 and Task 6 Step 3 are therefore skipped; `npm run check` and, for Task 6, `npm run build` are the bar.

### Backend fixes (findings from triage of the backend round)
| ID | Class | Fix |
|---|---|---|
| B-01 | partial write behind a caught error | `settlePayment` catches a failure from `onBalanceSettled`. A Convex mutation has no sub-transaction, so writes made before the throw would stay. Make `onBalanceSettled` and `release` do every read and check before their first write. Test: force a failure (for example the client row is gone) and assert the delivery row is unchanged and the "Paid in full" email is still queued. |
| B-02 | missed trigger | Any path that lowers what is owed without calling the hook (a rate edit, a future feature) would leave a delivery waiting forever. Add `export const refresh: mutation({ token: v.string() }) => null`: when the delivery is `awaiting_payment`, not expired, the booking is not cancelled and nothing is owed, release it (by `payment`) through the same `release`. Never throws for a bad token. Tests: lower `rateCents` to the paid amount with a direct patch, `refresh` releases and queues one files email; a second `refresh` queues none; with a balance still owed it changes nothing. |
| B-03 | money and link shown to staff without money sight | The stored `notifications.body` of the pay email must not contain the amount (use `There is a balance on this booking.`); the `html` keeps it. Every query that returns notification rows to a client (`forSession`, `recent`, `activityFeed`, any other) must omit `html` and any link fields. Tests for both. |
| B-04 | mockup mismatch | In the mockup the small print sits under the button. Have the template put the button inside its own `html` (same markup and readable ink as `studioEmailHtml`'s button, colored by an `accent` argument) followed by the small print, and stop passing a separate button. Remove `ctaLabel` and `ctaUrl` from the schema, `notify` and `deliver` if nothing else uses them; keep `accent` for the header bar. Update the tests. |
| B-05 | undeclared dependency | `convex/lib/media.ts` imports `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, which are only present transitively. Add both to `package.json` `dependencies` at the exact versions already in `package-lock.json`. |

### Change to Task 6
The client page calls `api.sessionDelivery.refresh({ token })` once when it first renders in the locked state (B-02), and `opened` once when it first renders unlocked.

---

## Addendum 2: round 2 fix list (2026-11-13, from the verifier, the code review and the security review)

Round 1 result: 58 PASS, 3 FAIL, 9 NOT RUN (need staging), 3 PENDING. Two agents fix in parallel with separate ownership: the **backend** agent owns `convex/**`; the **frontend** agent owns `src/**`. Same git rules as Addendum 1 (`git add <paths>` only, no stash, retry on `index.lock`, never edit the other side's files, never edit `eval.md`). The untracked `.env.local`, `convex/tsconfig.json` and `.convex/` belong to the verifier's local backend: do not commit, edit or delete them. Nobody runs the app. Each finding names a class: fix every instance of it. One commit per finding or small group, message `Session delivery: <what> (<ids>)`.

### Interface changes both sides code against
```ts
// convex/sessionDelivery.ts
page: adds  booking.dateLabel: string   // "November 11, 2026", in the studio's time zone
            expiresLabel: string         // "Dec 13, 2026", in the studio's time zone
      balanceCents / payUrl: now net of paid invoices; payUrl is the open invoice's pay link when one exists (F2-01)
fileUrl: args add  purpose: v.optional(v.union(v.literal("play"), v.literal("download")))   // default "download"
status: adds  cancelled: boolean          // the booking is cancelled, so nothing can be delivered
markReady: unchanged, returns { state: "awaiting_payment" | "released" }
// shared formatting, so the email, card and page agree
convex/lib/money.ts:  export function moneyExact(cents: number): string   // always two decimals: "$180.00"
src/lib/format-bytes.ts: export function formatBytes(n: number): string  // decimal units, same rules and outputs as the backend's formatBytes
```

### Backend fixes (`convex/**`)
| ID | From | Class | Fix |
|---|---|---|---|
| F2-01 | R-01, Critical | a second payment ledger the gate ignores | Paying the balance by invoice never unlocks. Add index `by_session` on `invoices`. One helper `owedOnBooking(ctx, session): Promise<number>` = `max(0, rateCents - amountPaidCents - sum of amountCents of invoices with this sessionId and status "paid")`, used by `owed`, `status`, `page`, `markReady`, `resend`, `refresh` and `onBalanceSettled`. Call the guarded settle helper (F2-03) from `settleInvoice` (`invoicePay.ts`), the manual paid status change in `invoices.ts`, and the card-on-file charge in `cardOnFile.ts`. In `settleInvoice`, skip the "Payment received - invoice" client email when the delivery released and the files email went (one email, not two). `payUrl`: when the booking has an invoice with status `sent`, `viewed` or `overdue`, use `<appUrl>/pay/invoice/<id>`; otherwise the checkout link. Tests: ready then invoice paid online; invoice paid then ready; manual mark paid; a paid invoice smaller than what is owed does not release; a void or draft invoice counts for nothing; `payUrl` picks the open invoice. |
| F2-02 | S-01, R-06 | erasure leaves a live credential | `eraseArtist` sets each of the client's deliveries to `status: "off"`, `offAt: now`, and replaces `token` with a fresh random one. Test: after erasure `page` and `fileUrl` answer like an unknown link for the old token. |
| F2-03 | S-03, S-04 | unguarded side effect inside a money mutation | One exported `settleDeliveryQuietly(ctx, sessionId, opts?): Promise<boolean>` that wraps `onBalanceSettled` in try/catch (logs the message only). Every caller outside `sessionDelivery.ts` uses it (`settlePayment`, `setComp`, `payDeposit`, `applyReschedule`, `packages.redeem`, and the three in F2-01). In `release`, queue the email before patching the row, so a failed insert leaves nothing changed. |
| F2-04 | S-05 | non-finite number passes a comparison | `owedOnBooking` treats a non-finite or negative `rateCents` as still owed (never releases on it). `setComp` rejects non-finite `listValueCents` and `chargedCents`. Tests for `NaN`, `Infinity`, negative. |
| F2-05 | S-07, R-07 | flag follows a row to a new owner | `mediaLibrary.updateAsset` clears `clientFinal` whenever `sessionId` changes. Test. |
| F2-06 | S-08 | unbounded client email | `resend` refuses within 2 minutes of `lastSentAt` with `Sent a moment ago. Try again in a couple of minutes.` Test with fake timers. |
| F2-07 | S-10 | read cap applied before the filter | Index `by_org_session_final` (`orgId`, `sessionId`, `clientFinal`) on `mediaAssets`; `finalFiles` reads Final rows through it. Test: a booking with 205 working files and 3 Final files lists all 3. |
| F2-08 | S-11, R-05 | new table missing from cleanup lists | Add `sessionDeliveries` to `ORG_TABLES` in `subaccountDeletion.ts`, and delete the delivery row wherever a booking row is deleted. Extend the "every org-owned table is listed" test to cover it. |
| F2-09 | R-08 | a play counted as a download | `fileUrl` takes `purpose`; only `download` increments `downloadCount`. Every mint still counts toward the rate limit. Test. |
| F2-10 | R-12 | two clocks | `page` returns `booking.dateLabel` and `expiresLabel` formatted in the studio's time zone (reuse the zone helper the email already uses). Test: a session at 11 PM Pacific gives the same date in the email and in `page`. |
| F2-11 | E-05 FAIL | sender name | Emails of kind `delivery.ready` and `delivery.pay` are sent with `from: "<studio name> via Pulse <support@studiopulse.tech>"` (same form as `clientEmail.ts`). Strip quotes, angle brackets, commas and control characters from the studio name before it goes into the header. Other notification kinds keep today's sender. Tests, including a hostile studio name. |
| F2-12 | E-01 FAIL | fixed brightness cutoff | `readableEmailInk` picks the ink with the higher WCAG contrast ratio against the accent. Extend the E-04 test with `#ff6b4a` (dark ink) and `#0f8f6f`, asserting at least 4.5:1 for each. Existing layout tests must still pass or be updated only where the old ink was below 4.5:1 (list any you change). |
| F2-13 | R-13 | copy | Delivery emails use `moneyExact` (`Pay $180.00 and unlock`, `Payment received: $180.00.`). A cancelled booking's errors say `This booking was cancelled.` in `sessionDelivery.ts` only. `status` returns `cancelled`. Move the misplaced `sessionNotes` comment in `schema.ts` back above its table. |
| F2-14 | verifier | tests that do not fully prove their check | A-07 with a studio that has a logo (assert the logo URL is the public media host and nothing from the private bucket appears). G-04 through the real webhook handler if the test harness can reach it; if not, say why in the test's comment. |

### Frontend fixes (`src/**`)
| ID | From | Class | Fix |
|---|---|---|---|
| F2-20 | R-02, Major | work owned by a component that unmounts | Closing the session panel drops queued uploads. Move the queue into a module-level store (`src/lib/upload-manager.ts`, read with `useSyncExternalStore`) keyed by `sessionId`: each entry captures its `sessionId` and job when added, uploads keep running and keep starting after the panel closes, reopening the panel shows that booking's rows, and the `beforeunload` guard stays while anything is active. Unit tests for the store (add, start order, cap of 2, cancel, panel closed and reopened, two bookings at once). |
| F2-21 | R-03, Major | chained top-level navigations | Never navigate the page to download. Each download loads its signed URL in its own hidden `iframe` (removed after 2 minutes). "Download all" does them in turn, 600 ms apart. On iPhone and iPad Safari, replace the "Download all" button with the line `Tap a file to download it.` A failed mint shows its message on that row. |
| F2-22 | R-04, Major | user gesture lost across an await | "Copy link": call `navigator.clipboard.write([new ClipboardItem({ "text/plain": <promise of a Blob> })])` synchronously in the click, falling back to `writeText` where `ClipboardItem` is missing. On failure show `Could not copy. Select the link and copy it.` with the link in a read-only field, never a raw browser error. |
| F2-23 | U-07 FAIL | a global rule beats the component's size | In the Files section at phone width, every control (Play, Download, Delete, Dismiss, Cancel, Final, Ready to deliver, Resend, Copy link, Turn off link, Send now anyway, Link a song, Upload as new song) is at least 44 x 44 px. The global `.pl-key[data-size="icon-sm"]` rule in the hardware UI kit forces 26 px: beat it locally for these controls, do not change it globally. |
| F2-24 | R-09 | cancel after the point of no return | Once `attach` has started, cancel is ignored and the row ends as Uploaded. Check for cancel after `createSong` and before `attach`. |
| F2-25 | R-10 | a folder treated as a file | Refuse a dropped folder on its own row: `Folders cannot be uploaded. Zip it first.` |
| F2-26 | R-11 | noisy live regions | No `aria-live` on the upload list or the whole card. One small `role="status"` node announces started, uploaded, failed, canceled. Failed rows are announced once. Hidden file inputs are not exposed as buttons to assistive tech. |
| F2-27 | R-13 + verifier | copy and formatting | Amounts through a two-decimal formatter (`$180.00`). File sizes through `formatBytes` (decimal) in the staff list and queue. Card: the waiting state with nothing owed says `Nothing is owed now. Tap Resend to send the files.` and nothing else; no email state says `No email on file. Add one for <first name> to deliver.`; a cancelled booking shows `This booking was cancelled, so there is nothing to deliver.` with the button disabled. Toasts: `Sent to <email>` when released, `Pay link sent. The files unlock when the balance is paid.` when waiting. "Opened" shows the date when it is not today. Zips use an archive icon. `2 GB` and `100 MB` never break across lines. A long refusal message wraps at 390 px. |
| F2-28 | F2-09, F2-10 | use the new fields | Play calls `fileUrl` with `purpose: "play"`. The page shows `booking.dateLabel` and `expiresLabel` from the server, not browser-zone dates. |
| F2-29 | A-11 | proof without an engineer sign-in | Move the card's state-to-copy logic into a pure function `deliveryCardView(status)` in `src/lib/delivery-card-view.ts` and unit test it: with `balanceCents: null` no string contains `$` or a digit followed by `.00`, and neither `Send now anyway` nor `Turn off link` is offered when `canRelease` / `canTurnOff` are false. |

### Not fixing in this round (on purpose)
- S-09: the 120 per hour download limit is the approved number.
- S-06: the pay link carries the booking id, as every existing pay email does.
- S-02: whether the sign-in script ever sees the page address is checked on staging with a network log.
- Client page light theme, uppercase button labels, file order: the app's own conventions.

---

## Addendum 3: round 3 fix list (2026-11-13, from the round 2 review)

Round 2 review: 0 critical, 3 major, 1 minor, 2 unconfirmed, all in one area: **what the client is asked to pay, and where the Pay button sends them.** Pulse keeps two payment records (booking payments in `amountPaidCents`, and invoices). Checkout charges `rateCents - amountPaidCents`; an invoice charges its own stored amount; the page shows a third number. Patching each mismatch one by one has now failed twice, so this round replaces the approach with one rule.

### The rule (replaces the `payUrl` logic from F2-01)
**The page and the pay email offer an online Pay button only when the amount that target will charge is exactly the amount shown. Otherwise there is no button.** One function decides it, and everything reads from it:

```ts
// convex/sessionDelivery.ts
export type PayTarget =
  | { kind: "invoice"; url: string; cents: number }    // an invoice with status sent, viewed or overdue on this booking
  | { kind: "checkout"; url: string; cents: number }   // the booking checkout
  | { kind: "none"; reason: "invoice_not_sent" | "amount_mismatch" | "prices_hidden" | "nothing_owed" };
export async function payTargetFor(ctx, session, org): Promise<PayTarget>
```
- `owed` (R3-03): `max(0, rateCents - max(amountPaidCents ?? 0, depositPaid ? depositCents : 0) - paid invoices on the booking)`, the same credit rule `createCompletionInvoice` uses.
- `invoice`: exactly one invoice on the booking has status `sent`, `viewed` or `overdue`, and its `amountCents === owed`.
- `checkout`: the booking has NO invoice at all other than void ones (no draft, no open, no paid), the booking is not `pricingHidden`, and `rateCents - (amountPaidCents ?? 0) === owed` (what checkout will really charge).
- `none` otherwise: `invoice_not_sent` when a draft invoice exists and nothing else disqualifies; `prices_hidden` for a `pricingHidden` booking with no matching open invoice; `amount_mismatch` for everything else.
- `page.payUrl` = the target's `url` or `null`. `page.balanceCents` = `owed`, or `null` for a `pricingHidden` booking (never show a figure the studio chose to hide).
- `status` adds `onlinePay: "invoice" | "checkout" | "none"` and `onlinePayReason` (the `none` reason or null), so the team card can say what to do.

### Fixes
| ID | From | Side | Fix |
|---|---|---|---|
| R3-01 | R2-01, R2-02, R2-04 | backend | Implement `payTargetFor` and use it in `page`, `status` and the pay email. Tests, one per scenario, each asserting that when a URL is offered the target's charge equals `page.balanceCents`: (a) rate $400, $100 paid, $300 invoice paid, rate raised to $450: owed $50, no button; (b) rate $400, $100 paid, $300 invoice sent, a $100 package hour redeemed: owed $200, no button; (c) rate $400, $100 paid, $300 DRAFT invoice: owed $300, no button, reason `invoice_not_sent`; then the invoice is sent: button to the invoice, $300; (d) rate $360, nothing paid, no invoice: button to checkout, $360; (e) `pricingHidden`: no button, `balanceCents` null; (f) legacy `depositPaid` row with no `amountPaidCents`: owed $300 after its $300 invoice... see R3-03. For the checkout case, assert against the amount the real checkout code computes (call the same function `booking.ts` / `payments.ts` use, do not re-derive it in the test). |
| R3-02 | R2-01 | backend | Pay email without a target: no button; body `Your <title> session from <date> is finished and waiting. There is a <amount> balance on this booking. <Studio> will send you a way to pay it. Once it is paid, your download link arrives right away.` For a `pricingHidden` booking leave out the amount: `There is a balance on this booking.` With a target, the email is as before and its button still goes to the delivery page. |
| R3-03 | R2-03 | backend | `owed` credits `max(amountPaidCents, depositPaid ? depositCents : 0)`. Test: rate $400, `depositCents` $100, `depositPaid` true, no `amountPaidCents`, $300 invoice paid: nothing owed, releases. |
| R3-04 | review | backend | G-18 only proves the fee case on a cancelled booking. Add a test on a no-show booking with a paid fee invoice: state exactly what is owed and that the gate agrees with it. If no-show bookings should not deliver at all, say so in the report instead of guessing. |
| R3-05 | R2-01 | frontend | Client page, locked, `payUrl` null: no Pay button; under the heading show `<Studio> will send you a way to pay. Your files unlock here as soon as it is paid.` With `balanceCents` null the heading is `Your files are ready once the balance is paid`. Team card, waiting state, `onlinePay: "none"`: for callers who see money, `invoice_not_sent` shows `Send the balance invoice so <first name> can pay online.`; `amount_mismatch` shows `There is no online pay link for this balance. Send <first name> an invoice for it.`; `prices_hidden` shows `Prices are hidden on this booking. Send <first name> an invoice to collect the balance.` Callers without money sight see only `A balance is still owed.` Cover the new copy in `deliveryCardView` tests. |
| R3-06 | R2-05 | frontend | On iPhone and iPad (the existing `isTouchApple` check), a single file's Download navigates the page to the signed URL (the server's attachment header keeps the page in place) instead of using a hidden frame. Desktop keeps frames. |
| R3-07 | R2-06 | frontend | The upload store records who added each file (user id and studio id from the app's existing auth hooks). When either changes, queued uploads are canceled with `Signed out before this upload started.` and running ones are aborted. Unit test on the store. |

Same working rules as Addendum 2 (file ownership by side, `git add <paths>` only, nobody runs the app, never edit `eval.md`, no em dashes).

### Addendum 3, part 2: round 2 verifier failures (round 2 result: 64 PASS, 6 FAIL, 15 NOT RUN, 3 PENDING of 88)
| ID | From | Side | Class | Fix |
|---|---|---|---|---|
| V3-01 | U-04 FAIL | frontend | a control that disables itself loses focus | The Final toggle must not set `disabled` while saving. Keep it focusable, ignore repeat presses while a save is in flight (`aria-busy`), and announce the new state through the section's existing `role="status"` node (`Final: <file name>` / `Not final: <file name>`). Apply the same to every other button in the Files section and delivery card that disables itself during its own request. |
| V3-02 | U-05 FAIL | backend | first word of a name used as a first name | "The Midnight Tape" is greeted as "The". Clients have a `type`; read how `artists` distinguishes a person from a band, label or company. For a person use the first word; for anything else, or when the first word is an article (The, A, An) or the name has no space, use the whole name. One helper, used by the card (`status.clientFirstName`), both emails and `page.clientFirstName`. Tests: "Jordan Ellis" -> "Jordan", "The Midnight Tape" (band) -> "The Midnight Tape", "Crosstown Records" (company) -> "Crosstown Records", empty -> "". |
| V3-03 | C-10 FAIL | frontend | fixed-width controls squeeze the text | At 390 px with 200% text the file name gets about one character per line. In `file-row.tsx`, when the row is narrow (container query on the row, not the viewport) the controls drop to their own line under the name. The name always has the full row width or at least 12rem. |
| V3-04 | F-01 FAIL | backend | unbounded read | `convex/dataRights.ts` around lines 132-133 does two unbounded `.collect()` on `collaboratorGrants` (one over the whole studio). Read through an index that narrows to this client, with a bound and a loop if more remain. |
| V3-05 | LL-12, LL-13 FAIL | frontend | a bright accent used as text on a light surface | On the client page in the light theme the "Balance due" pill text is 1.96:1 and the gold focus ring about 2.2:1. Text and focus rings must use a text-safe color: at least 4.5:1 for text and 3:1 for the focus ring, in both themes. Use the app's existing text-safe gold token if one exists; otherwise define the two values locally on the delivery page root (the mockup uses `#7a5600` on light). The studio accent stays a FILL only (buttons, logo tile), never text. Check every use of gold or the studio accent as text or outline on the page and in the team card. |
| V3-06 | verifier | backend | doubled word | The email reads "your Writing session session on ...". When the booking title already ends with the word "session" (any case), do not add another. Also put a blank line between the heading and the body in the plain text stored for the message log. Tests. |

---

## Addendum 4: round 4 fix list (2026-11-13, from the round 3 review)

Round 3 review: 0 critical, 2 major, 5 minor, 1 unconfirmed. **The payment math is identical to `develop`** (confirmed by the reviewer and by reading `git diff origin/develop..HEAD` on `booking.ts`, `invoicePay.ts`, `payments.ts`: a pure move into `convex/lib/checkout.ts`). **No booking was found where a Pay button charges an amount other than the one shown.** What is left is guidance and edge copy. Same working rules as before (ownership by side, `git add <paths>` only, nobody runs the app, never edit `eval.md`, no em dashes). Verifier failures from round 3 are appended below this table when they arrive.

| ID | From | Side | Class | Fix |
|---|---|---|---|---|
| R4-01 | R3x-01, Major | both | advice that creates a second payable record | When exactly the reason is "an open invoice exists but its amount is not what is owed", telling staff to "send an invoice" leaves two open invoices. Backend: new `onlinePayReason` value `open_invoice_wrong_amount` whenever one or more invoices with status `sent`, `viewed` or `overdue` exist on the booking and no target qualifies; `status` also returns `openInvoice: { number: string; cents: number } | null` (the first such invoice; `cents` only for callers with money sight, otherwise the field is null). Frontend card copy for money-sighted callers: `Invoice <number> is open for <amount>, but <owed> is owed. Void or correct it so <first name> can pay online.` Keep `There is no online pay link for this balance. Send <first name> an invoice for it.` only when no open invoice exists. Tests on both sides. |
| R4-02 | R3x-02, Major | backend | a state the gate prices wrongly | A no-show booking bills a fee, not the rate, so the gate's "owed" is wrong for it. Treat `no_show` exactly like `cancelled` everywhere in this feature: `markReady`, `releaseNow`, `resend` refuse with `This booking was a no-show, so there is nothing to deliver.`; `status.cancelled` stays for cancelled and `status` adds `noShow: boolean`; a delivery on a booking that later becomes a no-show answers like an unknown link on the public page and never releases. Replace the R3-04 test with tests of this rule. Frontend: the card shows `This booking was a no-show, so there is nothing to deliver.` with the button disabled (extend `deliveryCardView` and its tests). |
| R4-03 | R3x-03 | backend | the target shows one amount and charges another | The checkout page displays the full `depositCents` even when it will charge less (deposit larger than the balance after a discount). Do not change the checkout page. In `decidePayTarget`, the checkout target also requires that every amount the checkout page DISPLAYS for an offered kind equals owed: for `deposit` the displayed amount is `depositCents`, for `full` and `balance` it is the balance. Otherwise `none` (`amount_mismatch`). Test: rate $400, deposit $120, nothing paid, discounted to $100: no button. |
| R4-04 | R3x-04 | frontend | pay wording when nothing is owed | Locked page with `balanceCents === 0`: no "Balance due" pill and no pay wording. Heading `Payment received`, line `<Studio> is sending your files. This page unlocks as soon as they do.` Put it in `lock-copy.ts` with a test. |
| R4-05 | R3x-05 | backend | first word of a stage name | `greetingName`: return `""` for an erased client (`erasedAt` set). For every client type, use the first word only when the name has two or three words, the first word has at least three letters, and it is not one of: the, a, an, dj, mc, lil, big, young, yung, dr, mr, mrs, ms, sir, king, queen, saint, st (any case, with or without a trailing period). Otherwise the whole name. Bands, labels and companies always get the whole name. Tests: "Jordan Ellis" -> "Jordan"; "Lil Baby", "DJ Premier", "MC Lyte", "The Midnight Tape", "Crosstown Records" (company), "Prince" -> whole name; erased -> "". |
| R4-06 | R3x-07 | backend | a test that trusts the code it tests | In the random-combinations test, compute the expected owed independently inside the test (`max(0, rate - max(paid, depositPaid ? deposit : 0) - sum of paid invoice amounts)`, counting only finite positive values) and compare it with `owedOnBooking`; also vary the booking status (confirmed, completed, cancelled, no-show) and assert cancelled and no-show never offer a target and never release. Confirm by temporarily removing the deposit credit that the test now fails, then restore it. |
| R4-07 | U-1 | frontend | a transient auth blip treated as a sign-out | `upload-identity-sync.tsx`: an `orgId` of null while the user id is unchanged and not null is ignored (it means the session is refreshing, not that the studio changed). Only a different non-null org id, or a different or missing user id, counts as a change. Store test. |

### Not fixing in this round (on purpose), logged for Lawrence
- R3x-06: a grant whose email differs from the client's only in letter case survives erasure. Not worse than `develop`, which revokes no grants at all. The real fix is to normalize emails when grants are created, in the grants module.
- Existing, not from this branch: the Stripe webhook records the booking's balance at the moment it arrives, not what Stripe actually charged, and swallows "already paid in full". A rate change between opening checkout and paying can leave money unrecorded.
