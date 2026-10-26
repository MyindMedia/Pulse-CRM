## Why

Pulse users want their released work inside Pulse: an artist's discography, or a producer's, writer's or engineer's credits, each with ISRC, credits and a drafted split sheet, so the studio holds one catalog and can show proof of work on the booking page. Once songs and signed split sheets exist, the next ask is working out who is owed what from distributor statements. Today Pulse imports one song per pasted link, has no notion of "my catalog", and has nothing for royalty statements.

## What Changes

- **Catalog Import (Growth).** A Member imports their own catalog from their profile, choosing Credit Roles (Artist, Writer, Producer, Engineer, Mix Engineer, Mastering Engineer, Vocalist, Musician). The Studio imports a Roster Artist's catalog from the artist page. The person picks their exact Credit Identity (an artist link from Spotify, Apple Music or TIDAL, or a search result from Genius / MusicBrainz / Deezer), stored by source ID. Import runs in the background with progress, capped at 500 songs, and dedupes against existing Songs by ISRC, then title + primary artist.
- **Import Destination.** Each import fills one workspace the person picks: their own account or a studio they belong to. That workspace's plan pays; copies never sync.
- **Imported Catalog Songs** land at stage Released in the Songs list with an "Imported" badge and filter, each enriched with ISRC, ISWC, credits and a drafted split sheet.
- **Split sheets on every plan.** `splitSheets` moves from Max to Core.
- **Credit Approval.** A Member's imported credits can fill their booking-page Notable Credits only after an owner or manager approves them; public credits carry their source.
- **Royalty Statements (Max, behind an agency toggle).** Upload a DistroKid, TuneCore or CD Baby CSV (auto-detected) or any CSV through a remembered column mapping. Lines match Songs by ISRC; master % from the signed split sheet gives each contributor's Royalty Share. Unsigned sheets hold income as Unallocated; unknown ISRCs become Unmatched Lines. Contributors get a per-period statement email with a private no-login history link. The account holder pays outside Pulse and marks shares paid. No money moves through Pulse.
- **Agency toggle.** A "Royalties" switch on the agency record, off by default. While off, every royalty function refuses and every royalty surface is absent for every studio under that agency.
- **Split sheet contributor email.** Every split-sheet row needs an email before the sheet can be sent for signature (today a row with no email is silently skipped, so the sheet can never be fully executed).
- **Not included:** streaming-service sign-in, payouts through Pulse, publishing statements, PRO/MLC registration.

## Capabilities

### New Capabilities
- `catalog-import`: Credit Identity selection, role-based catalog discovery, background import with dedupe and enrichment, Imported Catalog Songs, Credit Approval and Notable Credits.
- `royalty-statements`: agency Royalties toggle, statement upload and parsing, ISRC matching, Royalty Shares, Unallocated Income, Unmatched Lines, Contributor Statements, mark paid.
- `split-sheet-signing`: contributor email required before a sheet is sent for signature.

### Modified Capabilities
<!-- None: openspec/specs/ holds no existing capability specs. -->

## Impact

- **Convex:** new tables for credit identities, catalog import jobs, royalty statements, statement lines, royalty shares, statement column mappings; new fields on `songs` (import provenance), `agencies` (royalties toggle), `members` (approved credits). New modules for catalog discovery (Deezer, iTunes lookup, MusicBrainz, Genius), CSV parsing and royalty allocation. New capability keys `catalogImport` (growth) and `royalties` (max) in `convex/lib/pricing.ts`.
- **Reuses:** `convex/lib/catalogLookup.ts` and `convex/lib/musicLink.ts` (PR #178), `songImport.applyToSong` enrichment rules, `splitSheets` + `splitSignatures`, `collaboratorGrants` token pattern, `sendEmail` + `brandEmail`, `requireFeature` gating.
- **UI:** member profile and roster artist page gain "Import catalog"; Songs gains an "Imported catalog" filter; a new Royalties area (Max, toggle on); Agency > Settings gains the Royalties switch; a public token page for contributor history.
- **External:** Deezer, iTunes Search/Lookup, MusicBrainz (no keys); Genius (`GENIUS_ACCESS_TOKEN`, not yet created).
- **Gates:** compliance-ops (earnings data and contributor emails) and a pentest of the CSV upload and token page before calling it done.
