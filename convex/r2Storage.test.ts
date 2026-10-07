import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import r2Test from "@convex-dev/r2/test";
import { R2 } from "@convex-dev/r2";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deleteFile } from "./lib/media";
import { bucketBelongsTo, isOrgBucketName, orgBucketNames, orgTag } from "./lib/orgBuckets";

/* Every server-side and finance upload path writes to Cloudflare R2, into the
   owning studio's scope and (once provisioned) the studio's own bucket. R2 and
   the Cloudflare API are mocked: nothing here touches a real bucket. */

type TestConvex = ReturnType<typeof convexTest>;

const A = "pulse-demo"; // the studio the test identities belong to
const B = "other-studio";

type Put = { bucket: string; key: string; type?: string; size: number };
let puts: Put[] = [];
let deletes: Array<{ bucket: string; key: string }> = [];
const bucketOf = (r2: unknown) => (r2 as { config: { bucket: string } }).config.bucket;

function env(perOrg = false) {
  vi.stubEnv("R2_ENDPOINT", "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIATEST");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-test-value");
  vi.stubEnv("R2_PRIVATE_BUCKET", "pulse-private");
  vi.stubEnv("R2_MEDIA_BUCKET", "pulse-media");
  vi.stubEnv("R2_KEY_PREFIX", "test");
  vi.stubEnv("R2_PUBLIC_URL", "https://media.example.test");
  if (perOrg) vi.stubEnv("R2_PER_ORG_BUCKETS", "1");
}

function mockR2() {
  puts = [];
  deletes = [];
  vi.spyOn(R2.prototype, "store").mockImplementation(async function (this: R2, _ctx, file, opts) {
    const o = typeof opts === "string" ? { key: opts } : (opts ?? {});
    const size = file instanceof Blob ? file.size : (file as Uint8Array).byteLength;
    puts.push({ bucket: bucketOf(this), key: o.key!, type: o.type, size });
    return o.key!;
  });
  vi.spyOn(R2.prototype, "deleteObject").mockImplementation(async function (this: R2, _ctx, key) {
    deletes.push({ bucket: bucketOf(this), key });
  });
}

async function setup() {
  const t = convexTest(schema);
  r2Test.register(t);
  await t.run(async (ctx) => {
    for (const [orgId, slug] of [[A, "demo"], [B, "other"]] as const) {
      await ctx.db.insert("orgs", { orgId, name: slug, slug, plan: "studio", status: "active" });
    }
    for (const [name, role, subject, orgId] of [["Olu", "owner", "user_owner", A], ["Bea", "owner", "user_b", B]] as const) {
      await ctx.db.insert("members", { orgId, name, role, email: `${subject}@demo.com`, skills: [], clerkUserId: subject });
    }
  });
  return { t, owner: t.withIdentity({ subject: "user_owner", name: "Olu" }) };
}

/** Marks an org's own buckets as provisioned (what orgBuckets.provision does). */
async function provisioned(t: TestConvex, orgId: string, slug: string) {
  const names = orgBucketNames(orgId, slug);
  await t.mutation(internal.orgBuckets._markReady, { orgId, names });
  return names;
}

const row = (t: TestConvex, id: Id<"mediaFiles">) => t.run(async (ctx) => await ctx.db.get(id));
const readyFile = (t: TestConvex, o: { orgId: string; purpose: string; bucket: "media" | "private"; bucketName?: string; size?: number; mimeType?: string }) =>
  t.run(async (ctx) => await ctx.db.insert("mediaFiles", {
    orgId: o.orgId, bucket: o.bucket, bucketName: o.bucketName, key: `test/${o.orgId}/${o.purpose}/f-${Math.random().toString(16).slice(2)}0123456789ab.bin`,
    purpose: o.purpose, fileName: "f.jpg", mimeType: o.mimeType ?? "image/jpeg", size: o.size ?? 2048, status: "ready", uploadedBy: "u", createdAt: Date.now(),
  }));

