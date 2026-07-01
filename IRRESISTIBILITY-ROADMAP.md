# Pulse Irresistibility Roadmap

_Four-agent assessment, 2026-07-01: owner-value lens (code-traced), operator-day lens (code-traced), growth/client-facing lens (code-traced), competitive research (web, cited). Synthesized and cross-ranked._

## The thesis

Pulse already detects money problems better than anything in the category. What it doesn't yet do is **act on them automatically and take credit for the dollars**. Three of four agents independently converged on the same conclusion:

> Detect -> automatically act (charge, invoice, remind, reprice) -> attribute the recovered dollars back to Pulse.

The research agent confirmed the market framing: studio owners run at 10-15% margins and their switching trigger is always a **money-loss event** (a no-show week, a bounced check, a double-booked A-room). The objection to $49-199/mo is "Google Calendar is free." The answer is not more features - it is **"Pulse recovered $2,140 for you this quarter."** Sell recovered revenue, not software.

Competitive position (researched, cited in the full report): Pulse sits in a near-empty middle - 4-40x cheaper than StudioHero ($205/mo, annual contract, paid add-ons) and AlterMedia, far deeper than $5-30 generic schedulers, music-native where GHL/HoneyBook are generic. The only like-for-like (Sonido) has zero reviews. **The category has no Squire yet.** The marketplace incumbent (Studiotime) is dead; the only demand-gen play (Stufinder) takes 10% commission.

---

## Tier 0 - Fix this week (trust bugs found by the assessment)

| # | Fix | Evidence | Effort |
|---|-----|----------|--------|
| 0.1 | **Discount codes do nothing.** AI + settings generate/manage codes and email `?code=` booking links, but `createBooking` has no code arg, the room page never reads searchParams, checkout charges full price. | `convex/aiActions.ts:402`, `convex/booking.ts:318,609` | S |
| 0.2 | **Invoice math ignores money collected.** Completion auto-invoice bills `rate - deposit`, ignoring `amountPaidCents` (over-billing risk). Cron-completed sessions never invoice at all. | `convex/sessions.ts:439-449`, `convex/automation.ts:154-165` | S |
| 0.3 | **Invoice "Send reminder" is a fake toast** - no backend call. | `src/components/payments/invoice-actions.tsx:127` | S |
| 0.4 | **AI recap emails leak raw `{{user_FirstName}}` tokens** via mailto; nothing auto-sends. | `convex/aiActions.ts:71-78`, `draft-card.tsx:150-161` | S |
| 0.5 | **`payDeposit` skips the payments ledger** (deposit flips state with no payment row). | `convex/sessions.ts:334-375` | S |
| 0.6 | **Daily digest ignores its own `digestHourLocal` setting** and is never delivered anywhere. | `convex/agent.ts:749-767` | S |

## Tier 1 - The flagship: "Pulse pays for itself" (build next)

**1. No-Show Shield.** Card-on-file (client SetupIntent), cancellation-policy object per org/room (windows + fee %), auto-charge or deposit-forfeit on no-show/late-cancel, auto-message to the client, waitlist offer fires on no-shows (today only on cancellations - `convex/sessions.ts:408-410`). Mangomint's reminders alone cut no-shows ~20%; Squire made auto-charging its wedge. **This is the feature the sales page leads with.** (L)

**2. Auto-invoice + dunning ladder.** On session completion with a balance: auto-create + send invoice with pay link; 3/7/14-day reminder sequence; escalation flag. Today overdue invoices are chased exactly once (`overdueNotifiedAt` gate, `convex/automation.ts:168-207`). (M)

**3. "Recovered by Pulse" ROI ticker.** Attribute deposits kept, reminder-driven payments, waitlist backfills, no-show fees -> a dashboard tile + monthly email: "Pulse recovered $X." The renewal-proof number; kills the price objection. (S-M)

**4. Collect-balance button on the session sheet.** Stripe pay link + QR + optional SMS from the completed session (generator exists at `convex/booking.ts:592-630`, only wired to public checkout; today collecting is ~7 steps with retyped amounts). (M)

**5. Internal-booking deposit links.** Staff-created sessions get the same auto-sent deposit link the public flow has (`automation.ts:46` skips everything `source !== "public_booking"`). (S)

## Tier 2 - The operator habit loop (daily delight, mostly S effort)

