#!/usr/bin/env node
/* Uploads heavy public media to the pulse-media R2 bucket and writes the key
   manifest the app reads. Credentials come from 1Password at run time:
     CF_TOKEN="$(op read 'op://Security/Cloudflare Pulse OS/Your API Token')" \
     CF_ACCT="$(op read 'op://Security/Cloudflare Pulse OS/Account ID')" node scripts/r2/sync-public-media.mjs
   Directories keep their path (gear/..., rooms/...) because stored database rows
   point at /gear/... and /rooms/...; the app redirects those to R2. Single files
   get a content-hashed key (site/<name>-<hash8>.<ext>) so they cache forever. */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, extname, basename } from "node:path";

const { CF_TOKEN, CF_ACCT } = process.env;
if (!CF_TOKEN || !CF_ACCT) throw new Error("Set CF_TOKEN and CF_ACCT (see header).");
const BUCKET = "pulse-media";
const API = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCT}/r2/buckets/${BUCKET}/objects`;
const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".gif": "image/gif", ".svg": "image/svg+xml" };

const DIRS = ["gear", "rooms"];
const FILES = ["pulse-commercial.mp4", "bg-loop-960.mp4", "mobile/app-loop.mp4", "mobile/app-loop.webm"];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function put(key, file) {
  const body = readFileSync(file);
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`Unknown type for ${file}`);
  const res = await fetch(`${API}/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT", headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": type }, body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(`PUT ${key} failed: ${res.status} ${JSON.stringify(json.errors ?? [])}`);
  return body.length;
}

const manifest = {};
let bytes = 0, count = 0;
for (const dir of DIRS) {
  for (const f of walk(join("public", dir))) {
    if (basename(f).startsWith(".")) continue;
    const key = f.slice("public/".length);
    bytes += await put(key, f); count++;
  }
}
for (const rel of FILES) {
  const f = join("public", rel);
  const hash = createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 8);
  const ext = extname(rel);
  const key = `site/${basename(rel, ext)}-${hash}${ext}`;
  bytes += await put(key, f); count++;
  manifest[`/${rel}`] = key;
}
writeFileSync("src/lib/media-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`uploaded ${count} files, ${(bytes / 1048576).toFixed(1)} MB; manifest written`);