describe("per-studio bucket names", () => {
  beforeEach(() => vi.stubEnv("R2_KEY_PREFIX", "prod"));
  afterEach(() => vi.unstubAllEnvs());

  it("are valid S3 names, deterministic, distinct per org, and carry the org's tag", () => {
    const a = orgBucketNames("org_2abcDEF", "Sunset Sound & Recorders!!");
    expect(a).toEqual(orgBucketNames("org_2abcDEF", "Sunset Sound & Recorders!!"));
    expect(a.media).toMatch(/^pulse-prod-sunset-sound-recorders-[0-9a-f]{8}-media$/);
    for (const n of Object.values(a)) {
      expect(n.length).toBeLessThanOrEqual(63);
      expect(n).toMatch(/^[a-z0-9][a-z0-9-]+[a-z0-9]$/);
      expect(isOrgBucketName(n)).toBe(true);
    }
    const long = orgBucketNames("org_x", "a".repeat(200));
    expect(long.private.length).toBeLessThanOrEqual(63);
    const b = orgBucketNames("org_other", "Sunset Sound & Recorders!!");
    expect(b.media).not.toBe(a.media); // same slug, different studio
    expect(bucketBelongsTo("org_2abcDEF", a.private, "private")).toBe(true);
    expect(bucketBelongsTo("org_other", a.private)).toBe(false);
    expect(bucketBelongsTo("org_2abcDEF", a.private, "media")).toBe(false);
    expect(orgTag("x")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("uploads land in the studio's own bucket", () => {
  let t: TestConvex;
  let owner: Awaited<ReturnType<typeof setup>>["owner"];
  beforeEach(async () => { env(true); mockR2(); ({ t, owner } = await setup()); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it("presigns into the caller's own private bucket and records it on the row", async () => {
    const mine = await provisioned(t, A, "demo");
    await provisioned(t, B, "other");
    const up = await owner.mutation(api.media.prepareUpload, { purpose: "receipt", fileName: "r.pdf", mimeType: "application/pdf", size: 1000 });
    expect(up.url).toContain(mine.private);
    const r = await row(t, up.mediaId);
    expect(r).toMatchObject({ orgId: A, bucket: "private", bucketName: mine.private });
    expect(r!.key.startsWith(`test/${A}/receipt/`)).toBe(true);
  });

  it("falls back to the shared bucket while the studio's buckets are pending, and starts provisioning", async () => {
    vi.useFakeTimers();
    const up = await owner.mutation(api.media.prepareUpload, { purpose: "photo", fileName: "p.jpg", mimeType: "image/jpeg", size: 1000 });
    expect((await row(t, up.mediaId))!.bucketName).toBe("pulse-media");
    const org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect()).find((o) => o.orgId === A) ?? null);
    expect(org!.r2BucketStatus).toBe("pending");
    expect(org!.r2ProvisionAttemptAt).toBeGreaterThan(0);
  });

  it("another studio's object cannot be confirmed, read or attached, and a row can never resolve to another studio's bucket", async () => {
    const theirs = await provisioned(t, B, "other");
    const foreign = await t.run(async (ctx) => await ctx.db.insert("mediaFiles", { orgId: B, bucket: "private", bucketName: theirs.private, key: `test/${B}/receipt/x-0123456789ab.pdf`, purpose: "receipt", fileName: "x.pdf", mimeType: "application/pdf", status: "pending", uploadedBy: "u", createdAt: Date.now() }));
    expect(await owner.query(api.media.myPending, { mediaId: foreign })).toBeNull();
    await expect(owner.action(api.media.confirmUpload, { mediaId: foreign })).rejects.toThrow(/Upload not found/);
    // A tampered row: studio A's file pointing at studio B's bucket is refused on read.
    const forged = await readyFile(t, { orgId: A, purpose: "receipt", bucket: "private", bucketName: theirs.private });
    await expect(t.query(internal.media._fileUrl, { ref: forged })).rejects.toThrow(/does not belong/);
  });

  it("delete removes the object from the bucket the row records, plus any shared-bucket original", async () => {
    vi.useFakeTimers();
    const mine = await provisioned(t, A, "demo");
    const moved = await readyFile(t, { orgId: A, purpose: "photo", bucket: "media", bucketName: mine.media });
    await t.run(async (ctx) => { await ctx.db.patch(moved, { sharedCopyAt: Date.now() }); });
    const key = (await row(t, moved))!.key;
    await t.run(async (ctx) => { await deleteFile(ctx, moved); });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(deletes).toEqual(expect.arrayContaining([{ bucket: mine.media, key }, { bucket: "pulse-media", key }]));
    expect(deletes.every((d) => d.bucket === mine.media || d.bucket === "pulse-media")).toBe(true);
  });

  it("public URLs of a studio bucket go through the Worker's /o/<bucket>/ path; shared ones keep their old path", async () => {
    const mine = await provisioned(t, A, "demo");
    const own = await readyFile(t, { orgId: A, purpose: "photo", bucket: "media", bucketName: mine.media });
    const shared = await readyFile(t, { orgId: A, purpose: "photo", bucket: "media" });
    expect(await t.query(internal.media._fileUrl, { ref: own })).toMatch(new RegExp(`^https://media\\.example\\.test/o/${mine.media}/test/${A}/photo/`));
    expect(await t.query(internal.media._fileUrl, { ref: shared })).toMatch(new RegExp(`^https://media\\.example\\.test/test/${A}/photo/`));
  });

  it("a server-side import (member photo) is written to that member's studio bucket under its prefix", async () => {
    const mine = await provisioned(t, A, "demo");
    const theirs = await provisioned(t, B, "other");
    const [mA, mB] = await t.run(async (ctx) => {
      const all = await ctx.db.query("members").collect();
      return [all.find((m) => m.orgId === A)!._id, all.find((m) => m.orgId === B)!._id];
    });
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4));
    await t.action(internal.members.importMemberPhoto, { id: mA, dataBase64: png, mime: "image/png" });
    await t.action(internal.members.importMemberPhoto, { id: mB, dataBase64: png, mime: "image/png" });
    expect(puts).toHaveLength(2);
    expect(puts[0]).toMatchObject({ bucket: mine.media, type: "image/png", size: 8 });
    expect(puts[0].key.startsWith(`test/${A}/photo/`)).toBe(true);
    expect(puts[1].bucket).toBe(theirs.media);
    expect(puts[1].key.startsWith(`test/${B}/photo/`)).toBe(true);
    const member = await t.run(async (ctx) => await ctx.db.get(mA));
    const photo = await row(t, member!.photoId as Id<"mediaFiles">);
    expect(photo).toMatchObject({ orgId: A, status: "ready", bucketName: mine.media, size: 8 });
    expect(photo!.attachedAt).toBeGreaterThan(0);
  });

  it("the AI brand hero is stored in the studio's R2 bucket, not Convex storage", async () => {
    const mine = await provisioned(t, A, "demo");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: btoa("hero-bytes") } }] } }] }), { status: 200 })) as typeof fetch;
    try {
      const res = await t.action(internal.brandHero.generate, { orgId: A });
      expect(res.generated).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
    const org = await t.run(async (ctx) => (await ctx.db.query("orgs").collect()).find((o) => o.orgId === A) ?? null);
    const hero = await row(t, org!.generatedHeroId as Id<"mediaFiles">);
    expect(hero).toMatchObject({ orgId: A, purpose: "photo", bucketName: mine.media, status: "ready" });
    expect(puts[0]).toMatchObject({ bucket: mine.media, type: "image/png" });
  });
});

