## Context

Pulse already imports one song from one Spotify or Apple Music link (`convex/songImport.ts`), enriched since PR #178 by `convex/lib/catalogLookup.ts` (Deezer, MusicBrainz, Genius when `GENIUS_ACCESS_TOKEN` is set) and the pure helpers in `convex/lib/musicLink.ts`. `songImport.applyToSong` fills blank fields only and drafts a split sheet from credits. Split sheets (`splitSheets`, Max) hold master % and publishing % per contributor; `splitSignatures.issue` sends one-use links by email and skips any contributor without one. Members have free-text `credits: string[]` shown on the booking page. Engineer payouts (`convex/payouts.ts`) are a ledger with approve and mark paid; no money moves through Pulse. Capabilities are tier-gated through `CAPABILITY_TIER` in `convex/lib/pricing.ts` and enforced by `requireFeature` in `convex/lib/entitlements.ts`. Private files go to R2 through `convex/media.ts` purposes. Decisions and vocabulary: Grilled.md "Catalog Import + Royalty Statements" and CONTEXT.md "Catalog and Royalties".

## Goals / Non-Goals

**Goals:**
- One Catalog Import flow for Members and Roster Artists, by Credit Role, following a stored Credit Identity.
- Enrichment and dedupe reuse the single-song importer, so one song never has two behaviours.
- Royalties fully built and tested but dark behind an agency switch, off by default.
- Royalty maths exact to the cent and auditable from statement line to share.

**Non-Goals:**
- Streaming-service sign-in, payouts through Pulse, publishing statements, PRO/MLC registration, proof of legal ownership.

## Decisions

### D1. Credit Identity table, one row per person per source
`creditIdentities { orgId, subject: {kind: "member"|"artist", id}, source: "musicbrainz"|"genius"|"deezer"|"apple"|"spotify"|"tidal", sourceId, name, imageUrl?, roles[] }`. Links resolve to a source ID (Apple artist ID from the URL; Spotify and TIDAL artist pages give a name through og tags, which is then matched to a Deezer/MusicBrainz artist the person confirms). Alternative considered: store a name and search each time. Rejected: same-name collisions (Grilled decision 2).

### D2. Discovery by role, per source
- Artist role: Deezer artist albums then tracks (ISRC on every track), and iTunes `lookup?id=<artist>&entity=song&limit=200` when the identity is an Apple artist.
- Producer / Engineer / Mix / Mastering / Musician / Vocalist: MusicBrainz `artist/<mbid>?inc=recording-rels` relation types mapped through `creditRole`.
- Writer: MusicBrainz `work-rels` (writer, composer, lyricist), then the work's recordings.
- Genius `artists/<id>/songs` when a token exists (coverage of producer credits verified once the token exists; see Open Questions).
Candidates from all sources merge by ISRC, else cleaned title + primary artist (`searchTitle`, `primaryArtist`). Alternative: Spotify Web API. Rejected: needs keys and a quota review, and gives no credits.

### D3. Background job as a chain of scheduled actions
`catalogImports { orgId, identityIds, roles, status, found, imported, merged, failed, capped, startedBy, startedAt, finishedAt }`. An action discovers candidates and stores them (`catalogImportItems`), then schedules batches of 10 through `ctx.scheduler.runAfter`, each batch running the PR #178 enrichment and a mutation that creates or merges Songs. Batches pace MusicBrainz at about 1 request per second. Progress is a reactive query on the job row. Cap 500 enforced at discovery. Alternative: one long action. Rejected: a failure would lose all progress, and Convex action time limits.

### D4. Shared song upsert
Extract the create-or-enrich logic from `songImport.applyToSong` into one internal helper used by both the single-link importer and Catalog Import. Songs gain `importedFrom?: { importId, identityId, source }` and `creditedMembers?: Id<"members">[]`. The Songs list query excludes `importedFrom` rows unless the "Imported catalog" filter is chosen. Cover art goes through `storeCover` to R2 as today.

