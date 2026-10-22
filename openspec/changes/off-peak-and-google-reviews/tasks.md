## 1. Rules (pure)
- [x] 1.1 `convex/lib/offPeak.ts`: window validation, hour-by-hour room price, better-of with promo
- [x] 1.2 `convex/lib/gaps.ts`: free blocks of 3+ hours inside open hours
- [x] 1.3 Google review URL validator

## 2. Backend
- [x] 2.1 Schema (additive): room windows, org switches + mode + review URL, artist consent fields, `gap_deal_text` type + `sms_blast` payload, `sessions.offPeakCents`
- [x] 2.2 `booking.createBooking`: off-peak pricing, opt-in arg; public room data carries windows
- [x] 2.3 DEALS keyword
- [x] 2.4 `convex/lib/typesafe.ts` + `convex/gapDeals.ts`: sweep, recipients, agent call, draft or auto-send
- [x] 2.5 `opsActions`: approve/execute `sms_blast` with send hours and re-checks
- [x] 2.6 Review texts with the Google link
- [x] 2.7 Settings mutations: growth settings, room windows

## 3. Frontend
- [x] 3.1 Booking page: off-peak price + tag, opt-in box, FTC review note
- [x] 3.2 Settings "Growth" tab
- [x] 3.3 Inbox label for gap deal texts

## 4. Tests
- [x] 4.1 offPeak, gaps, URL validator unit tests
- [x] 4.2 createBooking off-peak vs promo, opt-in stored
- [x] 4.3 DEALS keyword, review link to every rater
- [x] 4.4 gap sweep: draft in approve mode, auto send when confident, inbox when uncertain or no key; send re-checks consent and caps