describe("receipts and expense receipts on R2", () => {
  let t: TestConvex;
  let owner: Awaited<ReturnType<typeof setup>>["owner"];
  beforeEach(async () => { env(); mockR2(); ({ t, owner } = await setup()); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: "image/jpeg" });

  it("the web path attaches the studio's own R2 receipt; another studio's upload is refused and left alone", async () => {
    const mine = await readyFile(t, { orgId: A, purpose: "receipt", bucket: "private", bucketName: "pulse-private" });
    const res = await owner.mutation(api.receipts.attach, { storageId: mine, fileName: "lunch.jpg" });
    expect(res.ok).toBe(true);
    const receipt = await t.run(async (ctx) => await ctx.db.get((res as { receiptId: Id<"receipts"> }).receiptId));
    expect(receipt).toMatchObject({ storageId: mine, fileType: "image/jpeg", sizeBytes: 2048 });
    expect((await row(t, mine))!.attachedAt).toBeGreaterThan(0);
    const list = await owner.query(api.receipts.list, { status: "all" });
    expect(list[0].url).toContain("pulse-private");
    expect(list[0].url).toContain("X-Amz-Signature");

    const theirs = await readyFile(t, { orgId: B, purpose: "receipt", bucket: "private" });
    expect(await owner.mutation(api.receipts.attach, { storageId: theirs, fileName: "x.jpg" })).toMatchObject({ ok: false });
    expect(await row(t, theirs)).not.toBeNull();
  });

  it("the iOS path still works (Convex upload URL + attach) and the file is then copied into the studio's private R2 scope", async () => {
    expect(await owner.mutation(api.receipts.generateUploadUrl, {})).toEqual(expect.any(String));
    const legacy = await t.run(async (ctx) => await ctx.storage.store(jpeg()));
    const res = (await owner.mutation(api.receipts.attach, { storageId: legacy, fileName: "fuel.jpg" })) as { ok: true; receiptId: Id<"receipts"> };
    expect(res.ok).toBe(true);
    const out = await t.action(internal.mediaBackfill.promote, { table: "receipts", id: res.receiptId, path: "storageId", ref: legacy, scope: A, purpose: "receipt", fileName: "fuel.jpg" });
    expect(out).toBe("repointed");
    const receipt = await t.run(async (ctx) => await ctx.db.get(res.receiptId));
    const media = await row(t, receipt!.storageId as Id<"mediaFiles">);
    expect(media).toMatchObject({ orgId: A, bucket: "private", bucketName: "pulse-private", purpose: "receipt", status: "ready", legacyStorageId: legacy, size: 8 });
    expect(media!.key.startsWith(`test/${A}/receipt/`)).toBe(true);
    expect(puts[0]).toMatchObject({ bucket: "pulse-private", key: media!.key });
    // The Convex original is kept until the dated purge.
    expect(await t.run(async (ctx) => (await ctx.storage.get(legacy)) !== null)).toBe(true);
  });

  it("deleting a promoted receipt frees the R2 object and the Convex original", async () => {
    const legacy = await t.run(async (ctx) => await ctx.storage.store(jpeg()));
    const res = (await owner.mutation(api.receipts.attach, { storageId: legacy, fileName: "f.jpg" })) as { ok: true; receiptId: Id<"receipts"> };
    await t.action(internal.mediaBackfill.promote, { table: "receipts", id: res.receiptId, path: "storageId", ref: legacy, scope: A, purpose: "receipt", fileName: "f.jpg" });
    await owner.mutation(api.receipts.remove, { id: res.receiptId });
    expect(await t.run(async (ctx) => (await ctx.storage.get(legacy)) !== null)).toBe(false);
    expect(await t.run(async (ctx) => await ctx.db.query("mediaFiles").collect())).toHaveLength(0);
  });

  it("an expense receipt from an older client is copied to R2; another studio's R2 file is refused", async () => {
    const legacy = await t.run(async (ctx) => await ctx.storage.store(jpeg()));
    const id = await owner.mutation(api.expenses.create, { category: "gear", amountCents: 1200, date: Date.now(), receiptId: legacy });
    expect(await t.action(internal.mediaBackfill.promote, { table: "expenses", id, path: "receiptId", ref: legacy, scope: A, purpose: "receipt", fileName: "expense-receipt" })).toBe("repointed");
    const expense = await t.run(async (ctx) => await ctx.db.get(id));
    expect((await row(t, expense!.receiptId as Id<"mediaFiles">))).toMatchObject({ orgId: A, bucket: "private" });

    const theirs = await readyFile(t, { orgId: B, purpose: "receipt", bucket: "private" });
    await expect(owner.mutation(api.expenses.create, { category: "gear", amountCents: 1200, date: Date.now(), receiptId: theirs })).rejects.toThrow(/Upload not found/);
  });

  it("with no R2 settings at all, a server-side write falls back to Convex storage instead of failing", async () => {
    vi.unstubAllEnvs();
    const member = await t.run(async (ctx) => (await ctx.db.query("members").collect()).find((m) => m.orgId === A)!._id);
    await t.action(internal.members.importMemberPhoto, { id: member, dataBase64: btoa("png"), mime: "image/png" });
    const photoId = (await t.run(async (ctx) => await ctx.db.get(member)))!.photoId!;
    expect(await t.run(async (ctx) => ctx.db.normalizeId("mediaFiles", photoId))).toBeNull();
    expect(puts).toHaveLength(0);
  });
});

