# Per-studio R2 buckets

Every studio org (each sub-account) gets two Cloudflare R2 buckets of its own: one public media bucket and one private bucket. Today all files share `pulse-media` and `pulse-private`, separated only by key prefix. This doc covers the design, what is built, and the steps only Lawrence can do in Cloudflare.

Status on 2026-10-07: **built in code and tested with mocks, switched off.** Nothing has been created in Cloudflare and no Convex deployment has been changed.

## Naming

```
pulse-<env>-<slug>-<tag>-media
pulse-<env>-<slug>-<tag>-private
```

- `<env>`: `R2_BUCKET_ENV`, or `R2_KEY_PREFIX` (`dev` / `prod`). Dev and prod never share a bucket.
- `<slug>`: the org slug, lowercased, non-alphanumerics to `-`, cut to 24 chars.
- `<tag>`: 8 hex chars, FNV-1a hash of the orgId. It keeps names unique when slugs collide. It also lets code check that a bucket belongs to an org without reading the database (`bucketBelongsTo` in `convex/lib/orgBuckets.ts`).
- Every name is 63 characters or fewer, lowercase letters, digits and hyphens only. It starts and ends with a letter or digit, as S3 requires.
- Names are stored on the org (`orgs.r2MediaBucket`, `orgs.r2PrivateBucket`), so a later slug change does not move anything.

Agency-owned files (`agency:<id>` scope: agency logos and favicons) are not a studio's files. They stay in the shared buckets.

## Schema (additive only)

- `orgs`: `r2MediaBucket`, `r2PrivateBucket`, `r2BucketStatus` (`pending` | `ready`), `r2ProvisionedAt`, `r2ProvisionAttemptAt`, `r2ProvisionError`.
- `mediaFiles`: `bucketName` is the bucket the object actually lives in. Rows from before this change have no `bucketName` and are read from the shared bucket for their role. `sharedCopyAt` is set when a file was moved out of a shared bucket and its original there has not been purged yet.

## Provisioning flow

1. A trigger fires. Sub-account creation (`agency.ts`, `stageDemo.ts`) calls `ensureOrgBuckets`. The first upload or server-side store for any org without buckets does the same through `createUpload`. Retries come at most once an hour while an org is pending.
2. `ensureOrgBuckets` marks the org `pending` and schedules `orgBuckets.provision`.
3. `provision` (internal action) creates both buckets with `POST /accounts/{acct}/r2/buckets`. A 409 or code 10004 ("already exists, and you own it") counts as created, so a re-run is safe. It then sets CORS on each bucket (`PUT .../cors`, methods GET/PUT/HEAD, origins from `R2_CORS_ORIGINS`) because browsers PUT straight to R2 with presigned URLs.
4. On success the org becomes `ready` with both names. On any failure (no token, 403, network) it stays `pending` with `r2ProvisionError`.
5. **Uploads never break.** Until an org is `ready`, and whenever `R2_PER_ORG_BUCKETS` is off, `resolveBucket` returns the shared bucket. The row records which bucket that was, so reads, deletes and signed URLs keep working after the org flips to `ready`.

Every step is dry-runnable: `provision {orgId, dryRun: true}` and `provisionAll {}` (dry run is the default) return the names they would create and change nothing. Tests only ever run provisioning against a mocked `fetch`.

## Resolution: the bucket always comes from the file's org

