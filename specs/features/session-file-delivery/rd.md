# RD: Deliver final session files to the client

Requested by Lawrence, 2026-11-13: "the flow for producers/engineers to upload music files, zips etc. to a
session, and upon balance being paid an email with a link will be sent to the booked email with the final
session files. Everything should be elegant, sleek and branded." Uploaders: team members only (his answer).

Branch `feat/session-file-delivery` off `develop`. Eval: `./eval.md`. Mockup: `./mockup.html`.

## Why
A studio wants to hand over finished work without chasing money or pasting Dropbox links. Files should
reach the client the moment two things are true: the team says the files are final, and the booking is paid.

## What exists today (production, commit `3bf7d99` and later)
- Owners, managers and engineers upload files to a booking from the session panel
  (`convex/sessionFiles.ts`, `src/components/calendar/session-extras.tsx`): audio, video, archives up to
  2 GB, documents and images up to 100 MB, straight to the studio's private R2 bucket. One file at a time,
  no drag and drop, no progress bar.
- Session files are staff only. Downloads are 10 minute signed links behind a staff check.
- `settlePayment` in `convex/payments.ts` is the one place a booking's paid amount changes. On paid in full
  it emails the client a plain "Paid in full" note.
- Separate and untouched by this work: song Deliverables with a payment gate and the client portal
  (`convex/files.ts`, `convex/portal.ts`), and single-file library guest links (`/files/<token>`).

## Goals
1. Staff mark which session files are **Final**. Working files stay private forever.
2. Staff tap **Ready to deliver**. From then on the booking has a delivery.
3. The client is emailed a download link when the delivery is ready **and** the balance is zero,
   whichever happens last. Paid first then ready: sends on Ready. Ready first then paid: sends when the
   payment settles.
4. Ready but not paid: the client gets one "your files are ready, pay to unlock" email with a pay button.
5. The email and the download page carry the studio's name, logo and accent color, with the
   "Sent with Pulse" line the layout already has.
6. Uploading feels finished: drag and drop, several files at once, a real progress bar, cancel.
7. Staff can see what happened (sent to whom, when, opened, downloads) and can resend, copy the link or
   turn the link off.

## Non-goals (v1)
- Upload links for outside producers with no Pulse login.
- Text message delivery (the A2P campaign samples are already waiting on re-registration).
- Server-side zipping. "Download all" starts each file in turn.
- Resumable or multipart uploads. A dropped 2 GB upload still restarts.
- iPhone app screens. New fields are optional so the shipped app keeps working.
- Changes to song Deliverables, the client portal, or library guest links.

## Anti-goals
- A working file, another booking's file or another studio's file reachable from a delivery link.
- Any signed file URL minted while the delivery is locked.
- A delivery email sent twice for one event, or sent with no final files.
- An engineer seeing a dollar amount.

## Approaches considered
- **A. A delivery record per booking, with its own link (chosen).** New `sessionDeliveries` table plus one
  optional flag on `mediaAssets`. The link, the state and the stats live on one row, and the public page
  only ever reads through that row. Smallest change to existing code: one call added in `settlePayment`.
- **B. Reuse `collaboratorGrants` with a new scope.** Gives expiry and revoke for free, but grants are
  capability-gated, counted against the plan's magic-link cap, and have nowhere to hold "waiting for
  payment" or download counts. A delivery blocked by a plan cap would be a bug.
- **C. Push session files through song Deliverables and the artist portal.** The gate already exists
  there, but it needs a song on every booking, a portal link per client, and approval states staff do not
  want for a zip of stems. Too heavy for "send them the files".

## Design

