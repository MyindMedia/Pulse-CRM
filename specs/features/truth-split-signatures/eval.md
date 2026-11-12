# Eval: Split sheets can be marked signed by hand
Status: built on `fix/high-split-signatures` (H5). Results below: 12 PASS, 1 PASS on the server with its browser part NOT RUN (U-08), 1 NOT RUN (U-13).
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
| U-01 | Browser cannot set `signed: true` | convex-test: `upsert` with `signed: true` for an unsigned contributor → stored `signed: false` | PASS | `convex/splitSheets.signatures.test.ts` "U-01: the browser cannot set signed: true, on a new sheet or an existing one" |
| U-02 | Re-save keeps signature evidence | convex-test: sign by link, then `upsert` adding an IPI → `signedAt`, `signature`, `signedFromUa` unchanged | PASS | `convex/splitSheets.signatures.test.ts` "U-02: a re-save (adding an IPI) keeps the signature record exactly" |
| U-03 | Changing a signed person's share clears their signature and reopens the sheet | convex-test → `signedAt` cleared, status `sent`, activity row | PASS | `convex/splitSheets.signatures.test.ts` "U-03: changing a signed person's share clears the signatures, reopens the sheet, logs it and keeps the evidence" and "U-03: a name change or a removed contributor also clears signatures…" |
| U-04 | Fixing an email or IPI does not clear a signature | convex-test | PASS | `convex/splitSheets.signatures.test.ts` "U-04: fixing an email, PRO or IPI does not clear a signature" |
| U-05 | `setStatus("fully_executed")` refused when anyone has not signed | convex-test → error, no allocation | PASS | `convex/splitSheets.signatures.test.ts` "U-05: setStatus(fully_executed) is refused while anyone has not signed, and allocates nothing" and "U-05: a hand tick from before the fix does not count as a signature"; `convex/royalties.test.ts` "holds a matched line as Unallocated Income…" |
| U-06 | `upsert` with `status: "fully_executed"` refused the same way | convex-test | PASS | `convex/splitSheets.signatures.test.ts` "U-06: upsert with status fully_executed is refused the same way, new or existing" |
| U-07 | Last real signature auto-executes and allocates royalties once | convex-test | PASS | `convex/splitSheets.signatures.test.ts` "U-07: the last real signature executes the sheet and allocates royalties once"; `convex/splitSignatures.test.ts` "flips the sheet to fully_executed once every contributor has signed" |
| U-08 | Owner override (if decision 1b) is owner-only, logged, shows its own badge | convex-test with owner and engineer identities; Playwright badge check | PASS (server) / NOT RUN (badge) | `convex/splitSheets.signatures.test.ts` "U-08: only the owner can mark a sheet signed outside Pulse…" (owner allowed; engineer and manager refused; note required; audit event; own status; double click) and "U-08: changing the terms of a marked sheet reopens it". Badge not run in a browser: on staging, as the owner open a song's Splits tab, click "Mark signed outside Pulse", enter a note, and check the gold "Marked signed by studio" badge; as an engineer the button is absent |
| U-09 | Signed-out caller and another studio's sheet id are refused | convex-test → error | PASS | `convex/splitSheets.signatures.test.ts` "U-09: a signed-out caller is refused" and "U-09: another studio's owner cannot touch this studio's sheet" |
| U-10 | Used or expired signing link cannot sign again | Existing splitSignatures tests pass | PASS | `convex/splitSignatures.test.ts` (all 14 pass) and `convex/splitSheets.signatures.test.ts` "U-10: a used, superseded or expired link cannot sign, and a signature on record is never overwritten" |
| U-11 | Double click on "Send for signature" does not issue duplicate live links | convex-test or Playwright | PASS | `convex/splitSheets.signatures.test.ts` "U-11: a double click on Send for signature leaves one live link per person"; the button is also disabled while the call runs |
| U-12 | Release gate stays closed for a sheet that is not executed | convex-test on `releases` | PASS | `convex/splitSheets.signatures.test.ts` "U-12: the release gate stays closed until the sheet is executed…" (`releases.setStatus` refused for a sent sheet; `isReleasable`) |
| U-13 | Splits tab shows "Signed on {date}" read-only and no tick box | Playwright on staging | NOT RUN | Needs a browser on staging: open a song's Splits tab after one person signs by link; their row shows "Signed on {date}" and no row has a tick box |
| U-14 | Must-not-break list passes | Full suite | PASS | `npx tsc --noEmit` clean; `npm run lint` 164 problems (unchanged); `npx vitest run` 4073 passed, 3 failed, the three known failures only (agentScope, marketing/results, outreachCalls live call) |