describe("imports and the spec-sheet photo stay inside the studio", () => {
  let t: TestConvex;
  let owner: Awaited<ReturnType<typeof setup>>["owner"];
  beforeEach(async () => { env(); mockR2(); ({ t, owner } = await setup()); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("a song import cannot attach another studio's cover", async () => {
    const songId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", { orgId: A, name: "A", type: "artist", genres: [], tags: [], status: "active", reliability: "solid", sessionCount: 0, lifetimeValueCents: 0 });
      return await ctx.db.insert("songs", { orgId: A, title: "S", artistId, kind: "single", stage: "tracking", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 });
    });
    const theirs = await readyFile(t, { orgId: B, purpose: "cover", bucket: "media" });
    await expect(owner.mutation(api.songImport.applyToSong, { songId, sourceUrl: "https://open.spotify.com/track/x", coverStorageId: theirs, credits: [] })).rejects.toThrow(/Upload not found/);
    const mine = await readyFile(t, { orgId: A, purpose: "cover", bucket: "media" });
    await owner.mutation(api.songImport.applyToSong, { songId, sourceUrl: "https://open.spotify.com/track/x", coverStorageId: mine, credits: [] });
    expect((await t.run(async (ctx) => await ctx.db.get(songId)))!.coverArtId).toBe(mine);
    expect((await row(t, mine))!.attachedAt).toBeGreaterThan(0);
  });

  it("the spec-sheet photo read refuses another studio's upload", async () => {
    const deviceId = await t.run(async (ctx) => {
      const patchSpaceId = await ctx.db.insert("patchSpaces", { orgId: A, name: "Room", revision: 0, createdAt: Date.now() });
      const profileId = await ctx.db.insert("deviceProfiles", { scope: "global", name: "1073", manufacturer: "Neve", category: "preamp", portTemplate: [] });
      return await ctx.db.insert("deviceInstances", { orgId: A, patchSpaceId, profileId, label: "Neve", position: { x: 0, y: 0 }, createdAt: Date.now() });
    });
    const mine = await readyFile(t, { orgId: A, purpose: "photo", bucket: "media" });
    const theirs = await readyFile(t, { orgId: B, purpose: "photo", bucket: "media" });
    expect(await owner.query(internal.patchSpecs._panelImageOk, { deviceInstanceId: deviceId, imageId: mine })).toBe(true);
    expect(await owner.query(internal.patchSpecs._panelImageOk, { deviceInstanceId: deviceId, imageId: theirs })).toBe(false);
  });
});

