## 1. Gating and schema

- [x] 1.1 Add capability keys `catalogImport` (growth) and `royalties` (max) to `convex/lib/pricing.ts` (CapabilityKey, CAPABILITY_TIER, feature rows) and update pricing tests
- [x] 1.1b Move `splitSheets` to `core` (CAPABILITY_TIER + the four split-sheet feature rows + any marketing/pricing copy naming Max); add `splitSheets.createWithSong` (gated on splitSheets only) that inserts a basic song (title, artist, ISRC) plus the sheet; Split Sheets page lists sheets without needing the Songs module; a Split sheets page (/splits, nav on every plan) lists and edits sheets outside Songs; tests that Core can create, edit and send a sheet
- [x] 1.2 Add `agencies.royaltiesEnabled` (optional boolean) and `requireRoyalties(ctx, orgId)` with the `ROYALTIES_OFF` error; unit-test tier x toggle combinations
- [x] 1.3 Agency toggle: `agencySettings.setRoyaltiesEnabled` (agency members only) + `summary` field; switch on Agency > Settings; test that a studio owner is refused
- [x] 1.4 Schema: `creditIdentities`, `catalogImports`, `catalogImportItems`, `songs.importedFrom`, `songs.creditedMembers`, `members.importedCredits`, `royaltyStatements`, `royaltyLines`, `royaltyShares`, `royaltyMappings`, `collaboratorGrants` scope `royalty_statement`, media purpose `royalty_statement`

## 2. Split sheet email requirement

- [x] 2.1 `splitSignatures.issue` refuses when any contributor lacks a valid email and names them; test both scenarios
- [x] 2.2 Split sheet editor marks contributor email required and shows the refusal

## 3. Catalog discovery (pure + lookups)

- [x] 3.1 Link parsing for Spotify / Apple Music / TIDAL artist URLs (`convex/lib/catalogMerge.ts` `parseArtistLink`) with tests
- [x] 3.2 Identity search across Deezer, MusicBrainz, Genius returning candidates with source, ID, image, top songs (`convex/lib/catalogDiscovery.ts`)
- [x] 3.3 Discovery by role: Deezer artist albums/tracks, iTunes artist songs, MusicBrainz recording-rels and work-rels, Genius artist songs (token-gated); map relation types to Credit Roles
- [x] 3.4 Candidate merge by ISRC then cleaned title + primary artist, cap 500; pure function with tests

## 4. Catalog Import job

- [x] 4.1 Extract the create-or-enrich song upsert from `songImport.applyToSong` into a shared internal helper; keep existing songImport tests green
- [x] 4.2 `catalogImport.start(destinationOrgId)` (saves the picked identities), `status` (reactive), batch worker via `ctx.scheduler.runAfter`, paced for MusicBrainz; `requireFeature(destinationOrgId, catalogImport)`; destination must be a workspace where the caller can create Songs; member-self vs owner/manager-for-artist permissions; tests for wrong-destination refusal and no cross-workspace writes
- [x] 4.3 Imported Catalog Songs: stage released, `importedFrom`, `creditedMembers`, drafted split sheet; dedupe tests (ISRC match, title match, two members one song)
- [x] 4.4 Songs list shows imported songs with an "Imported" badge; "Imported" filter (index `by_org_imported`)

## 5. Catalog Import UI and Credit Approval

- [x] 5.1 "Import my catalog" (profile menu and Songs page) and "Import catalog" on the roster artist page: destination picker ("My account" or a studio, with each one's plan), role picker, link-or-search identity picker with same-name disambiguation, progress panel
- [x] 5.2 `importedCredits` rows written by the job; `approveCredits` (owner/manager); booking page shows approved credits labelled with source; tests that unapproved credits never reach the public query

## 6. Royalty statements

- [ ] 6.1 `convex/lib/royaltyCsv.ts`: header detection + parsers for DistroKid, TuneCore, CD Baby, and mapped CSV; string-to-cents parsing; fixtures and tests
- [ ] 6.2 `convex/lib/royaltyMath.ts`: largest-remainder allocation; tests for exact sums and rounding
- [ ] 6.3 Upload flow: R2 private purpose (CSV, 20 MB), duplicate refusal by SHA-256, statement + lines written in batches, ISRC matching, unallocated vs unmatched states; all behind `requireRoyalties`
- [ ] 6.4 Allocation on split sheet `fully_executed`; matching an Unmatched Line to a Song or creating one
- [ ] 6.5 Mark paid (single share, or contributor x period) with date and method; no payment calls
- [ ] 6.6 Royalties UI (Max + toggle on): statements list, per-song and per-contributor views, Unallocated ("waiting on N signatures") and Unmatched queues, column-mapping dialog

## 7. Contributor Statements

- [ ] 7.1 Grant scope `royalty_statement` (email-keyed, 180-day expiry, revocable) and public query returning only that contributor's shares at that studio; tests for cross-contributor and cross-org isolation
- [ ] 7.2 Statement email via `sendEmail` + `brandEmail`, sent only on owner action; public token page

## 8. Gates and ship

- [ ] 8.1 Full vitest, tsc, lint; cross-browser check on the new pages
- [ ] 8.2 compliance-ops audit (earnings data, contributor emails) and `/pentest` of the CSV upload and token page; fix and re-prove
- [ ] 8.3 PR, merge, Convex deploy; confirm royalties are absent with the agency switch off and present for a Max studio with it on; leave the switch OFF
