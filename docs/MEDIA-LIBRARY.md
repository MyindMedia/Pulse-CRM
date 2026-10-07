# Media library with version control

Status 2026-10-07: built and tested with mocks on `feat/core-growth-max-pricing`. Nothing deployed.

## Tiers (source: `convex/lib/pricing.ts`)

| Capability key | Tier | What it opens |
|---|---|---|
| `finishedMixes` | Core | `/mixes`: mix and master versions per song, notes per version, approval, download, add a version. `convex/finishedMixes.ts`. Shows no other file kind and no library. |
| `mediaLibrary` | Growth | `/library`: sessions, stems, mixes, masters, artwork, deliverables. Search, versions, restore, notes, approval, guest links. `convex/mediaLibrary.ts`. |
| `sharedMediaLibrary` | Max | "All my studios" view in `/library`. Read-only. Only studios with the same `orgs.agencyId` and a Max tier; a Max studio with no agency sees only itself. |

Permissions reuse `deliverables.read / upload / approve` (and `grants.issue` for links). The entitlement passed with them is `mediaLibrary` (or `sharedMediaLibrary`), so no new role capability exists. The org always comes from the signed-in viewer.

## Storage

Every file goes through `convex/lib/media.ts`: presigned PUT into the studio's own private R2 bucket (`pulse-<env>-<slug>-<tag>-private`, or the shared bucket until provisioned), `media.confirmUpload`, then attach. Reads are signed GETs, one hour. No Convex `_storage`. A version row points at a `mediaFiles` row. A restore reuses the older file (no extra bytes). Allowance: `meterStorageUpload` at attach (real size) plus `assertWithinLimit` at prepare (declared size); caps from `ALLOWANCES.storageGb` (Core 10, Growth 100, Max 1,000 pooled).

## Tables (`convex/mediaLibraryTables.ts`, spread into `schema.ts`)

`mediaAssets`, `mediaVersions`, `mediaNotes` (library versions and Core finished-mix deliverables), `mediaEvents` (who/when trail). Finished mixes keep using the existing `deliverables` table.

## Guest links

`mediaLibrary.issueGuestLink` writes a `collaboratorGrants` row (scope `deliverable`, `entityId` = asset id, max 30 days, counts toward `magic_links`). Public page `/files/<token>` (route allowed in `src/middleware.ts`) uses `guestAsset` and `guestSetApproval`. Revoke with `grants.revoke`.

## iOS app (not edited here)

Already available: `deliverables:setStatus` (approval on a finished mix), `deliverables:forSong`, `files:downloadUrl`.

For the same screens on the phone, call:

- Core: `finishedMixes:list`, `finishedMixes:notes`, `finishedMixes:addNote`, `finishedMixes:songChoices`, `finishedMixes:prepareUpload`, `media:confirmUpload`, `finishedMixes:addVersion`.
- Growth: `mediaLibrary:access` (never throws; use it before the others), `search`, `detail`, `downloadUrl`, `prepareUpload`, `media:confirmUpload`, `addVersion`, `restoreVersion`, `addNote`, `setApproval`, `updateAsset`, `deleteAsset`, `issueGuestLink`, `guestLinks`, `storage`, `linkChoices`.
- Max: `sharedStudios`, `sharedSearch`, `sharedDetail`, `sharedDownloadUrl`.

Locked calls throw `UPGRADE_REQUIRED`. Per the decisions file, the app shows no plan names; hide the screen when `access` says no.

## Mirrored tables (`convex/lib/mirroredTables.ts`)

Not needed for the above: the app uses live queries. Mirroring the four new tables would also put them on the Mac offline copy; add them only if offline browsing of versions is wanted. If so, each is `orgId`-first via `by_org` (`mediaAssets` uses `by_org` = `[orgId, updatedAt]`), gate them on `deliverables.read`, and keep `mediaFiles` out (it holds bucket keys).

## Not covered

Song deliverables created on the Songs page are not copied into the library; they stay in Finished mixes. No folder tree. Search matches whole words through the search index plus a substring pass over the 400 newest files.
