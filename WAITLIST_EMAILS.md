# Waitlist nurture sequence

The 3-email onboarding sequence sent to Pulse's owned-channel marketing list
(the `subscribers` table). This is the human-readable source of the copy; the
rendered version lives in `convex/lib/waitlistEmails.ts`. **Keep the two in
sync** when the copy changes.

## How it works

- **Capture:** the "Get product updates" form in the marketing footer
  (`src/components/marketing/waitlist-form.tsx`) calls the public
  `subscribers.join` action. It stores a `subscribers` row (source of truth) and
  pushes the address to the Resend Audience so the MYI-52 newsletter broadcast
  reaches them too.
- **Send engine:** `convex/subscribers.ts` `nurtureSweep` runs hourly
  (`convex/crons.ts`) and on each new signup. It sends the earliest due step,
  marks it in `subscribers.nurtureSent`, and is idempotent per subscriber per
  step (same pattern as the reminder crons). Sends no-op to `simulated` until
  `RESEND_API_KEY` is set.
- **Cadence:** Day 0 (immediate) / Day 2 / Day 5, measured from signup.
- **Unsubscribe:** every email links to `GET /unsubscribe?email=...` on the
  Convex HTTP router, which flips the subscriber to `unsubscribed`.
- **Env:** `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, `RESEND_FROM`, `APP_URL`,
  `CONVEX_SITE_URL` (for the unsubscribe link).

House rule: no em dashes anywhere. Copy is em-dash-stripped again at the send
point regardless.

---

## Email 1 - Day 0 (welcome)

**Subject:** You're on the list. Here's what Pulse does.
**Preheader:** The operating system for recording studios - the quick version.
**Heading:** Welcome to Pulse
**CTA:** See how it works -> `/#features`

Thanks for joining the list. You'll hear from us a few times over the next week,
then only when there's something worth your inbox.

Pulse is the operating system for recording studios: bookings, rooms, staff,
inventory and payments in one place, with the busywork automated. Clients book
and pay online, deposits and reminders fire on their own, and your calendar,
your rooms and your team stay in sync without the spreadsheet juggling.

The studios running on Pulse spend less time chasing confirmations and more time
in the room. Over the next couple of emails we'll show you exactly how.

---

## Email 2 - Day 2 (the problem / story)

**Subject:** The money studios lose without noticing
**Preheader:** No-shows, forgotten deposits, and the follow-ups nobody sends.
**Heading:** Where studio revenue leaks
**CTA:** See the numbers -> `/#features`

Most studios don't lose money on the sessions they book. They lose it on the
ones that quietly fall apart: the no-show that never paid a deposit, the reminder
nobody sent, the balance that went uncollected, the open slot no one backfilled.

Pulse closes those leaks automatically. Deposits are required up front, reminders
go out at 24 hours and 2 hours, unpaid holds release themselves, and the waitlist
backfills a cancellation before the slot goes cold.

Every dollar Pulse recovers gets tallied, so at the end of the month you can see
exactly what the automation earned back for you.

---

## Email 3 - Day 5 (the ask)

**Subject:** Ready to run your whole studio on Pulse?
**Preheader:** Pick a plan, connect Stripe, take your first booking today.
**Heading:** Take your first booking on Pulse
**CTA:** Get started -> `/#contact`

You've seen what Pulse does and where it pays for itself. Getting started takes
about ten minutes: pick a plan, connect your Stripe, and your online booking page
is live.

No long setup, no migration project. Bring one room and one client to start, and
add the rest of your studio as you go.

If you'd rather see it first, just reply to this email and we'll walk you through
it personally.
