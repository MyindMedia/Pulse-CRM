# Fixes for the 2026-11-12 review (R01 to R44)

Every finding in `REVIEW-2026-11-12.md` was fixed on `integration/truth-fixes`. Each commit message starts with the finding ids it fixes. Where two ids describe the same defect, they share one commit.

**Counts:** 44 of 44 fixed: 13 major and 31 minor. 18 findings were duplicates of another id, so there were 26 distinct defects.

- None had already been fixed by the merges. For R03/R04, R05/R06 and R28/R29, part of the fix was already on the branch, and the commits finish the rest. The notes below say which part.
- None was left unfixed.
- None of the changes alters how money is charged or refunded, how cards are saved, payroll math, plan gates, allowances or entitlements, or what the assistant may send without approval.

**Checks on the final commit:**
- `npx tsc --noEmit`: clean.
- `npx vitest run`: 4,057 tests, 4,054 passed and 3 failed (380 files, 377 passed). The 3 failures are the known ones: `convex/lib/agentScope.test.ts`, `convex/marketing/results.test.ts`, and the live-call case in `convex/outreachCalls.test.ts`.
- `npm run lint`: 164 problems (53 errors, 111 warnings), exactly the same as before these commits. None is in a file these commits touch.

Every new test was run against the old code and seen to fail, except where the table says it was not.

