## Why

Owner request, 2026-10-21: off-peak pricing that fills empty room hours, and Google reviews from happy sessions ("lets setup 4 and 5"). Revised the same day: "the decider to send out comes from the AI agent and the owner manager can verify or gate it to be manually approved. they can select auto also if they choose." Decisions in `Grilled.md` (Off-peak pricing, gap deal texts, Google review link).

Today a room has one hourly rate, promos need a code, nobody is told when tomorrow has a big hole, and the SMS review flow thanks 4-5 star raters without ever pointing them at Google.

## What Changes

- **Off-peak windows per room**: days of week, start and end hour in studio time, percent off. `createBooking` prices the room hour by hour (a booking crossing a window edge pays the off-peak rate only for the covered hours). Off-peak never stacks with a promo code: the client pays the better of the two, and a promo that loses is not redeemed. The booking page shows the off-peak price and an "Off-peak" tag. Prices already booked never change.
- **Deal-text opt-in**: an unchecked "Text me deals" box on the public booking form (separate from the existing reminders consent), and the DEALS keyword by text. Consent records time, source and disclosure version. STOP still blocks everything.
- **Gap deal texts**: an hourly cron acts at 9am studio time. For each room it finds free blocks of 3+ hours tomorrow, picks recipients (opted-in, not opted out, no deal text in 8 days, booked this room in 12 months, else any opted-in), and asks the Pulse agent (TypeSafe Jev Choice: send or skip) whether the gap is worth a text. Per studio mode: "Approve each" (default) puts every "send" into the approval inbox as `gap_deal_text`; "Auto" sends a confident "send" itself and still routes uncertain calls to the inbox. Sending happens only 10am to 7pm studio time, re-checking consent and caps at send time.
- **Google review link**: a studio setting for its Google review URL. After any 1-5 reply the client gets the link (no review gating); 1-3 still alerts managers privately. No URL keeps today's texts.
- **FTC copy**: the booking page reviews say "Showing reviews rated 4 or 5 stars".
- **Settings**: a "Growth" settings tab holding the off-peak switch and per-room windows, the deal-text switch and mode, and the Google review URL. Every behavior is off by default.

## Impact

`convex/schema.ts`, `convex/booking.ts`, new `convex/lib/offPeak.ts`, `convex/lib/gaps.ts`, `convex/gapDeals.ts`, `convex/lib/typesafe.ts`, `convex/lib/smsKeywords.ts`, `convex/smsFlows.ts`, `convex/lib/smsTemplates.ts`, `convex/opsActions.ts`, `convex/lib/agentScope.ts`, `convex/crons.ts`, `convex/orgs.ts`, booking page components, settings page, inbox labels. New env: `TYPESAFE_API_KEY` (Convex, server only).