describe("bucket provisioning (Cloudflare API mocked)", () => {
  let t: TestConvex;
  const realFetch = globalThis.fetch;
  let calls: Array<{ method: string; url: string; body?: string }> = [];
  beforeEach(async () => { env(true); mockR2(); ({ t } = await setup()); calls = []; });
  afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  function cf(answer: (method: string, url: string) => { status: number; body: unknown }) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body as string | undefined });
      const a = answer(method, url);
      return new Response(JSON.stringify(a.body), { status: a.status });
    }) as typeof fetch;
  }
  const org = (orgId: string) => t.run(async (ctx) => (await ctx.db.query("orgs").collect()).find((o) => o.orgId === orgId) ?? null);

  it("dry run returns the names and touches nothing", async () => {
    cf(() => ({ status: 500, body: {} }));
    const r = await t.action(internal.orgBuckets.provision, { orgId: A, dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true, names: orgBucketNames(A, "demo") });
    expect(calls).toHaveLength(0);
    expect((await org(A))!.r2BucketStatus).toBeUndefined();
  });

  it("without a provisioning token the org stays pending (shared bucket) with the reason", async () => {
    const r = await t.action(internal.orgBuckets.provision, { orgId: A });
    expect(r.ok).toBe(false);
    expect(await org(A)).toMatchObject({ r2BucketStatus: "pending", r2ProvisionError: expect.stringContaining("CF_R2_ADMIN_TOKEN") });
  });

  it("creates both buckets with CORS, treats 'already exists' as created, and marks the org ready", async () => {
    vi.stubEnv("CF_R2_ADMIN_TOKEN", "cf-test-token");
    const names = orgBucketNames(A, "demo");
    cf((method) => method === "POST" && calls.filter((c) => c.method === "POST").length === 1
      ? { status: 409, body: { success: false, errors: [{ code: 10004, message: "The bucket you tried to create already exists, and you own it." }] } }
      : { status: 200, body: { success: true, result: {} } });
    const r = await t.action(internal.orgBuckets.provision, { orgId: A });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef", "")}`)).toEqual([
      "POST /r2/buckets", `PUT /r2/buckets/${names.media}/cors`, "POST /r2/buckets", `PUT /r2/buckets/${names.private}/cors`,
    ]);
    expect(JSON.parse(calls[0].body!)).toEqual({ name: names.media });
    expect(await org(A)).toMatchObject({ r2BucketStatus: "ready", r2MediaBucket: names.media, r2PrivateBucket: names.private });
    // Idempotent: a second run does nothing.
    calls = [];
    expect(await t.action(internal.orgBuckets.provision, { orgId: A })).toMatchObject({ ok: true, already: true });
    expect(calls).toHaveLength(0);
  });

  it("a Cloudflare failure leaves the org pending and uploads keep using the shared bucket", async () => {
    vi.stubEnv("CF_R2_ADMIN_TOKEN", "cf-test-token");
    cf(() => ({ status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } }));
    const r = await t.action(internal.orgBuckets.provision, { orgId: A });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("Authentication error") });
    expect((await org(A))!.r2BucketStatus).toBe("pending");
    const up = await t.withIdentity({ subject: "user_owner" }).mutation(api.media.prepareUpload, { purpose: "photo", fileName: "p.jpg", mimeType: "image/jpeg", size: 10 });
    expect((await row(t, up.mediaId))!.bucketName).toBe("pulse-media");
  });

  it("the backfill dry run lists every unprovisioned studio against the bucket quota", async () => {
    vi.stubEnv("CF_R2_ADMIN_TOKEN", "cf-test-token");
    cf(() => ({ status: 200, body: { success: true, result: { buckets: [{ name: "pulse-media" }, { name: "pulse-private" }] } } }));
    const r = await t.action(internal.orgBuckets.provisionAll, {});
    expect(r).toMatchObject({ dryRun: true, orgs: 2, bucketsNeeded: 4, existingBuckets: 2, quota: 1000 });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    vi.stubEnv("R2_BUCKET_QUOTA", "5");
    const refused = await t.action(internal.orgBuckets.provisionAll, { dryRun: false });
    expect(refused.refused).toMatch(/over the quota of 5/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("names that do not belong to the org are refused when marking ready", async () => {
    await expect(t.mutation(internal.orgBuckets._markReady, { orgId: A, names: orgBucketNames(B, "other") })).rejects.toThrow(/do not belong/);
  });
});
