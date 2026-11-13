# RD: Interns told to stay clocked in, then not paid for it (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `client-messages-intern-stay-clocked-in`.
Code read on `develop` (2026-11-12).

## What Pulse says
At 4 hours an intern is texted: "Interns need approval to continue. Reply EXTEND to request permission, or clock out now." (`convex/lib/smsTemplates.ts:120-122`). After EXTEND: "Request sent - stay clocked in while a manager reviews. We will text you the decision." (`convex/lib/smsTemplates.ts:124-125`)

## What actually happens today
1. The intern replies EXTEND. Pulse marks the entry `internExtension: "requested"` and texts every manager with a phone an approval prompt that lasts 60 minutes (`convex/smsFlows.ts:470-493`, `APPROVAL_WINDOW` at `:62`).
2. If no manager answers in time, or no manager has a phone number (then no approval prompt is even created and the intern's own prompt is already answered), the next sweep finds the entry timed out (`convex/smsFlows.ts:645-658`).
3. `_capInternEntry` closes the entry at **clock-in + 4 hours** (`convex/smsFlows.ts:712-730`), and the intern is told "your time was capped at 4 hours and you are clocked out" (`convex/lib/smsTemplates.ts:133-134`).
4. Everything the intern worked between hour 4 and the timeout (up to about 75 minutes, longer if the sweep is late) was worked because Pulse told them to stay, and is removed from their hours.

## Who is hurt and how
- **The intern** works time they were told to work and is not paid for it, if they are paid hourly. Even an unpaid intern loses the record of hours worked (school credit, hour logs).
- **The studio** carries a wage-and-hour risk: in most places, time an employer permits or instructs someone to work must be paid, even if it was not approved in advance.

**Can it be happening in production now?** Yes, at any studio with interns clocking in. How the owner can check: production `timeEntries` with `autoClosedReason: "intern_timeout"`; for each, the `smsPrompts` rows on that entry show when the intern asked and when the manager prompt expired, which bounds the unpaid time.

## Cause (verified on develop)
`convex/smsFlows.ts:718` (`clockOutAt: e.clockInAt + INTERN_AFTER`) together with the ack text at `convex/lib/smsTemplates.ts:125`. The audit description is correct. Extra finding: when `managerPhones` returns nobody (`convex/smsFlows.ts:478`), the intern is still told a manager is reviewing.

## Proposed fix
Two parts; the first is wording only and can ship on its own.
1. **Stop telling interns to keep working.** New ack: "Pulse: Request sent. Please clock out now. If a manager approves, we will text you and you can clock back in." If no manager has a phone, say instead: "No manager can be reached by text. Please clock out now and ask a manager in person."
2. **Pay for time already worked under the old instruction (and for any intern who keeps working anyway).** In `_capInternEntry`, close the entry at the moment the approval window ended (the latest `expiresAt` of that entry's prompts, never later than `Date.now()`), not at clock-in + 4h. Keep `autoClosedReason: "intern_timeout"` so managers can see it. Change the timeout text to "No approval came through, so you are clocked out as of {time}."
Files: `convex/lib/smsTemplates.ts`, `convex/smsFlows.ts`, tests in the existing smsFlows tests.
**Schema:** none.
**One-time correction:** past `intern_timeout` entries were cut at 4h. Owner decides (below) whether to restore the time up to the approval window end for those entries; the prompt rows hold the timestamps needed.

## Decisions for the owner
1. Timeout clock-out time: (a) end of the approval window (recommended: pays for time Pulse told them to work, bounded); (b) the moment of the sweep; (c) keep 4h but only after the wording change has been live for a full pay period.
2. Back-pay past entries: (a) list them for each studio to review (recommended); (b) correct them automatically; (c) leave them.

## Interim step (no money logic)
Part 1 (the wording change) is the interim step. It is copy only, does not touch hours, and stops new unpaid time from being created.

## Risk
- Part 2 adds up to about an hour of paid time to timed-out entries; a studio that relied on the hard 4-hour cap pays slightly more. That is the point, but tell studios.
- **Rollback:** revert `_capInternEntry` to clock-in + 4h; the wording change can stay.