| id | sev | status | what changed | test that proves it |
|---|---|---|---|---|
| R01 | major | fixed | `convex/booking.ts`: a 0%-deposit booking is confirmed outright only when the start is more than 2h 15m away. Closer than that it keeps the old 60-minute hold, and the hold message asks for the full price. Deposit amounts and charging are unchanged. | `convex/holdMessageTruth.test.ts` "a 0% deposit room booked under 2h15m before start stays a hold for the full price" |
| R02 | major | duplicate of R01 | same commit | same |
| R03 | major | fixed | `convex/waitlist.ts`: `proposeWaitlistFill` skips entries that already have an open offer (proposed, approved, snoozed or executing), read through the `by_org_status` index with a bound. The payload id, and finalize marking that exact entry, were already on the branch. | `convex/waitlist.test.ts` "two slots freed before approval go to two different people, each offer naming its entry", "finalize marks the offered entry, not another entry with the same email" |
| R04 | major | duplicate of R03 | same commit | same |
| R05 | major | fixed | Fees were already recorded when paid. `convex/lib/recoveryOnPaid.ts` now also moves an old fee event, logged at billing, to its paid month. `recoveryRecap.ts` reads unpaid fee invoices for the month and sends the recap when `totalCents <= 0 && pendingCents <= 0` is false. | `convex/recoveryRecapTruth.test.ts` "a fee billed in October and paid in November is counted in November", "...moves to the month it is paid", "a month with only unpaid fees still sends the follow-up prompt" |
| R06 | major | duplicate of R05 | same commit | same |
| R07 | major | fixed | `parseIcal` (`convex/externalCalendarsActions.ts`) stores all-day events from midnight to midnight in the studio's own time zone (`zonedMidnight` in `convex/lib/tz.ts`), and skips events marked cancelled or free. | `convex/externalCalendarsParse.test.ts` "parseIcal: what counts as busy" |
| R08 | major | duplicate of R07 | same commit | same |
| R09 | major | fixed | `convex/lib/roomBusy.ts`: a feed event that is Pulse's own pushed event (a Pulse event id, or a session's Google event id) no longer blocks the room. | `convex/externalCalendarBusy.test.ts` "a feed's copy of a Pulse booking does not block" (3 cases, plus one showing a real outside event still blocks) |
| R10 | major | fixed | `CLIENT_REBOOK_ACK` and the manager alert no longer promise a held deposit. If no one could be told, the client gets the existing "nobody told" text. | `convex/smsConfirmTruth.test.ts` "NO then REBOOK never promises a held deposit, to the client or the managers" |
| R11 | major | fixed | `PRICING.max.unlimitedStudios` is now false; only copy reads it. Unlimited-studios, flat-price, pooled-allowance and web-address wording is gone from these places:<ul><li>the /pricing hero, meta description and FAQ</li><li>the plan cards and the access table (Studios: "One")</li><li>the app list</li><li>llms.txt</li><li>/mypulse</li><li>the beta-ending email</li><li>the structured data</li></ul>ALLOWANCES and the plan gates are unchanged. | `src/app/pricing/pricing.test.ts` block "Max is not sold on many studios or a web address". The flag tests in `convex/pricing.test.ts` were updated to the new behaviour. |
| R12 | major | fixed | The Max lists in `PLAN_FEATURES` and the `pricing-panel` lead and tierBullets no longer offer studios, a web address or split sheets. The agency branding screen no longer says a custom domain comes with the plan; that is copy only, and the field is unchanged. | Same test block, including "the agency branding screen does not say a custom domain comes with the plan" |
| R13 | major | fixed | Health widget is hidden by default (`widget-registry.tsx`). `studioHealthFor` reads only bounded, indexed windows (`HEALTH_READ_CAP` = 300 per read) and no longer calls `.collect()`. | `convex/agentHealth.test.ts`; `widget-registry.test.ts` now asserts the widget is hidden by default |
| R14 | minor | fixed | The staff activity row and insight say "confirmed (no deposit due)" for a confirmed 0% booking. | `holdMessageTruth.test.ts` "staff activity and insight for a confirmed 0% booking do not describe a hold" |
| R15 | minor | fixed | The checkout page treats `depositCents === 0` as pay-in-full and shows "booked, balance due" for a confirmed booking (`src/lib/checkout-view.ts`). The booking toast is chosen from the createBooking result. | `src/lib/checkout-view.test.ts` |
| R16 | minor | fixed | `clientPolicyText(org, room?)` words the policy for full-pay and 0% rooms. The studio-wide text no longer depends on the room. | `convex/forfeitTruth.test.ts` "booking page policy line per room" |
| R17 | minor | duplicate of R16 | same commit | same |
| R18 | minor | fixed | When an engineer accepts an unpaid public hold, the engineer is booked but the session stays tentative. Paid or internal sessions are still confirmed. "Paid" now needs money actually received, so a short-notice 0% hold (deposit 0) is not treated as paid; the review of these fixes caught that case. The old "accepting finalizes" test now pays the deposit first, so it keeps its meaning. | `convex/engineerRequest.test.ts` "accepting an unpaid public hold books the shift but leaves it tentative", "accepting a short-notice 0% public hold (nothing paid) leaves it tentative" |
| R19 | minor | fixed | The no-show email promises a card charge only when `canAutoCharge && invoiceId`, the same condition that schedules the charge. | `convex/noShowShield.test.ts` "does not promise a card charge when no charge is scheduled" |
| R20 | minor | duplicate of R18 | same commit | same |
| R21 | minor | fixed | `sendPayLinkSms` throws "This client replied STOP to texts. Copy or email the pay link instead." for an opted-out number, and the session sheet shows that message. | `convex/refusalReasons.test.ts` "a pay link to a client who replied STOP says so instead of reporting it texted" |
| R22 | minor | fixed | A YES reply is acknowledged when the session is confirmed, in progress or completed. An unconfirmed YES now answers the client as well as alerting the managers. | `convex/smsConfirmTruth.test.ts` (4 YES cases) |
| R23 | minor | duplicate of R15 | same commit | same |
| R24 | minor | fixed | `dropPreChecklistFor` now runs on stale-hold archive, hold expiry and forfeit (`automation.ts`) and on booking-request decline. | `convex/bookingChecklists.test.ts` (3 new cases); `convex/bookingRequests.test.ts` "declining drops the request's pre-session checklist" |
| R25 | minor | fixed | Recurring feed events are expanded over now − 1 day to now + 180 days, with EXDATE and moved occurrences honoured. Each occurrence gets a uid of `uid:start`, and a series is capped at 500 occurrences. | `externalCalendarsParse.test.ts` "parseIcal: recurring events" |
| R26 | minor | duplicate of R25 | same commit | same |
| R27 | minor | fixed | `refreshDue` schedules one refresh per due feed, found through the `by_active_sync` index. Only a bounded window of events is stored, and unchanged rows are not rewritten. | `externalCalendarsParse.test.ts` "parseIcal: stored window"; `externalCalendarBusy.test.ts` "feed refresh keeps writes and staleness bounded" |
| R28 | minor | fixed | A fee or reminder bill paid with studio credit records no recovery event, and the recap skips old credit-settled events. | `convex/recoveryOnPaid.test.ts` "a fee marked paid with studio credit records no recovery event" and 2 more; `recoveryRecapTruth.test.ts` "does not count a fee settled with studio credit" |
| R29 | minor | duplicate of R28 | same commit | same |
| R30 | minor | fixed | "canceled hours it resold" is removed from `convex/lib/pricing.ts` and `src/app/mypulse/features.ts`, and "Waitlist backfills" from the recap labels. | `recoveryRecapTruth.test.ts` "does not claim canceled hours it resold" (wording; not run against the old code) |
| R31 | minor | duplicate of R30 | same commit | same |
| R32 | minor | fixed | `opsActions.execute` does not email a waitlist offer once the slot was texted, claimed or rebooked, or the entry is no longer waiting. The action is recorded as `noted: not sent, <reason>`. | `convex/waitlist.test.ts` "does not email an offer for a slot ..." (4 cases) and "still emails the offer when the slot is open and untouched" |
| R33 | minor | duplicate of R21 | same commit | same |
| R34 | minor | duplicate of R03 | same commit | `waitlist.test.ts` "two slots freed before approval go to two different people ..." |
| R35 | minor | fixed | "Step-by-step setup" moved to a Core platform row. The multi-studio group now has no built rows and is dropped from the public table. | `convex/pricing.test.ts` "drops the multi-studio group" (counts updated) |
| R36 | minor | fixed | New Core row "Switch off parts of the app you do not use", with its detail text. | `convex/pricing.test.ts` (public count 139 → 140) |
| R37 | minor | fixed | The portal concierge says "send the studio a message in the Messages box on this page" in all three places. | `convex/portal.test.ts` fallback-answer test |
| R38 | minor | fixed | The tax checkbox reads "Plan to charge tax (not active yet)", and the hint says the setting is saved for records only. | `src/components/settings/tax-copy.test.ts` |
| R39 | minor | fixed | An approved email or text with no recipient is recorded as failed with "not sent: no recipient", and the stored result never prints "null". The approve button needs a recipient and a message. | `convex/agent.test.ts` "an approved email or text with no recipient is recorded as failed, never 'null'", "the approve button needs a recipient and a message" |
| R40 | minor | duplicate of R39 | same commit | same |
| R41 | minor | fixed | `requestTimeOff` formats the dates in the studio's time zone, using `dateLabel` and `orgTz`. | `convex/availability.test.ts` "the time-off alert names the days in the studio's own zone" |
| R42 | minor | duplicate of R41 | same commit | same |
| R43 | minor | fixed | The "Make one" button now works on gear that has no label. | `gear-history.test.tsx` "lets an editor make a code for gear with no label yet" |
| R44 | minor | fixed | When the assistant is off, the Daily summary switch shows off and disabled, with a line saying the summary is paused. | `src/components/settings/daily-summary-panel.test.tsx` |