- **Presign (upload):** `createUpload` resolves the bucket from the upload's scope (the caller's own org, from auth), never from an argument. The bucket name goes on the row.
- **Confirm:** `confirmUpload` reads the row (only if it is the caller's) and checks the object in the row's bucket.
- **Read:** `fileUrl` uses `rowBucket(row)`. Private files get a signed URL from that bucket. Public files get `R2_PUBLIC_URL/o/<bucket>/<key>`, or the old `R2_PUBLIC_URL/<key>` for shared-bucket rows.
- **Delete:** `deleteFile` / `_discard` / the sweeper schedule `_deleteObject` with the row's bucket. If the row has a shared-bucket original (`sharedCopyAt`) or a Convex storage original (`legacyStorageId`), those are deleted with it.
- **Server-side writes** (`storeBytes`: AI brand hero, staged-demo logos and room photos, song-import covers, studio-site logos, member photo import, iOS and expense receipts copied from Convex storage) go through the same `createUpload`, so they land in the same bucket.

## Isolation guarantees (and the tests that prove them)

`convex/r2Storage.test.ts`:

- A presigned PUT for studio A is signed for A's bucket, and the row records it.
- Studio A cannot confirm, read (`myPending`) or attach studio B's upload. Receipts, expense receipts, song covers and spec-sheet photos refuse another studio's file.
- A row can never resolve to another studio's bucket. `rowBucket` checks the hashed tag against the row's own org and throws on a mismatch, even for a row tampered with by hand.
- A role mismatch is refused: a private file can never be served from a `-media` bucket.
- Every key also keeps the `<prefix>/<orgId>/<purpose>/` prefix, so per-studio objects stay identifiable inside the shared buckets as well.
- Deletes go to the row's own bucket (plus its shared original), never to another bucket.
- `_markReady` refuses bucket names that do not carry the org's tag.

`src/lib/pulse-media-worker.test.ts`: the Worker serves only `pulse-<ORG_BUCKET_ENV>-...-<tag>-media`. A `-private` bucket or another environment's bucket is a 404 with no request to R2. Its SigV4 signature matches the AWS SDK's reference signer byte for byte.

## Public media serving

A Worker binding is one bucket per binding, so the `BUCKET` binding cannot cover thousands of studio buckets. The Worker now has a second route:

- `/<key>`: unchanged. This is the shared `pulse-media` bucket through the `BUCKET` binding.
- `/o/<bucket>/<key>`: reads a studio media bucket through R2's S3 API with a SigV4-signed GET (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). It accepts only names matching this environment's media pattern (`ORG_BUCKET_ENV`), forwards Range and conditional headers, applies the same content-type hardening, CSP and caching rules, and uses the edge cache.

Alternatives considered and rejected: r2.dev public URLs per bucket (rate limited and not meant for production) and a custom domain per bucket (one DNS record per studio, does not scale).

## Moving existing files (not executed)

`scripts/r2/migrate-to-org-buckets.mjs` runs as a dry run by default and works like `scripts/r2/backfill.mjs`:

```
node scripts/r2/migrate-to-org-buckets.mjs --provision            # list buckets + quota check
node scripts/r2/migrate-to-org-buckets.mjs --provision --apply    # create them
node scripts/r2/migrate-to-org-buckets.mjs                        # count files to move
node scripts/r2/migrate-to-org-buckets.mjs --apply                # move (same key, size checked, row repointed)
node scripts/r2/migrate-to-org-buckets.mjs --purge-days 14 --apply  # delete shared originals moved 14+ days ago
```

Add `--prod` for production. A move never deletes the shared original. The old public URL keeps working until the purge.

Separately, files still in Convex storage (pre-R2 rows, and receipts uploaded by the shipped iOS app before they are copied) are handled by `scripts/r2/backfill.mjs`, which now also covers `receipts.storageId` and `expenses.receiptId`. Convex originals are freed only by its `--purge-days` step.

## What Lawrence must do in Cloudflare and Convex

1. **Bucket-creation token.** Create an account API token with *Workers R2 Storage: Edit* (Admin Read & Write) for the Pulse OS account. Store it in 1Password, then `npx convex env set CF_R2_ADMIN_TOKEN <token>` on dev first. `CF_ACCT` is optional (it is read from `R2_ENDPOINT`).
2. **S3 key scope.** The R2 S3 key pair Convex uses (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, from `set-convex-env.sh`) must be allowed on **all buckets in the account**, not just `pulse-media` and `pulse-private`. Otherwise every presign into a studio bucket returns 403. Check the token's R2 permission is "Object Read & Write, all buckets", or issue a new one and re-run `set-convex-env.sh`.
3. **Redeploy the Worker:** `scripts/r2/deploy-media-worker.sh prod`. It adds `R2_ACCOUNT_ID` and `ORG_BUCKET_ENV` and uploads the S3 key pair as Worker secrets. A separate read-only R2 token for the Worker is better; swap it in when one exists.
4. **Dry run, then provision on dev:** `node scripts/r2/migrate-to-org-buckets.mjs --provision`, then the same with `--apply`. Then `npx convex env set R2_PER_ORG_BUCKETS 1` on dev, upload a photo and a receipt, and confirm the URLs and objects.
5. **Production:** repeat steps 1, 4 and the move with `--prod`. The move runs as a dry run first.

### Bucket quota: the ceiling this design hits

Cloudflare's default R2 limit is **1,000 buckets per account**. At two buckets per studio, minus the shared `pulse-media` and `pulse-private` (plus any dev buckets), **the account tops out at about 499 studios**. Dev and prod share the account, so dev studios count too. `provisionAll` refuses to start a run that would exceed `R2_BUCKET_QUOTA` (default 1000).

Before Pulse passes about 400 studios, ask Cloudflare (dashboard → Support → limit increase, or the account team) to raise the R2 bucket limit. Request 10,000 buckets, which covers about 5,000 studios. Deleting a sub-account schedules `orgBuckets.releaseBuckets` 15 minutes after its objects are deleted. R2 only deletes empty buckets, so if a bucket still holds objects, it is reported and kept.

## Public claim

The /pricing line *"Every file and every version is stored on Cloudflare R2, in a bucket of your own."*

- **In code:** true once `R2_PER_ORG_BUCKETS=1` and a studio is provisioned. Until then its new files go to the shared buckets, and files uploaded before the move stay there until the migration script runs.
- **In production:** **not true yet.** Nothing is provisioned, the flag is off, and existing files are in the shared buckets. Do not publish the "bucket of your own" half until steps 1 to 5 are done and the move dry run reports zero files. "Every file is stored on Cloudflare R2" also needs the Convex-storage backfill to report zero files left.
