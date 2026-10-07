#!/usr/bin/env node
/* Per-studio R2 buckets (docs/R2-PER-ORG-BUCKETS.md): provision every studio's two
   buckets, then move files that still sit in the shared pulse-media / pulse-private
   buckets into their studio's own bucket. DRY RUN BY DEFAULT. Run from the repo root,
   against dev first:

     node scripts/r2/migrate-to-org-buckets.mjs --provision            # dev: list buckets it would create + quota check
     node scripts/r2/migrate-to-org-buckets.mjs --provision --apply    # dev: create them (needs CF_R2_ADMIN_TOKEN on Convex)
     node scripts/r2/migrate-to-org-buckets.mjs                        # dev: count files that would move
     node scripts/r2/migrate-to-org-buckets.mjs --apply                # dev: move them
     node scripts/r2/migrate-to-org-buckets.mjs --purge-days 14        # dev: count shared originals moved 14+ days ago
     node scripts/r2/migrate-to-org-buckets.mjs --purge-days 14 --apply
     ...add --prod to any of the above for production.

   Options: --limit N (stop after N moves), --concurrency N (default 3).
   A move copies the object (same key) into the studio's bucket, checks the size, then
   repoints the mediaFiles row. The shared original is NOT deleted by a move; it is
   freed by --purge-days, or when the file itself is deleted. Bytes stream through this
   laptop, like scripts/r2/backfill.mjs, because large audio does not fit an action. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, createWriteStream, statSync, openAsBlob } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PROD = flag("--prod"), APPLY = flag("--apply"), PROVISION = flag("--provision");
const LIMIT = Number(opt("--limit", "0")) || Infinity;
const CONC = Math.max(1, Number(opt("--concurrency", "3")));
const PURGE_DAYS = opt("--purge-days", "");

function convex(fn, args) {
  const out = execFileSync("npx", ["convex", "run", ...(PROD ? ["--prod"] : []), fn, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const m = out.match(/[\[{][\s\S]*[\]}]\s*$/) ?? out.match(/"[^"]*"\s*$/);
  return m ? JSON.parse(m[0]) : null;
}

async function listAll() {
  const items = [];
  let cursor = null;
  do {
    const r = convex("orgBuckets:migrationPage", { cursor, limit: 200 });
    items.push(...r.items);
    cursor = r.cursor;
  } while (cursor);
  return items;
}

const dir = mkdtempSync(join(tmpdir(), "r2-org-move-"));
const stats = { moved: 0, skipped: 0, failed: 0, bytes: 0 };

async function moveOne(item) {
  const plan = convex("orgBuckets:startMove", { mediaId: item.mediaId });
  if (!plan) return "skipped";
  const tmp = join(dir, item.mediaId);
  const res = await fetch(plan.getUrl);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const size = statSync(tmp).size;
  if (plan.size && size !== plan.size) throw new Error(`download size ${size}, row says ${plan.size}`);
  const put = await fetch(plan.putUrl, { method: "PUT", headers: { "Content-Type": plan.contentType, "Content-Length": String(size) }, body: await openAsBlob(tmp, { type: plan.contentType }) });
  rmSync(tmp, { force: true });
  if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
  const fin = convex("orgBuckets:finishMove", { mediaId: item.mediaId, toBucket: plan.toBucket, expectedSize: size });
  if (!fin.ok) throw new Error(fin.reason);
  stats.bytes += size;
  return "moved";
}

async function main() {
  console.log(`${PROD ? "PRODUCTION" : "dev"} ${APPLY ? "APPLY" : "dry run"}`);
  if (PROVISION) {
    console.log(JSON.stringify(convex("orgBuckets:provisionAll", { dryRun: !APPLY }), null, 2));
    return;
  }
  if (PURGE_DAYS) {
    console.log(convex("orgBuckets:purgeSharedCopies", { days: Number(PURGE_DAYS), limit: LIMIT === Infinity ? 500 : LIMIT, dryRun: !APPLY }));
    return;
  }
  const items = await listAll();
  const byOrg = {};
  for (const i of items) byOrg[i.orgId] = (byOrg[i.orgId] ?? 0) + 1;
  console.log(`files in the shared buckets whose studio has its own buckets: ${items.length}`, byOrg);
  if (!APPLY) { console.log("Dry run: nothing moved. Add --apply."); return; }

  const queue = items.slice(0, LIMIT);
  let n = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const r = await moveOne(item);
        stats[r]++;
        if (++n % 10 === 0) console.log(`  ${n} done, ${(stats.bytes / 1048576).toFixed(1)} MB`);
      } catch (e) {
        stats.failed++;
        console.error(`FAILED ${item.mediaId} (${item.orgId}): ${e.message}`);
      }
    }
  }));
  console.log(stats);
  rmSync(dir, { recursive: true, force: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
