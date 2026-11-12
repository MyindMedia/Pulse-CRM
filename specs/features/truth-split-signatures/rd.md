# RD: Split sheets can be marked signed by hand (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit ids covered: `catalog-brand-split-signature-wiped`, `catalog-brand-split-manual-execute`.
Code read on `develop` (2026-11-12).

## What Pulse says
- "Real signatures by link" (`convex/lib/pricing.ts:617`), "Split sheets with real signatures" in the Max plan blurb (`convex/lib/pricing.ts:110`), and the module blurb "Ownership splits with real e-signatures" (`convex/lib/modules.ts:170`).
- The sheet shows "Signed" per person and "Fully executed" for the sheet.

## What actually happens today
The link-signing flow is real: each contributor gets a one-use link and `splitSignatures.sign` stores the signature, time, kind, font and browser on their row (`convex/splitSignatures.ts:195-240`). But three other paths make "signed" mean nothing:
1. **Tick box.** Staff can tick "Signed" for any contributor (`src/components/songs/splits-tab.tsx:298-302`). It is saved through `splitSheets.upsert`, which accepts `signed` from the browser (`convex/splitSheets.ts:8-17`, `contributorV`).
2. **Mark fully executed.** Staff can click "Mark fully executed" with nobody signed (`src/components/songs/splits-tab.tsx:348-356`). `setStatus` sets the status with no signature check (`convex/splitSheets.ts:139`) and immediately runs royalty allocation from that sheet (`:142`). `upsert` does the same if passed `status: "fully_executed"` (`:98`). The release gate trusts the status alone (`convex/releases.ts:125`).
3. **Re-save wipes the evidence.** Any later save of the sheet (for example adding an IPI) replaces the whole contributors array with what the browser sent (`convex/splitSheets.ts:93-97`). The browser copy has no signature fields (`splits-tab.tsx` working copy, `signed: c.signed` at `:85` and `:142`), so `signedAt`, `signature`, `signatureKind`, `signatureFont`, `signedFromUa` are deleted while `signed: true` stays. Shares can also be changed after someone signed and their "Signed" stays on.

A side effect: when the last person signs by link, the sheet auto-executes if every row has `signed: true` (`convex/splitSignatures.ts:224-228`), and that count includes rows ticked by hand.

`convex/splitSignatures.ts:14-16` itself calls the old toggle "a hollow flag that the rest of the product (release gates, rights export) trusts".

## Who is hurt and how
- **Artists, writers and producers** on a song can be shown as having agreed to a split they never signed, or to shares that changed after they signed. Royalties are then divided by that sheet (`allocateSongLines`), and the release gate opens.
- **The studio** loses the proof it would need in a dispute: the signature record is gone after a re-save, while the screen still says "Signed".

**Can it be happening in production now?** Yes, at any studio using split sheets (Core feature "Real signatures by link"; royalties on Max). How the owner can check: production `splitSheets` where `status` is `fully_executed` and any contributor has `signed: true` but no `signedAt`; those were ticked by hand or lost their evidence on a re-save. Compare with `auditEvents` rows with `action: "splitsheet.sign"` for that sheet.

## Cause (verified on develop)
`convex/splitSheets.ts:8-17`, `:93-98`, `:139-142`; `src/components/songs/splits-tab.tsx:85`, `:142`, `:298-302`, `:351`; `convex/splitSignatures.ts:224-228`. Audit descriptions are correct.

## Proposed fix
1. **Only a real signature sets "signed".** `contributorV` drops `signed` (or the server ignores it). In `upsert`, for an existing sheet, match each incoming contributor to the stored one (by email, normalised), and carry `signed`, `signedAt`, `signature`, `signatureKind`, `signatureFont`, `signedFromUa` from the server copy.
2. **Changing a signed person's terms clears their signature.** If a signed contributor's name, email, role, master % or publishing % changed, or a contributor was added or removed, clear the signatures that no longer cover the sheet and set status back to `sent` (or `draft`). Log it in `activity` with before and after.
3. **"Fully executed" needs everyone's signature.** `setStatus("fully_executed")` and `upsert(..., status: "fully_executed")` throw unless every contributor has `signedAt`. The auto-execute in `sign` counts `signedAt`, not `signed`.
4. **UI:** remove the Signed tick box; show "Signed on {date}" read-only. Remove "Mark fully executed" or replace it per decision 1.
Files: `convex/splitSheets.ts`, `convex/splitSignatures.ts`, `src/components/songs/splits-tab.tsx`, tests in `convex/splitSheets.test.ts` / `splitSignatures.test.ts`.
**Schema:** only if decision 1 is (b): a new status value `marked_by_studio` and fields for who marked it and why. Otherwise none.
**One-time correction:** existing sheets with `signed: true` and no `signedAt`. Options in decision 2.

## Decisions for the owner
1. Studios that collected paper signatures: (a) no override, they re-send links (strictest); (b) an owner-only "Mark as signed outside Pulse" that sets a separate status `marked_by_studio`, asks for a note or upload, writes an audit event, shows a different badge, and still lets royalties run (recommended: real studios have paper sheets); (c) same as (b) but royalties wait for real signatures.
2. Existing hand-ticked sheets: (a) relabel them `marked_by_studio` (recommended, if 1b); (b) reset them to `sent` and ask for signatures (could stop royalties mid-stream); (c) leave them.

## Interim step (no money logic)
Change the wording now: "Signed" tick box label to "Marked signed by studio", and the button to "Mark executed (no signatures)". Reword "Real signatures by link" to "Signatures by link (studio can also mark a sheet signed)". This is copy only and stops the screen from claiming signatures that do not exist.

## Risk
- Blocking "fully executed" can stop royalty allocation for studios that relied on the button. Decision 1(b) avoids that.
- Clearing signatures on edits can surprise studios who fix a typo in a name. Recommend: email or IPI/PRO changes do not clear; name and share changes do.
- **Rollback:** revert the server checks; carried-over signature fields stay correct either way. If decision 2 relabels data, keep a list of changed sheet ids to reverse it.
