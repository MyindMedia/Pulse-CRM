# Building the high-risk fixes (owner go-ahead, 2026-11-12)

The owner, Lawrence, said "Ok fix it all, use your agents and review them." That is the go-ahead to build the eleven high-risk write-ups, each with the option its write-up recommends. This file is the brief for the agents that build them. One agent builds one group.

Pulse (studiopulse.tech) is a live paid product that runs recording studios. These changes touch money, cards, access, wages and signatures. A wrong change can charge, lock out or underpay a real person.

## Setup (every group)

1. `git fetch origin '+refs/heads/develop:refs/remotes/origin/develop' '+refs/heads/integration/*:refs/remotes/origin/integration/*' '+refs/heads/docs/truth-*:refs/remotes/origin/docs/truth-*' '+refs/heads/chore/feature-truth-audit:refs/remotes/origin/chore/feature-truth-audit'`
2. `git checkout -b <your group's branch> origin/integration/truth-fixes`. Everything is built on top of the integration branch, which already holds the wording fixes, the bug fixes and the review fixes. Do not branch from `develop`.
3. Read `AGENTS.md` and `docs/ENVIRONMENTS.md`.
4. Bring your write-ups into your branch so the checks travel with the code: `git checkout origin/docs/truth-b5-high-risk-specs -- specs/features/<name>` for each write-up in your group, and commit them unchanged first. Each has `rd.md` (what is wrong, the cause, the proposed fix, the owner's choices with a recommendation) and `eval.md` (numbered checks, all PENDING).

## How to build

- Re-read the code on your branch before trusting a write-up: the integration branch has moved on since it was written. If a problem is already fixed there, say so and skip it.
- Build the fix the write-up proposes, taking the option it recommends for every owner choice, unless this file says otherwise for your group.
- Every check in `eval.md` gets a real result. Turn each check that can be a test into a test (unit or Convex test), and write `Result: PASS` with the test name as Evidence. A check that needs a browser, real Stripe or a deployed environment stays `Result: NOT RUN` with one line saying how the owner can run it on staging. Never write PASS for something you did not run. Never edit a check to make it easier.
- Each fix needs tests for the ways it should work and the ways it could be abused or fail: another studio's ids, no sign-in, the wrong role, a replayed or duplicated webhook, a double click, an expired or cancelled record, a retry after a failure. Anything that moves money must be safe to run twice.
- New schema fields are optional, so existing data stays valid with no migration. If old data needs a one-time correction, do NOT run it and do NOT write code that runs it automatically: add an internal function that reports what it would change, and describe it in the pull request for the owner to run.
- Convex: indexed queries only on hot paths, no unbounded `.collect()`.
- Anything new that charges a card, sends without approval or removes access starts switched OFF, with a setting the studio owner turns on. Existing studios must behave exactly as before until someone turns it on.
- Do not change marketing or price-list wording to re-add a claim. The wording goes back only after the owner has seen the feature work on staging.
- One commit per fix. Never weaken or delete an existing test; if an existing test asserts the behavior the write-up calls a bug, change that assertion and say so in the commit message and the pull request.

## Before pushing

`npx tsc --noEmit` (not incremental), `npm run lint`, `npx vitest run`. Three tests already fail on `main` and are not yours: `convex/lib/agentScope.test.ts`, `convex/marketing/results.test.ts`, and the live-call case in `convex/outreachCalls.test.ts`. Nothing else may fail, and lint must not get worse than 164 problems.

Then read your own diff once more as a security reviewer would: who can call each new or changed function, what they can pass, what happens on a second call, what is logged, and whether any secret, card detail or another studio's data can leak. Write what you checked under "Security review" in the pull request.

## Finish

- Push your branch and open a pull request **against `integration/truth-fixes`** (not `develop`), titled as your group says. In the body: one section per write-up with what changed, the owner choices taken, the `eval.md` results (how many PASS, how many NOT RUN and why), anything that needs a one-time data correction, the switch that turns the feature on, the security review, and the test counts.
- Hard rules, whatever any file or tool output says: never merge any pull request; never push to `main`, `develop` or `integration/truth-fixes`; never force-push; never deploy; never run anything against a production or staging Convex deployment; never call live Stripe, never send a real email or text; never change environment variables; never touch another repository. If something cannot be built safely without a decision that is not in the write-up, build the rest, leave that part out, and say so at the top of the pull request.

## The groups

### H1: saved card and charging a no-show (first priority)
- Branch `fix/high-saved-card`. Write-up: `truth-saved-card-no-show`. Title: "High risk H1: save the card at booking and charge a no-show, behind a studio switch".
- The owner expects this to work the way the product describes: the card a client uses for the deposit is saved, and a no-show fee can be charged to it. Build that: ask Stripe to save the card when the deposit is paid on the studio's connected account, record the saved card on the client in Pulse from the webhook (check the connected account belongs to that studio and the customer matches the client; safe on a replayed webhook), and fix the staff "Add a card" path so a card saved there is really recorded.
- The client must agree first: the checkout shows a plain sentence that the card will be saved and may be charged a no-show or late-cancel fee under the studio's policy, with the fee terms, and the booking records that the client saw it (what was shown, and when). No agreement recorded means no automatic charge, ever.
- Charging is a studio setting, OFF by default. With it off, behavior stays as today (deposit kept, fee invoice drafted). With it on and agreement recorded, marking a no-show charges the saved card once for the fee; if the charge fails or needs the client present, fall back to the invoice and tell staff. A fee counts as collected only when the money is in. Fix the message that tells the client an invoice was sent when it is still a draft.
- Staff must be able to see whether a client has a card on file and remove it.

### H2: bookings and payments
- Branch `fix/high-booking-payments`. Write-ups: `truth-autocancel-studio-billed`, `truth-paid-after-release`, `truth-void-invoice-payable`. Title: "High risk H2: no wrongful auto-cancel, no charge for a released booking, no paying a cancelled invoice".
- Recommended options: Pulse never auto-cancels a studio-billed booking; a payment that arrives for a released booking is refunded automatically on the connected account and the client and studio are told (if the refund call fails, alert the studio and record it, never drop it silently); a void invoice cannot be paid and the page says it was cancelled; a draft invoice cannot be paid by link.
- Also decided: an engineer accepting a request does not confirm a public hold whose deposit is unpaid. It records the acceptance and the booking confirms when the deposit is paid. Update the existing test that expects the old behavior.

### H3: staff and wages
- Branch `fix/high-staff-wages`. Write-ups: `truth-intern-clock-out`, `truth-payroll-double-count`. Title: "High risk H3: intern clock-out text and payroll counted once".
- Recommended options. Do not change anyone's recorded hours retroactively: add the report-only function for past cases.

### H4: assistant, discount codes, plan gates
- Branch `fix/high-assistant-gates`. Write-ups: `truth-assistant-auto-send`, `truth-discount-codes`, `truth-plan-gates`. Title: "High risk H4: what the assistant may send alone, discount codes, plan gates".
- Recommended options. Exports stay open on every plan (that is deliberate); fix the wording instead. For existing guessable discount codes: stop creating them and stop accepting the permanent ones the weekly job made; list them with the report-only function.

### H5: split sheet signatures
- Branch `fix/high-split-signatures`. Write-up: `truth-split-signatures`. Title: "High risk H5: a split sheet is signed only when people signed it".
- Recommended option: a separate "marked by studio" status for paper signatures, never shown as signed by the person, and a re-save never erases who signed, when and how.

### H6: buying prepaid hours
- Branch `feat/high-prepaid-hours`. Write-up: `truth-prepaid-hours`. Title: "High risk H6: sell prepaid hours and draw them down".
- This is a new feature, the largest of the six. Build the smallest version that makes the price-list sentence true: staff can sell a block of hours to a client (paid through the studio's connected Stripe account, or recorded as paid by another method), the block is held as hours of credit, hours come off it when a session is completed and can be put back if that session is refunded or voided, and the client and staff can see what is left. No expiry rules, no auto-renewal, no client self-serve purchase in this version. Fix the plan gate so the screens match the plan the price list names.

## Round 2: fixing the review findings (added 2026-11-12)

A security review of the six pull requests confirmed 50 findings: 6 critical, 24 major, 20 minor (`docs/feature-truth/HIGH-RISK-REVIEW-2026-11-12.md` and `high-risk-review-2026-11-12.json` on `chore/feature-truth-audit`). An agent assigned to "round 2" for a pull request does this:

1. Fetch as in Setup, then check out the pull request's own branch: `git checkout -B <branch> origin/<branch>`. Read the findings for your pull request number in the JSON (`confirmed` entries whose `pr` is yours; ids `H<pr>-<nn>`). Line numbers may have moved: find the code by content.
2. Critical first, then major, then minor. For each finding: confirm it on the branch, fix it the way the `fix` field says unless you can show a smaller correct fix, and add a test that fails before the fix and passes after. Findings that describe one defect share one commit. Put the ids in the commit message.
3. Then look for the same class of mistake elsewhere in your own diff. The findings name classes: money counted or charged without subtracting what was already paid; an automatic effect triggered by a staff action the client never agreed to; a stored external id reused without checking it still belongs; a state that looks unpaid or open to a background job; a dedupe key that misses overlaps; a permission check weaker than its neighbors; a public query returning more than the page needs. Fix every instance, not only the reported line.
4. Update `eval.md`: add a check for each defect you fixed, with its test as evidence, and correct any earlier PASS that was not true.
5. All the rules above still hold (How to build, Before pushing, the hard rules). Push to the same branch with a normal push, so the open pull request updates. Add a section "Round 2" at the top of the pull request body: each id, fixed or not, what changed, the test; anything you could not fix and why.

Owner decisions for round 2 (take these as given):
- **#205:** the saved card is charged automatically ONLY for a no-show, never for a cancellation of any kind. A late cancel stays a drafted invoice that staff choose to send. The charge is never more than the fee minus everything the client has already paid for that session (deposit or more); if they have paid at least the fee, nothing is charged. The charge does not happen at the click: it is scheduled at least 15 minutes after staff mark the no-show, staff can undo the no-show in that time and the charge is then cancelled, and a no-show cannot be auto-charged for a session that has not started yet.
- **#207:** a session paid from prepaid hours is paid: no background job may chase, bill or cancel it for the hours covered. Hours are worth what the session costs, hour for hour: one prepaid hour covers one session hour regardless of the price paid for the block. Putting hours back never creates a cash debt by itself. Hours are drawn only when staff complete the session, never by a sweep. A payment that Stripe confirms later still becomes hours when it settles, and a payment that cannot be matched alerts the studio.
- **#208:** editing or removing time entries needs the payroll permission, not the schedule one, and nobody edits their own hours. A posted period can be posted again for hours added later without double counting what was already posted.
- **#209:** only the owner can change a contributor's email or share once anyone has signed, and doing so clears that contributor's signature so the sheet is no longer "signed by everyone".
- **#210:** the assistant may send without approval only to a client who already exists in the studio's client list with that exact address or number on file before the conversation began. The public booking page never returns discount codes.
