# Re-review of the high-risk pull requests after round 2 (2026-11-12)

Of the 50 round 1 findings, 41 are fixed. 31 items are open: 2 critical, 15 major, 14 minor. They are round 1 findings that were only partly fixed, and new defects the fixes introduced. Full text is in `high-risk-rereview-2026-11-12.json` (ids `H<pr>-R2-<nn>`).

| PR | round 1 findings fixed | open after round 2 |
|---|---|---|
| #205 | 10 of 12 | 7 |
| #207 | 13 of 15 | 10 |
| #206 | 6 of 7 | 4 |
| #208 | 6 of 7 | 4 |
| #209 | 3 of 4 | 2 |
| #210 | 3 of 5 | 4 |

**#207 (prepaid hours) is on hold.** Two rounds each produced new critical defects in how prepaid cover, cash payments and hours interact. It needs a written design before more code, not a third patch round.

| id | PR | severity | kind | finding |
|---|---|---|---|---|
| H205-R2-01 | #205 | major | prior | H205-10 is partly fixed |
| H205-R2-02 | #205 | major | prior | H205-11 is partly fixed |
| H205-R2-03 | #205 | minor | new | When a payment made after the no-show covers the fee, staff are still told to send the fee invoice and the client is told it is coming |
| H205-R2-04 | #205 | minor | new | Undo then re-mark the no-show: the fee is never auto-charged, and the only invoice tells staff to void it |
| H205-R2-05 | #205 | minor | new | The amount already paid ignores money paid on a session-linked invoice, so a completed and paid session re-marked as a no-show is charged the fee again |
| H205-R2-06 | #205 | minor | new | A payment made after the no-show stops the charge but tells staff to bill the fee and tells the client an invoice will follow |
| H205-R2-07 | #205 | minor | new | After an undo, re-marking the no-show never charges, emails the client 'invoice to follow' and counts the deposit twice |
| H206-R2-01 | #206 | major | new | A short booking payment now leaves the booking open to automatic forfeit, and the studio keeps everything the client paid |
| H206-R2-02 | #206 | minor | prior | H206-04 is partly fixed |
| H206-R2-03 | #206 | minor | new | A refund Stripe reports succeeded and later fails is silently ignored |
| H206-R2-04 | #206 | minor | new | Voiding then deleting an invoice turns the void fix's automatic refund back into a silent hold of the client's money |
| H207-R2-01 | #207 | critical | new | Paying the prepaid-adjusted balance on the public checkout records the full cash balance, so hours are never drawn and the studio is paid short |
| H207-R2-02 | #207 | critical | new | Public checkout charges the balance net of prepaid cover, but the webhook records the full balance as paid, so the hours are never drawn |
| H207-R2-03 | #207 | major | prior | H207-04 is partly fixed |
| H207-R2-04 | #207 | major | prior | H207-05 is partly fixed |
| H207-R2-05 | #207 | major | new | The async-payment fix never receives its events: the Connect webhook is not subscribed and card is not forced, and staff are told the hours will arrive |
| H207-R2-06 | #207 | major | new | Re-completing a voided session paid by 'Apply hours now' keeps the cut price and the returned hours |
| H207-R2-07 | #207 | major | new | A completed session corrected to no-show keeps its hours drawn |
| H207-R2-08 | #207 | major | new | A voided session keeps its prepaid price cut, and only a session with a chosen block gets the price back, so hand-applied hours are given away on re-completion or reopen |
| H207-R2-09 | #207 | major | new | Hours are put back only on a direct completed->cancelled change, so correcting a completed session to no-show (or reopening and then cancelling it) keeps the client's hours |
| H207-R2-10 | #207 | minor | new | Payment-gated deliverables stay locked for a session paid from prepaid hours until staff complete it, and the cron no longer completes it |
| H208-R2-01 | #208 | minor | prior | H208-04 is partly fixed |
| H208-R2-02 | #208 | minor | new | Editing or removing an entry in a period already posted changes nothing in the ledger, and moving its clock-in into the next period posts those hours a second time |
| H208-R2-03 | #208 | minor | new | Self clock-in can be backdated onto a manual entry, so the same hours are paid twice despite the new overlap guard |
| H208-R2-04 | #208 | minor | new | The rule that nobody edits their own hours is skipped for agency viewers |
| H209-R2-01 | #209 | major | prior | H209-01 is partly fixed |
| H209-R2-02 | #209 | major | new | The owner-only rule for emails and shares can be bypassed by first clearing the signatures or unmarking the sheet |
| H210-R2-01 | #210 | major | prior | H210-01 is partly fixed |
| H210-R2-02 | #210 | major | new | Round 2 marks a phone typed into a public form as 'on file', so after 7 days the assistant can auto-text a stranger's number on a real client's row |
| H210-R2-03 | #210 | major | new | Client erasure leaves the email and phone in the new artists.contactOnFile field |
| H210-R2-04 | #210 | minor | prior | H210-05 is not fixed |