### Data (all new fields optional)
- `mediaAssets.clientFinal?: boolean`: this file is part of the delivery.
- `sessionDeliveries` (new): `orgId`, `sessionId`, `status` (`awaiting_payment` | `released` | `off`),
  `token` (32 random bytes, hex), `expiresAt`, `readyAt`, `readyBy`, `releasedAt`, `releasedBy`
  (`payment` or the member's name), `sentTo`, `lastSentAt`, `sendCount`, `firstOpenedAt`, `lastOpenedAt`,
  `downloadCount`, `urlWindowStart`, `urlCount`. Indexes: `by_session`, `by_token`, `by_org`.
  One row per booking.

### State
```
(no delivery) --Ready to deliver--> balance 0 ?  yes -> released  (email: files ready)
                                                 no  -> awaiting_payment (email: pay to unlock)
awaiting_payment --payment settles to 0 / comp--> released (email: files ready)
awaiting_payment --"Send now anyway" (owner, manager)--> released (email: files ready)
released | awaiting_payment --Turn off link--> off      off --Ready to deliver--> as above, new token
```
Once released, a delivery stays released until staff turn it off or it expires. A later rate change does
not lock it again.

### Server (`convex/sessionDelivery.ts`)
Staff, through `staffSession` like the rest of session files:
- `setFinal({ assetId, final })`: `deliverables.upload`.
- `status({ sessionId })`: state, final file count, client email on file, stats, what the caller may do.
  The balance amount is returned only to callers with money sight (`currentMoneySight`).
- `markReady({ sessionId })`: `deliverables.upload`. Needs at least one final file and a client email.
- `releaseNow`, `turnOff`: `schedule.manage` (owner, manager). `resend`, `copyLink`: `deliverables.upload`.
- `onBalanceSettled(ctx, sessionId)`: internal, called from `settlePayment` when `fullyPaid`, and from
  `sessions.setComp` when a comp leaves nothing owed. Releases an `awaiting_payment` delivery exactly once.

Public, token only:
- `page({ token })`: studio name, logo URL, accent, booking title and date, client first name, state
  (`unlocked` | `locked` | `expired`), final files (name, size, type, version id), the balance and pay URL
  when locked, expiry. Never a file URL. Unknown, off, expired and wrong tokens all return the same `null`,
  so the expired page is generic and carries no studio name.
- `fileUrl({ token, versionId })`: mutation. Re-checks token, expiry, `released`, that the version's asset
  belongs to this booking and this studio and is `clientFinal`, then mints a 10 minute signed GET that
  saves under the original file name. Counts the download. At most 120 per hour per delivery.
- `opened({ token })`: stamps first and last opened, at most once a minute.

### Email
- New template `convex/lib/emailTemplates/sessionDelivery.ts` on top of `studioEmailHtml` with the
  studio's accent and a readable button ink (`readableEmailInk`).
- Sent through the existing `notify` path, so it is logged on the booking and goes out the way every
  booking email does: from "<Studio> via Pulse" (Resend), replies routed to the studio. `notifications`
  gains optional `html`, `ctaLabel`, `ctaUrl`, `accent`.
- Files ready: subject `Your files from <booking title> are ready`. Button: Download your files.
- Pay to unlock: subject `Your files are ready. One step left`. Button: Pay and unlock. Sent once.
- When a payment both settles the balance and releases a delivery, the client gets the files email with
  a "payment received" line and the plain "Paid in full" email is skipped. One email, not two.

### Client page (`/delivery/<token>`)
Public route in `src/middleware.ts`, `noindex`, `Referrer-Policy: no-referrer`, no third-party scripts.
States: loading skeleton, unlocked, locked (file names and sizes shown, no downloads, Pay button to the
existing `/book/<slug>/checkout/<sessionId>`), expired or off (one message, "ask the studio for a new
link"). Audio files get an inline player. The page is live: it unlocks by itself when the payment lands.
Link lifetime 30 days; resending starts a fresh 30 days.

### Staff panel
The Files section of the session panel gains a drop zone, an upload queue with progress and cancel
(`XMLHttpRequest` upload events; same three-step R2 flow), a Final toggle on each row, and a delivery
card with the four states in the mockup.

## Data flow (no new vendors)
| Data | Stored | Leaves through |
|---|---|---|
| File bytes | Cloudflare R2 private bucket (existing) | 10 minute signed GET, only after the checks above |
| Client email, name | Convex `artists` (existing) | Resend (existing) |
| Delivery link token | Convex `sessionDeliveries`, `notifications` | The email to the client; staff "Copy link" |
| Payment | Stripe (existing) | not touched |
No AI in the path. No new cookies, pixels or form fields on the public page.

## Left to the builder
- Component split inside `session-extras.tsx`; whether the delivery card is its own file.
- How `notifications.deliver` passes the button through to Gmail sends.
- Setting the download file name on the signed URL (response content disposition) with the R2 component.
- Exact rate-limit bookkeeping.
