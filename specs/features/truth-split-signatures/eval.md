# Eval: Split sheets can be marked signed by hand
Status: draft, waiting for owner approval
Risk: High. It decides what counts as a legal signature on ownership splits and when royalties are divided. If it is wrong, people are shown as agreeing to splits they never signed, or royalties stop for sheets that were signed.
RD: ./rd.md

## Must not break
- Sending signing links, signing by typed and drawn signature, one-use links
- Royalty allocation for sheets signed by everyone
- Release gate for songs with an executed sheet
- Rights export and the payments-page split spotlight
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Browser cannot set `signed: true` | convex-test: `upsert` with `signed: true` for an unsigned contributor → stored `signed: false` | PENDING | |
| U-02 | Re-save keeps signature evidence | convex-test: sign by link, then `upsert` adding an IPI → `signedAt`, `signature`, `signedFromUa` unchanged | PENDING | |
| U-03 | Changing a signed person's share clears their signature and reopens the sheet | convex-test → `signedAt` cleared, status `sent`, activity row | PENDING | |
| U-04 | Fixing an email or IPI does not clear a signature | convex-test | PENDING | |
| U-05 | `setStatus("fully_executed")` refused when anyone has not signed | convex-test → error, no allocation | PENDING | |
| U-06 | `upsert` with `status: "fully_executed"` refused the same way | convex-test | PENDING | |
| U-07 | Last real signature auto-executes and allocates royalties once | convex-test | PENDING | |
| U-08 | Owner override (if decision 1b) is owner-only, logged, shows its own badge | convex-test with owner and engineer identities; Playwright badge check | PENDING | |
| U-09 | Signed-out caller and another studio's sheet id are refused | convex-test → error | PENDING | |
| U-10 | Used or expired signing link cannot sign again | Existing splitSignatures tests pass | PENDING | |
| U-11 | Double click on "Send for signature" does not issue duplicate live links | convex-test or Playwright | PENDING | |
| U-12 | Release gate stays closed for a sheet that is not executed | convex-test on `releases` | PENDING | |
| U-13 | Splits tab shows "Signed on {date}" read-only and no tick box | Playwright on staging | PENDING | |
| U-14 | Must-not-break list passes | Full suite | PENDING | |