- **"Today" command center**: today's sessions in order, who's in which room + busy-until, arrivals, balances due today, staff on shift, tomorrow preview. Dashboard today is MTD analytics only; `roomStatus` computes busyness but discards `endTime`. (M)
- **Mobile tab bar**: surface Calendar/Bookings/Payments (today hidden behind "More" via `.slice(0,4)` in `mobile-tabbar.tsx:31`); default calendar to Agenda on phones. (S)
- **One-tap "Book again"** prefilled from the prior session. (S)
- **Check-in everywhere**: `BookingSheet` on /bookings is a status dead-end; reuse the Calendar SessionSheet actions. (S)
- **Mid-session ops**: extend/reschedule mutation (none exists - overtime can't be billed or conflict-checked), add gear to an existing session, elapsed timer for in_progress. (M/L)
- **Real staff notifications**: `notifyTeam()` emails only the owner; bell shows AI insights, not transactional events; add per-member routing + web push (needs the missing PWA manifest). (M)
- **Wire the orphaned engineering-log editor** (backend exists, zero UI call sites). (S)

## Tier 3 - The growth engine (client-facing + loops)

- **Post-session review + referral prompt** (24h after completion: review link + `?ref={artistId}` referral link writing the never-written `referredByArtistId`). The single highest-leverage missing loop. (M)
- **Portal upgrades**: "Book again" CTA, "Pay" links on open invoices (route exists, never linked), **deliverables in the portal** (approved mixes downloadable - kills WeTransfer and gives artists a reason to return). (S-M)
- **Booking-page social proof**: testimonials, engineer bios/credits, audio embeds. Selling $100+/hr time with zero proof-of-work. (M)
- **SMS hold confirmations + T-15 expiry nudge** (infra built; holds are email-only today). (S, blocked on A2P)
- **Onboarding "your page is live - share it" moment + client CSV import** (only exports exist today). (S-M)
- **Clickable "Powered by Pulse"** with attribution - especially on split sheets, which go to collaborators at other studios. (S)
- **One-time packages / prepaid hour blocks** (subscriptions exist; the handshake-standard "10-hour block" product does not). (M)
- **Booking-funnel tile**: "your booking page earned $X from N new clients" - the data exists, the story is never told. (S)

## Tier 4 - Category-king moves (strategic, from the research)

1. **AI receptionist** answering the studio's phone/SMS/IG DMs and booking rooms 24/7. 85% of unanswered callers never call back; Zenoti shipped this for salons; **nobody has it for studios**. Pulse already owns the ops agent + conflict-aware booking engine - this is the $199-tier justification and the demo that closes deals.
2. **Free white-glove migration, "live in 24 hours"** - guaranteed, on the pricing page. The #1 documented switching friction is setup pain (months for AlterMedia, "brutal" GHL curve). Cheap at current scale, devastating vs StudioHero's annual contract.
3. **Payments-monetized entry tier** (Squire playbook: lower/free SaaS if payments run through Pulse; take rate becomes the revenue line; later: instant payouts, studio capital).
4. **Engineer payout automation as lock-in**: session ends -> engineer cut computed (commission/hourly/points) -> payout queued -> tied to time clock + split sheets. Squire's stickiest feature; no studio competitor touches it; Pulse already has payroll + splits to fuse.
5. **"Find a Studio on Pulse" directory** - Studiotime is dead, Stufinder takes 10%; a free SEO directory with live availability makes Pulse a lead source, not a cost. ("The struggle is always getting in new clients" - CRC studio manager.)
6. **Annual "State of the Recording Studio" benchmark report** from anonymized Pulse data (Jobber's authority playbook; owners are starving for numbers - rates flat 4 years).
7. **Anti-StudioHero comparison page**: $129 flat, monthly, cancel anytime, all features included vs $205/mo + annual contract + $75 calendar sync + $250 QuickBooks add-ons.

## Suggested build order

1. **Tier 0 bug sweep** (one day, restores trust in what's shipped)
2. **Tier 1 items 2+3+4+5** (auto-invoice/dunning, ROI ticker, collect-balance, internal deposit links) - the provable-ROI core without waiting on card-on-file
3. **Tier 1 item 1 (No-Show Shield)** - the flagship, with card-on-file
4. **Tier 2 Today view + tab bar + quick wins** in parallel with
5. **Tier 3 review/referral loop + portal upgrades**
6. **Tier 4 AI receptionist** as the next big swing once the money loop is closed

_Full agent reports (file-level evidence, competitor table, pain quotes, sources) live in the session transcript of 2026-07-01._
