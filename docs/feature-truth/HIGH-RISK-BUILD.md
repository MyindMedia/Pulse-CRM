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
