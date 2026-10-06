#!/usr/bin/env node
/* Copies files still stored in Convex storage into Cloudflare R2 and repoints their rows.
   Dry run by default. Run from the repo root, against dev first:

     node scripts/r2/backfill.mjs                      # dev, dry run: counts what would move
     node scripts/r2/backfill.mjs --apply              # dev, copy for real
     node scripts/r2/backfill.mjs --prod               # production, dry run
     node scripts/r2/backfill.mjs --prod --apply       # production, copy for real
     node scripts/r2/backfill.mjs --prod --purge-days 14 --apply   # free legacy files copied 14+ days ago

   Options: --limit N (stop after N copies), --concurrency N (default 3), --only table[,table]
   Legacy Convex files are NOT deleted by a copy. They are freed only by --purge-days, and
   only when a full pass finds nothing left to copy (a file referenced twice stays safe). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, createWriteStream, statSync } from "node:fs";
import { openAsBlob } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PROD = flag("--prod"), APPLY = flag("--apply");
const LIMIT = Number(opt("--limit", "0")) || Infinity;
const CONC = Math.max(1, Number(opt("--concurrency", "3")));
const ONLY = opt("--only", "") ? new Set(opt("--only").split(",")) : null;
const PURGE_DAYS = opt("--purge-days", "");

function convex(fn, args) {
  const out = execFileSync("npx", ["convex", "run", ...(PROD ? ["--prod"] : []), fn, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const m = out.match(/[\[{][\s\S]*[\]}]\s*$/) ?? out.match(/"[^"]*"\s*$/);
  return m ? JSON.parse(m[0]) : null;
}

async function listAll() {
  const items = [];
  let next = { specIndex: 0, cursor: null };
  while (next) {
    const r = convex("mediaBackfill:page", { ...next, limit: 100 });
    items.push(...r.items.filter((i) => !ONLY || ONLY.has(i.table)));
    next = r.next;
  }
  return items;
}

const dir = mkdtempSync(join(tmpdir(), "r2-backfill-"));
const stats = { copied: 0, changed: 0, failed: 0, bytes: 0 };

async function copyOne(item) {
  const info = convex("mediaBackfill:legacyInfo", { ref: item.ref });
  if (!info) return "gone";
  const tmp = join(dir, item.ref);
  const res = await fetch(info.url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  if (statSync(tmp).size !== info.size) throw new Error("download size mismatch");
  const up = convex("mediaBackfill:startCopy", { scope: item.scope, purpose: item.purpose, fileName: item.fileName, mimeType: info.contentType, size: info.size, legacy: item.ref });
  const put = await fetch(up.url, { method: "PUT", headers: { "Content-Type": info.contentType, "Content-Length": String(info.size) }, body: await openAsBlob(tmp, { type: info.contentType }) });
  rmSync(tmp, { force: true });
  if (!put.ok) throw new Error(`R2 PUT ${put.status}`);
  const fin = convex("mediaBackfill:finishCopy", { mediaId: up.mediaId, expectedSize: info.size });
  if (!fin.ok) throw new Error(fin.reason);
  const r = convex("mediaBackfill:repoint", { table: item.table, id: item.id, path: item.path, index: item.index, oldRef: item.ref, mediaId: up.mediaId });
  stats.bytes += info.size;
  return r;
}

async function main() {
  console.log(`${PROD ? "PRODUCTION" : "dev"} ${APPLY ? "APPLY" : "dry run"}`);
  const items = await listAll();
  const byTable = {};
  for (const i of items) byTable[i.table] = (byTable[i.table] ?? 0) + 1;
  console.log(`legacy files still in Convex storage: ${items.length}`, byTable);

  if (PURGE_DAYS) {
    if (items.length > 0) { console.log("Refusing to purge: files are still waiting to be copied."); process.exit(1); }
    if (!APPLY) { console.log("Dry run: nothing purged. Add --apply."); return; }
    console.log(convex("mediaBackfill:purgeLegacy", { days: Number(PURGE_DAYS), limit: LIMIT === Infinity ? 1000 : LIMIT }));
    return;
  }
  if (!APPLY) { console.log("Dry run: nothing copied. Add --apply."); return; }

  const queue = items.slice(0, LIMIT);
  let n = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const r = await copyOne(item);
        if (r === "repointed") stats.copied++; else stats.changed++;
        if (++n % 10 === 0) console.log(`  ${n} done, ${(stats.bytes / 1048576).toFixed(1)} MB`);
      } catch (e) {
        stats.failed++;
        console.error(`FAILED ${item.table} ${item.id} ${item.path}: ${e.message}`);
      }
    }
  }));
  console.log(stats);
  rmSync(dir, { recursive: true, force: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
