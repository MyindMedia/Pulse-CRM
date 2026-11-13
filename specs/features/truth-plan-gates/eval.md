# Eval: Plan gates that are not enforced
Status: draft, waiting for owner approval
Risk: High. These are access-control changes: who may switch on and use the receptionist and visitor check-in, and who may read visitor records. If it is wrong, paying studios lose features or visitor data stays readable by any member.
RD: ./rd.md

## Must not break
- Receptionist replies for Growth and Max studios with it switched on; per-thread "AI replies off"
- Inbound SMS keywords (STOP, clock-in replies, prompts) for every plan
- Visitor QR check-in and the visitor list for Growth and Max studios
- CSV exports for every plan that has them today (unless decision 1b)
- Billing-locked studios can still reach their data
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Core studio cannot switch the receptionist on | convex-test: `setAiReceptionist(true)` on Core → UPGRADE_REQUIRED | PASS | `convex/planGates.test.ts` "U-01: a Core studio cannot switch the receptionist on" |
| U-02 | Core studio with the flag already on gets no receptionist reply | convex-test: inbound SMS on Core with `aiReceptionistEnabled` → no receptionist scheduled | PASS | `convex/planGates.test.ts` "U-02: a Core studio with the flag already on gets no reply once its notice date passes". Per decision 2b an existing Core user keeps it until its notice date: "U-02b: during the notice period an existing Core user keeps it; a new Core studio never gets it" |
| U-03 | Operator module-off stops the receptionist on Growth | convex-test with module disabled → no reply | PASS | `convex/planGates.test.ts` "U-03: the operator switching the module off stops the receptionist on Growth" |
| U-04 | Growth studio with it on still gets replies | convex-test | PASS | `convex/planGates.test.ts` "U-04: a Growth studio with it on still gets replies; per-thread AI-off still holds"; existing `convex/receptionist.test.ts` still passes |
| U-05 | Settings shows an upgrade card, not the switch, on Core | Playwright on staging with a Core test studio | NOT RUN | Needs a browser. On staging, sign in to a Core test studio, open Settings > Integrations: the AI receptionist card shows "Growth unlocks the AI receptionist" and an upgrade button instead of the switch |
| U-06 | Public visitor check-in refused on Core, works on Growth | convex-test on `visitors.register` | PASS | `convex/planGates.test.ts` "U-06: public check-in is refused on Core and works on Growth", "U-06b: an operator switch-off refuses check-in on Growth too", "U-06c: a Core studio that already had visits keeps check-in until its notice date passes" |
| U-07 | Unknown slug on the public check-in gives a plain error | convex-test | PASS | `convex/planGates.test.ts` "U-07: an unknown slug gives a plain error" |
| U-08 | Member without the chosen role cannot list or add visitors | convex-test with engineer identity → FORBIDDEN | NOT RUN | Not built: decision 3 (which role may read the visitor log) has no recommendation in the write-up, so the role check is left out for the owner to choose. Today any signed-in member of the studio can still list and add visitors |
| U-09 | Signed-out caller cannot list visitors | convex-test → error | PASS | `convex/planGates.test.ts` "U-09: a signed-out caller cannot list visitors" |
| U-10 | Member of studio A cannot read studio B's visitors | convex-test | PASS | `convex/planGates.test.ts` "U-10: a member of studio A cannot read or check out studio B's visitors" |
| U-11 | Exports behave per decision 1 for Core, Growth and a billing-locked studio | convex-test | PASS | `convex/planGates.test.ts` "U-11: Core, Growth and a billing-locked studio can all export" (decision 1a: all six exports open on every plan) and "exports still need the role permission: an engineer cannot export clients" |
| U-12 | STOP and clock replies still work on Core while the receptionist is gated | convex-test on inbound SMS | PASS (STOP); clock replies not separately run | `convex/planGates.test.ts` "U-12: STOP still works on Core while the receptionist is gated, and the text is still logged". Clock-in replies were not separately tested on a Core studio: they are handled by `routeInbound` before the receptionist branch, which is the only inbound code this change touched |
| U-13 | Must-not-break list passes | Full suite | PASS | Full suite: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` with only the three known failures (counts in the pull request) |

## Round 2 checks (review findings, 2026-11-12)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R2-01 | H210-05: a member without the chosen role cannot read, add or check out visitors | convex-test with the lowest role → FORBIDDEN | NOT RUN | Not built, same as U-08: decision 3 (which role may read the visitor log) is not made in the write-up or in the round-2 owner decisions, and the existing client-read permission is held by every role including intern, so reusing it would change nothing. Owner: name the role and the check is one line in each of `visitors.list`, `directory`, `registerManual`, `checkOut` |


## Round 3 checks (re-review, 2026-11-12)
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R3-01 | H210-R2-04 (part): the visitor log (`list`, `directory`, `registerManual`, `checkOut`) needs a studio role that can read clients (`artists.read`); a member without it is refused, front-desk staff such as an intern keep working | convex-test with a member whose `artists.read` is removed | PASS | `convex/visitors.test.ts` "H210-R2-04: the visitor log needs a studio role that can read clients" |

R2-01 above stays NOT RUN: every staff role, intern included, holds `artists.read`, so this check only shuts out callers with no client-read right (overrides, non-staff viewers). Keeping an intern out of the visitor log is a choice of role the owner has not made.
