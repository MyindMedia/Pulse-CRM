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
| U-01 | Core studio cannot switch the receptionist on | convex-test: `setAiReceptionist(true)` on Core → UPGRADE_REQUIRED | PENDING | |
| U-02 | Core studio with the flag already on gets no receptionist reply | convex-test: inbound SMS on Core with `aiReceptionistEnabled` → no receptionist scheduled | PENDING | |
| U-03 | Operator module-off stops the receptionist on Growth | convex-test with module disabled → no reply | PENDING | |
| U-04 | Growth studio with it on still gets replies | convex-test | PENDING | |
| U-05 | Settings shows an upgrade card, not the switch, on Core | Playwright on staging with a Core test studio | PENDING | |
| U-06 | Public visitor check-in refused on Core, works on Growth | convex-test on `visitors.register` | PENDING | |
| U-07 | Unknown slug on the public check-in gives a plain error | convex-test | PENDING | |
| U-08 | Member without the chosen role cannot list or add visitors | convex-test with engineer identity → FORBIDDEN | PENDING | |
| U-09 | Signed-out caller cannot list visitors | convex-test → error | PENDING | |
| U-10 | Member of studio A cannot read studio B's visitors | convex-test | PENDING | |
| U-11 | Exports behave per decision 1 for Core, Growth and a billing-locked studio | convex-test | PENDING | |
| U-12 | STOP and clock replies still work on Core while the receptionist is gated | convex-test on inbound SMS | PENDING | |
| U-13 | Must-not-break list passes | Full suite | PENDING | |
