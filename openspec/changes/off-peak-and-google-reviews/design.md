## Pricing

`offPeakRoomCents({ hourlyRateCents, windows, startTime, durationHours, tz })` walks each booked hour, reads its studio-local weekday and hour, and applies the best matching window's percent. Pure, in `convex/lib`, imported by `booking.createBooking` and by the booking page through the `@convex/lib` alias so the shown price and the charged price come from one function.

Only room time is discounted (add-ons and service fees are not). Services priced per service (flat or block) are not discounted; hourly services are. Promo vs off-peak: compute both totals, bill the lower, record which applied (`sessions.offPeakCents` = discount amount). Not stored as `compType: "discounted"` (that is the comp report's foregone-revenue marker).

Staff bookings and reschedules keep today's typed or pro-rated rate.

## Consent

`artists.dealsOptInAt`, `dealsOptInSource` ("booking_form" | "sms_keyword"), `dealsConsentVersion`, `lastDealTextAt`. The form box is unchecked and never clears an existing opt-in. DEALS by text opts in every client record with that phone in the studio that last texted the number and replies with a confirmation that names STOP.

## Gap finder

`freeBlocks(busy, dayStart, dayEnd, minMs)` in `convex/lib/gaps.ts`: busy intervals (sessions, room blocks, Google busy via `roomBusyIntervals`) padded by the 15-minute reset buffer, open hours 9:00 to 22:00 studio time (the booking page's hours). Returns blocks of at least 3 hours.

## The agent's call

`convex/lib/typesafe.ts` posts to `https://api.typesafe.ai/v1/systemone` with `TYPESAFE_API_KEY`, model `jev-latest`. State: the room, the gap (weekday, local start and end, hours), normal and off-peak rate, recipient count, how many of tomorrow's bookable hours in this room are already booked, the room's booked share of the same weekday over the last 4 weeks, days since this studio's last deal text. One Choice: send (a short deal text is likely to help fill this gap without wearing out the list) or skip.

Policy in code: no key, error or timeout: inbox. `skip` with confidence at least 0.3: no draft, logged. `send` in Auto mode with confidence at least 0.6: send. Everything else: inbox. Thresholds are constants to tune on real outcomes.

## Approval and send

`opsActions` type `gap_deal_text`, payload `{ kind: "sms_blast", roomId, gapStart, gapEnd, body, artistIds }`, deduped `gap_deal:<roomId>:<date>`. `approve` schedules `execute`; the `sms_blast` branch waits for 10am to 7pm studio time if needed, re-reads each artist (opt-in, STOP, 8-day cap, phone), sends, stamps `lastDealTextAt`, logs each text to the client's thread, then finalizes. A gap that has since been booked is not texted.

## Reviews

`REVIEW_THANKS` and `REVIEW_LOW_ACK` gain an optional Google line (`[[ ... {google} ]]`), filled only when `orgs.googleReviewUrl` is set. The URL must be https on a Google host (google.com, g.page, goo.gl, maps.app.goo.gl, search.google.com).

## Decisions made while building

- **8-day cap, not 7.** The disclosure promises "up to 4 texts a month". Seven days allows five in a 31-day month; eight days caps it at four.
- **One gap per studio per day.** The sweep takes the longest free block across rooms. The per-client cap would stop most second texts anyway, and one offer a day keeps the inbox readable.
- **Platform switch `DEAL_TEXTS_LIVE`.** Deal texts are marketing. Until the shared number's carrier campaign covers marketing, nothing is drafted or sent even when a studio turns the feature on. Consent is still collected. Set `DEAL_TEXTS_LIVE=true` in the Convex env once Zuops confirms.
- **The agent decides only send or skip.** The text itself is built by code from the room, the time and the off-peak rate, and the owner can edit it before approving (300 characters max).