## Review of these fixes

A separate reviewer read the whole diff. It found one defect that the fixes themselves introduced: an engineer accepting a short-notice 0% hold confirmed it unpaid, because R01 and R18 interacted (`0 >= 0`). That is fixed in its own commit, with a test that fails without the fix. It also pointed out that the "hold expiring" text still asked a 0% short-notice hold to "pay the deposit"; it now says "Pay in full". That is wording only and has no test. Everything else it checked held up:
- the hold payment and release path
- the waitlist exclusion and the blocked-email check
- recovery dating and de-duplication
- the calendar diffing and the feed refresh fan-out
- that every index the changes use exists
- the assistant send with no recipient

One note, not fixed: the health score reads at most 1,200 payments for the month, so a very busy studio's revenue part of the score can be undercounted.

## Behaviour changes worth knowing before staging

- **Short-notice 0% bookings (R01):** a 0%-deposit booking made within 2h 15m of its start is a 60-minute hold, paid in full to confirm, as before #199.
- **Engineer accepts an unpaid hold (R18):**
  - When an engineer accepts an unpaid online hold, the booking stays tentative until the client pays.
  - The manager override still confirms it outright.
- **Outside calendar feeds (R27):**
  - Feeds now keep only events from 1 day back to 180 days ahead. The staff grid stops showing feed events that ended more than a day ago, once the feed re-syncs.
  - The first sync of a feed with a long history deletes those old events once.
- **Health score (R13):** released songs no longer count as stalled projects.