### D5. Credit Approval
`members.importedCredits?: { songId, role, source, approved: boolean, approvedBy?, approvedAt? }[]`. Booking-page credits = existing free-text `credits` plus approved imported credits, each labelled with its source. Approval mutation requires owner/manager. Alternative: auto-public with a "self-reported" label. Rejected in grilling.

### D6. Royalties gating: tier AND agency switch
New capability `royalties: "max"` and `catalogImport: "growth"` in `CAPABILITY_TIER`. A helper `requireRoyalties(ctx, orgId)` = `requireFeature(ctx, orgId, "royalties")` plus a check of `agencies.royaltiesEnabled === true` for the org's agency; it throws a distinct `ROYALTIES_OFF` error. Every royalty query and mutation calls it first; navigation reads the same through a query. The toggle mutation requires an agency member with settings rights. Alternative: env flag like `DEAL_TEXTS_LIVE`. Rejected: Lawrence asked for a toggle in Agency, and an env flag needs a deploy to flip.

### D7. Statement storage and parsing
CSV uploaded to R2 as a new private media purpose `royalty_statement` (CSV only, 20 MB cap). An action reads it back, detects the format from headers with pure parsers in `convex/lib/royaltyCsv.ts` (DistroKid, TuneCore, CD Baby, mapped), and writes `royaltyStatements { orgId, source, periodStart, periodEnd, currency, grossCents, lineCount, fileHash, uploadedBy }` and `royaltyLines { statementId, orgId, isrc, title?, store?, country?, units?, amountCents, songId?, state: "allocated"|"unallocated"|"unmatched" }`, inserted in batches. `fileHash` (SHA-256) refuses duplicates. Saved mappings live in `royaltyMappings { orgId, headerSignature, columns }`. Amounts parse from strings to integer cents (no floats); non-USD lines keep their currency and are reported per currency.

### D8. Allocation is a pure function, recomputed not mutated
`allocate(amountCents, contributors[{index, masterPct}])` in `convex/lib/royaltyMath.ts`: largest-remainder rounding so shares sum exactly. `royaltyShares { orgId, lineId, songId, contributorKey (email), name, pct, amountCents, paidAt?, paidMethod? }`. When a split sheet becomes `fully_executed`, a hook allocates every unallocated line for that song. Unmatched lines allocate when matched.

### D9. Contributor Statements reuse the grant pattern
A new `collaboratorGrants` scope `royalty_statement` with `entityId = orgId`, keyed by contributor email, 180-day expiry, revocable. A public query returns only shares whose `contributorKey` matches the grant email at the grant's org. Emails go through `sendEmail` + `brandEmail`, sent only when the owner presses Send (never automatic).

### D10. Split sheet email requirement
`splitSignatures.issue` refuses when any contributor lacks a valid email and returns the names. The sheet editor marks the field required.

## Risks / Trade-offs

- [Distributor CSV formats change without notice] → parsers are pure and unit-tested against fixtures; an unknown header falls back to the column picker instead of failing.
- [MusicBrainz rate limit and gaps; hip-hop credits thin without Genius] → paced batches; Genius switches on with a token; the preview says when no public credits exist.
- [Wrong-person imports] → identity by source ID, internal until Credit Approval, and credits never move money.
- [Financial data and contributor emails (compliance)] → royalties dark by default; token page scoped to one email at one org; run compliance-ops and a pentest of the upload and token page before enabling.
- [Large statements (100k+ lines)] → batched inserts in scheduled mutations; per-statement totals precomputed.
- [Imported songs swamp the Songs page] → hidden by default behind a filter (Grilled decision 1).

## Migration Plan

Additive only: new tables, optional fields, new capability keys. `agencies.royaltiesEnabled` absent means off. The split-sheet email requirement affects only future sends. Rollback: turn the agency switch off; Catalog Import songs stay as normal Songs.

## Open Questions

- Genius `artists/:id/songs` coverage of producer and writer credits: verify once `GENIUS_ACCESS_TOKEN` exists.
- Real DistroKid, TuneCore and CD Baby sample files to confirm headers (fixtures are built from their published column lists until then).
- Should publishing statements (Songtrust / MLC) follow in a later change using publishing %? Out of scope here.
