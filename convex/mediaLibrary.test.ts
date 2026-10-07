import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import r2Test from "@convex-dev/r2/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CAPABILITY_TIER, FEATURE_GROUPS, ALLOWANCES } from "./lib/pricing";
import { orgBucketNames } from "./lib/orgBuckets";

/* Media library with version control. R2 is mocked (the convex-dev/r2 test
   component presigns locally); nothing here touches Cloudflare or a deployment. */

type T = ReturnType<typeof convexTest>;
const GB = 1024 * 1024 * 1024;

const STUDIOS = [
  { orgId: "studio_core", tier: "core", user: "u_core" },
  { orgId: "studio_growth", tier: "growth", user: "u_growth" },
  { orgId: "studio_growth2", tier: "growth", user: "u_growth2" },
  { orgId: "studio_max_a", tier: "max", user: "u_max_a", agencyId: "agency_x" },
  { orgId: "studio_max_b", tier: "max", user: "u_max_b", agencyId: "agency_x" },
  { orgId: "studio_growth_in_x", tier: "growth", user: "u_gx", agencyId: "agency_x" },
  { orgId: "studio_max_c", tier: "max", user: "u_max_c", agencyId: "agency_y" },
] as const;

function env() {
  vi.stubEnv("R2_ENDPOINT", "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIATEST");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-test-value");
  vi.stubEnv("R2_PRIVATE_BUCKET", "pulse-private");
  vi.stubEnv("R2_MEDIA_BUCKET", "pulse-media");
  vi.stubEnv("R2_KEY_PREFIX", "test");
  vi.stubEnv("R2_PUBLIC_URL", "https://media.example.test");
  vi.stubEnv("R2_PER_ORG_BUCKETS", "1");
}

async function setup() {
  const t = convexTest(schema);
  r2Test.register(t);
  await t.run(async (ctx) => {
    for (const s of STUDIOS) {
      await ctx.db.insert("orgs", { orgId: s.orgId, name: s.orgId, slug: s.orgId.replace(/_/g, "-"), tier: s.tier, status: "active", ...("agencyId" in s ? { agencyId: s.agencyId } : {}) });
      await ctx.db.insert("members", { orgId: s.orgId, name: s.user, role: "owner", skills: [], clerkUserId: s.user });
    }
  });
  const as = (user: string) => t.withIdentity({ subject: user, name: user });
  // Each studio's own buckets, as orgBuckets.provision would leave them.
  for (const s of STUDIOS) await t.mutation(internal.orgBuckets._markReady, { orgId: s.orgId, names: orgBucketNames(s.orgId, s.orgId.replace(/_/g, "-")) });
  return { t, as };
}

/** prepareUpload -> (the browser PUTs) -> confirmUpload, with the confirm step's effect applied directly. */
async function upload(t: T, who: ReturnType<T["withIdentity"]>, prepare: typeof api.mediaLibrary.prepareUpload | typeof api.finishedMixes.prepareUpload, size = 5_000_000, fileName = "mix.wav") {
  const prep = await who.mutation(prepare, { fileName, mimeType: "audio/wav", size });
  await t.mutation(internal.media._markReady, { mediaId: prep.mediaId as Id<"mediaFiles">, size });
  return prep;
}

describe("tier gate matches the pricing config", () => {
  it("config: finished mixes Core, library Growth, shared library Max", () => {
    expect(CAPABILITY_TIER.finishedMixes).toBe("core");
    expect(CAPABILITY_TIER.mediaLibrary).toBe("growth");
    expect(CAPABILITY_TIER.sharedMediaLibrary).toBe("max");
    const group = FEATURE_GROUPS.find((g) => g.isNew)!;
    expect(group.items.find((f) => f.gate === "mediaLibrary")!.tier).toBe("growth");
    expect(group.items.find((f) => f.gate === "sharedMediaLibrary")!.tier).toBe("max");
  });

  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { env(); ctx = await setup(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("Core reaches finished mixes and version notes, not the library or the shared view", async () => {
    const core = ctx.as("u_core");
    expect(await core.query(api.finishedMixes.list, {})).toEqual([]);
    await expect(core.query(api.mediaLibrary.search, {})).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });
    await expect(core.mutation(api.mediaLibrary.prepareUpload, { fileName: "a.wav", mimeType: "audio/wav", size: 10 })).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });
    await expect(core.query(api.mediaLibrary.sharedSearch, {})).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });
  });

  it("Growth gets the library but not the shared view; Max gets both", async () => {
    const growth = ctx.as("u_growth");
    expect(await growth.query(api.mediaLibrary.search, {})).toEqual([]);
    await expect(growth.query(api.mediaLibrary.sharedSearch, {})).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });
    const max = ctx.as("u_max_a");
    expect(await max.query(api.mediaLibrary.search, {})).toEqual([]);
    expect(await max.query(api.mediaLibrary.sharedSearch, {})).toEqual([]);
  });
});

describe("uploads and versions", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { env(); ctx = await setup(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("a library upload is presigned into the studio's own private bucket under its own key prefix", async () => {
    const who = ctx.as("u_growth");
    const prep = await who.mutation(api.mediaLibrary.prepareUpload, { fileName: "Lead Vox.WAV", mimeType: "audio/wav", size: 4_000_000 });
    const own = orgBucketNames("studio_growth", "studio-growth");
    expect(prep.url).toContain(own.private);
    expect(prep.url).toContain("X-Amz-Signature");
    const row = await ctx.t.run(async (c) => await c.db.get(prep.mediaId));
    expect(row).toMatchObject({ orgId: "studio_growth", bucket: "private", bucketName: own.private, purpose: "deliverable", status: "pending" });
    expect(row!.key).toMatch(/^test\/studio_growth\/deliverable\/lead-vox-[0-9a-f-]{36}\.wav$/);
  });

  it("numbers versions 1, 2, 3; restore makes a new version and keeps history; one file holds its own bytes once", async () => {
    const who = ctx.as("u_growth");
    const a = await upload(ctx.t, who, api.mediaLibrary.prepareUpload, 3_000_000);
    const v1 = await who.mutation(api.mediaLibrary.addVersion, { mediaId: a.mediaId as Id<"mediaFiles">, name: "Final master", kind: "master", tags: ["Client Approved", "  wav "], note: "first" });
    expect(v1.version).toBe(1);
    const b = await upload(ctx.t, who, api.mediaLibrary.prepareUpload, 4_000_000);
    const v2 = await who.mutation(api.mediaLibrary.addVersion, { mediaId: b.mediaId as Id<"mediaFiles">, assetId: v1.assetId });
    expect(v2.version).toBe(2);
    const restored = await who.mutation(api.mediaLibrary.restoreVersion, { versionId: v1.versionId });
    expect(restored.version).toBe(3);

    const d = await who.query(api.mediaLibrary.detail, { assetId: v1.assetId });
    expect(d.versions.map((x) => x.version)).toEqual([3, 2, 1]);
    expect(d.versions[0]).toMatchObject({ restoredFrom: 1, approval: "pending" });
    expect(d.versions[0].mediaId).toBe(a.mediaId);
    expect(d.asset).toMatchObject({ currentVersion: 3, versionCount: 3, totalBytes: 7_000_000, tags: ["client-approved", "wav"] });
    expect(d.events.map((e) => e.action).sort()).toEqual(["restore", "upload", "upload"]);
    // Bytes are counted once per stored file (restore adds none).
    const used = await who.query(api.mediaLibrary.storage, {});
    expect(used.usedBytes).toBe(7_000_000);

    // Same upload cannot become a second version.
    await expect(who.mutation(api.mediaLibrary.addVersion, { mediaId: a.mediaId as Id<"mediaFiles">, assetId: v1.assetId })).rejects.toThrow(/already a version/);
  });

  it("refuses an unfinished upload and another studio's upload", async () => {
    const who = ctx.as("u_growth");
    const pending = await who.mutation(api.mediaLibrary.prepareUpload, { fileName: "p.wav", mimeType: "audio/wav", size: 100 });
    await expect(who.mutation(api.mediaLibrary.addVersion, { mediaId: pending.mediaId as Id<"mediaFiles">, name: "x", kind: "mix" })).rejects.toThrow(/not finished/);
    const other = ctx.as("u_growth2");
    const theirs = await upload(ctx.t, other, api.mediaLibrary.prepareUpload, 100);
    await expect(who.mutation(api.mediaLibrary.addVersion, { mediaId: theirs.mediaId as Id<"mediaFiles">, name: "x", kind: "mix" })).rejects.toThrow(/Upload not found/);
  });

  it("notes, client approval and the who/when trail", async () => {
    const who = ctx.as("u_growth");
    const a = await upload(ctx.t, who, api.mediaLibrary.prepareUpload);
    const v1 = await who.mutation(api.mediaLibrary.addVersion, { mediaId: a.mediaId as Id<"mediaFiles">, name: "Mix A", kind: "mix" });
    await who.mutation(api.mediaLibrary.addNote, { versionId: v1.versionId, body: "  Vocals up 1 dB  " });
    await who.mutation(api.mediaLibrary.setApproval, { versionId: v1.versionId, state: "changes_requested", note: "More low end", approvedBy: "Dana (label)" });
    let d = await who.query(api.mediaLibrary.detail, { assetId: v1.assetId });
    expect(d.versions[0].notes.map((n) => n.body)).toEqual(["Vocals up 1 dB"]);
    expect(d.versions[0]).toMatchObject({ approval: "changes_requested", approvedBy: "Dana (label)", approvalNote: "More low end" });
    expect(d.versions[0].approvedAt).toBeGreaterThan(0);
    await who.mutation(api.mediaLibrary.setApproval, { versionId: v1.versionId, state: "approved" });
    d = await who.query(api.mediaLibrary.detail, { assetId: v1.assetId });
    expect(d.versions[0].approval).toBe("approved");
    expect(d.events.map((e) => e.action)).toEqual(expect.arrayContaining(["upload", "note", "changes_requested", "approved"]));
    await expect(who.mutation(api.mediaLibrary.addNote, { versionId: v1.versionId, body: "   " })).rejects.toThrow(/Write a note/);
  });

  it("searches by name, kind, tag, song and session", async () => {
    const who = ctx.as("u_growth");
    const ids = await ctx.t.run(async (c) => {
      const artistId = await c.db.insert("artists", { orgId: "studio_growth", name: "A", type: "artist", genres: [], tags: [], status: "active", reliability: "solid", sessionCount: 0, lifetimeValueCents: 0 });
      const songId = await c.db.insert("songs", { orgId: "studio_growth", title: "Midnight Drive", artistId, kind: "single", stage: "mixing", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 });
      const sessionId = await c.db.insert("sessions", { orgId: "studio_growth", title: "Vocal day", artistId, songId, serviceType: "recording", startTime: 1, endTime: 2, status: "confirmed", rateCents: 0, depositCents: 0, depositPaid: false, intakeCompleted: false });
      return { songId, sessionId };
    });
    const mk = async (name: string, kind: "stem" | "artwork" | "master", extra: Record<string, unknown> = {}) => {
      const p = await upload(ctx.t, who, api.mediaLibrary.prepareUpload, 1000);
      return await who.mutation(api.mediaLibrary.addVersion, { mediaId: p.mediaId as Id<"mediaFiles">, name, kind, ...extra });
    };
    await mk("Drum stems", "stem", { songId: ids.songId, tags: ["drums"] });
    await mk("Cover art", "artwork", { tags: ["cover"] });
    await mk("Vocal comp", "stem", { sessionId: ids.sessionId });
    const names = async (args: Record<string, unknown>) => (await who.query(api.mediaLibrary.search, args)).map((r) => r.name).sort();
    expect(await names({ q: "drum" })).toEqual(["Drum stems"]);
    expect(await names({ q: "midnight" })).toEqual(["Drum stems"]); // by song title
    expect(await names({ q: "vocal day" })).toEqual(["Vocal comp"]); // by session title
    expect(await names({ kind: "artwork" })).toEqual(["Cover art"]);
    expect(await names({ tag: "drums" })).toEqual(["Drum stems"]);
    expect(await names({ songId: ids.songId })).toEqual(["Drum stems"]);
    expect(await names({ sessionId: ids.sessionId })).toEqual(["Vocal comp"]);
    expect(await names({})).toEqual(["Cover art", "Drum stems", "Vocal comp"]);
  });

  it("a studio cannot see, read or change another studio's files", async () => {
    const a = ctx.as("u_growth");
    const b = ctx.as("u_growth2");
    const p = await upload(ctx.t, a, api.mediaLibrary.prepareUpload);
    const v1 = await a.mutation(api.mediaLibrary.addVersion, { mediaId: p.mediaId as Id<"mediaFiles">, name: "Secret mix", kind: "mix" });
    expect(await b.query(api.mediaLibrary.search, { q: "secret" })).toEqual([]);
    expect(await b.query(api.mediaLibrary.search, {})).toEqual([]);
    await expect(b.query(api.mediaLibrary.detail, { assetId: v1.assetId })).rejects.toThrow(/not found/i);
    await expect(b.query(api.mediaLibrary.downloadUrl, { versionId: v1.versionId })).rejects.toThrow(/not found/i);
    await expect(b.mutation(api.mediaLibrary.restoreVersion, { versionId: v1.versionId })).rejects.toThrow(/not found/i);
    await expect(b.mutation(api.mediaLibrary.setApproval, { versionId: v1.versionId, state: "approved" })).rejects.toThrow(/not found/i);
    await expect(b.mutation(api.mediaLibrary.deleteAsset, { assetId: v1.assetId })).rejects.toThrow(/not found/i);
    // The owner gets a signed URL from its own bucket.
    const dl = await a.query(api.mediaLibrary.downloadUrl, { versionId: v1.versionId });
    expect(dl.url).toContain(orgBucketNames("studio_growth", "studio-growth").private);
    expect(dl.url).toContain("X-Amz-Signature");
  });

  it("deleting a file frees its bytes", async () => {
    const who = ctx.as("u_growth");
    const p = await upload(ctx.t, who, api.mediaLibrary.prepareUpload, 2_000_000);
    const v1 = await who.mutation(api.mediaLibrary.addVersion, { mediaId: p.mediaId as Id<"mediaFiles">, name: "Temp", kind: "other" });
    expect((await who.query(api.mediaLibrary.storage, {})).usedBytes).toBe(2_000_000);
    await who.mutation(api.mediaLibrary.deleteAsset, { assetId: v1.assetId });
    expect((await who.query(api.mediaLibrary.storage, {})).usedBytes).toBe(0);
    expect(await who.query(api.mediaLibrary.search, {})).toEqual([]);
  });
});

describe("storage allowance steps up by tier", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { env(); ctx = await setup(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("config: Core 10 GB, Growth 100 GB, Max 1,000 GB", () => {
    expect([ALLOWANCES.core.storageGb, ALLOWANCES.growth.storageGb, ALLOWANCES.max.storageGb]).toEqual([10, 100, 1000]);
  });

  async function song(orgId: string) {
    return await ctx.t.run(async (c) => {
      const artistId = await c.db.insert("artists", { orgId, name: "A", type: "artist", genres: [], tags: [], status: "active", reliability: "solid", sessionCount: 0, lifetimeValueCents: 0 });
      return await c.db.insert("songs", { orgId, title: "Song", artistId, kind: "single", stage: "mixing", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 });
    });
  }

  async function used(orgId: string, bytes: number) {
    await ctx.t.run(async (c) => {
      await c.db.insert("usageCounters", { orgId, period: "all", metric: "storage_bytes", value: bytes, updatedAt: Date.now() });
    });
  }

  it("Core: a mix that would pass 10 GB is refused and rolled back", async () => {
    const who = ctx.as("u_core");
    const songId = await song("studio_core");
    await used("studio_core", 9.5 * GB);
    const a = await upload(ctx.t, who, api.finishedMixes.prepareUpload, 1 * GB);
    await expect(who.mutation(api.finishedMixes.addVersion, { songId, kind: "mix", label: "Mix 1", mediaId: a.mediaId as Id<"mediaFiles"> })).rejects.toMatchObject({ data: { code: "LIMIT_REACHED", metric: "storage_bytes", cap: 10 * GB } });
    expect(await who.query(api.finishedMixes.list, {})).toEqual([]);
    // Under the cap it goes through.
    const small = await upload(ctx.t, who, api.finishedMixes.prepareUpload, 0.25 * GB);
    expect((await who.mutation(api.finishedMixes.addVersion, { songId, kind: "mix", label: "Mix 1", mediaId: small.mediaId as Id<"mediaFiles"> })).version).toBe(1);
  });

  it("Growth: the same 9.5 GB of use leaves room on 100 GB; an upload past the cap is blocked before any bytes move", async () => {
    const who = ctx.as("u_growth");
    await used("studio_growth", 9.5 * GB);
    const a = await upload(ctx.t, who, api.mediaLibrary.prepareUpload, 1 * GB);
    const v1 = await who.mutation(api.mediaLibrary.addVersion, { mediaId: a.mediaId as Id<"mediaFiles">, name: "Session", kind: "session" });
    expect(v1.version).toBe(1);
    expect((await who.query(api.mediaLibrary.storage, {})).capBytes).toBe(100 * GB);
    await used("studio_growth2", 99.5 * GB);
    await expect(ctx.as("u_growth2").mutation(api.mediaLibrary.prepareUpload, { fileName: "big.wav", mimeType: "audio/wav", size: 1 * GB })).rejects.toMatchObject({ data: { code: "LIMIT_REACHED" } });
  });
});

describe("expiring guest links", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { env(); ctx = await setup(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  async function shared() {
    const who = ctx.as("u_growth");
    const p = await upload(ctx.t, who, api.mediaLibrary.prepareUpload);
    const v1 = await who.mutation(api.mediaLibrary.addVersion, { mediaId: p.mediaId as Id<"mediaFiles">, name: "Radio edit", kind: "mix" });
    return { who, ...v1 };
  }

  it("a guest sees the file and approves a version, then the link expires", async () => {
    const { who, assetId, versionId } = await shared();
    const link = await who.mutation(api.mediaLibrary.issueGuestLink, { assetId, email: "Client@Label.com", name: "Dana", ttlMs: 60 * 60 * 1000 });
    const grant = await ctx.t.run(async (c) => await c.db.get(link.grantId));
    expect(grant).toMatchObject({ scope: "deliverable", entityId: assetId, orgId: "studio_growth", email: "client@label.com" });

    const view = await ctx.t.query(api.mediaLibrary.guestAsset, { token: link.token });
    expect(view).toMatchObject({ name: "Radio edit", canApprove: true });
    expect(view!.versions[0].url).toContain("X-Amz-Signature");
    await ctx.t.mutation(api.mediaLibrary.guestSetApproval, { token: link.token, versionId, state: "approved", note: "Love it" });
    const d = await who.query(api.mediaLibrary.detail, { assetId });
    expect(d.versions[0]).toMatchObject({ approval: "approved", approvedBy: "Dana", approvalNote: "Love it" });
    expect((await who.query(api.mediaLibrary.guestLinks, { assetId }))[0]).toMatchObject({ expired: false, revoked: false });

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    expect(await ctx.t.query(api.mediaLibrary.guestAsset, { token: link.token })).toBeNull();
    await expect(ctx.t.mutation(api.mediaLibrary.guestSetApproval, { token: link.token, versionId, state: "changes_requested" })).rejects.toThrow(/expired/);
  });

  it("a revoked link stops working, a view-only link cannot approve, and a link never reaches another file", async () => {
    const { who, assetId, versionId } = await shared();
    const viewOnly = await who.mutation(api.mediaLibrary.issueGuestLink, { assetId, email: "a@b.com", name: "A", canApprove: false });
    await expect(ctx.t.mutation(api.mediaLibrary.guestSetApproval, { token: viewOnly.token, versionId, state: "approved" })).rejects.toThrow(/not approve/);
    await who.mutation(api.grants.revoke, { grantId: viewOnly.grantId });
    expect(await ctx.t.query(api.mediaLibrary.guestAsset, { token: viewOnly.token })).toBeNull();

    // A link for one file cannot approve a version of another.
    const p2 = await upload(ctx.t, who, api.mediaLibrary.prepareUpload);
    const other = await who.mutation(api.mediaLibrary.addVersion, { mediaId: p2.mediaId as Id<"mediaFiles">, name: "Other", kind: "mix" });
    const link = await who.mutation(api.mediaLibrary.issueGuestLink, { assetId, email: "a@b.com", name: "A" });
    await expect(ctx.t.mutation(api.mediaLibrary.guestSetApproval, { token: link.token, versionId: other.versionId, state: "approved" })).rejects.toThrow(/Version not found/);
  });

  it("links count against the monthly allowance and the ttl is capped at 30 days", async () => {
    const { who, assetId } = await shared();
    const link = await who.mutation(api.mediaLibrary.issueGuestLink, { assetId, email: "a@b.com", name: "A", ttlMs: 400 * 24 * 60 * 60 * 1000 });
    expect(link.expiresAt - Date.now()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 5000);
    const used = await ctx.t.run(async (c) => (await c.db.query("usageCounters").collect()).filter((u) => u.orgId === "studio_growth" && u.metric === "magic_links"));
    expect(used[0].value).toBe(1);
    // A different studio cannot issue a link for this file.
    await expect(ctx.as("u_growth2").mutation(api.mediaLibrary.issueGuestLink, { assetId, email: "x@y.com", name: "X" })).rejects.toThrow(/not found/i);
    // Core has no library, so no library links.
    await expect(ctx.as("u_core").mutation(api.mediaLibrary.issueGuestLink, { assetId, email: "x@y.com", name: "X" })).rejects.toMatchObject({ data: { code: "UPGRADE_REQUIRED" } });
  });
});

describe("Max: library shared across studios, only inside the agency group", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { env(); ctx = await setup(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function put(user: string, name: string) {
    const who = ctx.as(user);
    const p = await upload(ctx.t, who, api.mediaLibrary.prepareUpload, 1000);
    return await who.mutation(api.mediaLibrary.addVersion, { mediaId: p.mediaId as Id<"mediaFiles">, name, kind: "master" });
  }

  it("a Max studio sees sibling studios' files in the same group and nobody else's", async () => {
    await put("u_max_a", "A master");
    const b = await put("u_max_b", "B master");
    await put("u_max_c", "C master (other agency)");
    await put("u_gx", "Growth sibling master");
    await put("u_growth", "No agency master");

    const a = ctx.as("u_max_a");
    const rows = await a.query(api.mediaLibrary.sharedSearch, {});
    expect(rows.map((r) => r.name).sort()).toEqual(["A master", "B master"]);
    expect(rows.find((r) => r.name === "B master")).toMatchObject({ studioName: "studio_max_b", isThisStudio: false });
    expect((await a.query(api.mediaLibrary.sharedStudios, {})).map((s) => s.orgId).sort()).toEqual(["studio_max_a", "studio_max_b"]);

    // Narrowing to one studio never widens the group.
    expect((await a.query(api.mediaLibrary.sharedSearch, { studioOrgId: "studio_max_c" })).length).toBe(0);
    expect((await a.query(api.mediaLibrary.sharedSearch, { studioOrgId: "studio_max_b" })).map((r) => r.name)).toEqual(["B master"]);

    // Read and download work inside the group, with the sibling's own bucket in the URL.
    const dl = await a.query(api.mediaLibrary.sharedDownloadUrl, { versionId: b.versionId });
    expect(dl.url).toContain(orgBucketNames("studio_max_b", "studio-max-b").private);
    expect((await a.query(api.mediaLibrary.sharedDetail, { assetId: b.assetId })).versions).toHaveLength(1);

    // The other agency's Max studio cannot reach B's file, by search or by id.
    const c = ctx.as("u_max_c");
    expect((await c.query(api.mediaLibrary.sharedSearch, {})).map((r) => r.name)).toEqual(["C master (other agency)"]);
    await expect(c.query(api.mediaLibrary.sharedDownloadUrl, { versionId: b.versionId })).rejects.toThrow(/not found/i);
    await expect(c.query(api.mediaLibrary.sharedDetail, { assetId: b.assetId })).rejects.toThrow(/not found/i);

    // The shared view is read-only: a sibling cannot change B's file.
    await expect(a.mutation(api.mediaLibrary.setApproval, { versionId: b.versionId, state: "approved" })).rejects.toThrow(/not found/i);
  });

  it("a Max studio with no agency sees only itself", async () => {
    await ctx.t.run(async (c) => {
      await c.db.insert("orgs", { orgId: "studio_solo_max", name: "Solo", slug: "solo", tier: "max", status: "active" });
      await c.db.insert("members", { orgId: "studio_solo_max", name: "S", role: "owner", skills: [], clerkUserId: "u_solo" });
    });
    await put("u_max_a", "A master");
    expect(await ctx.as("u_solo").query(api.mediaLibrary.sharedSearch, {})).toEqual([]);
  });
});

describe("Core finished mixes", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { env(); ctx = await setup(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("adds numbered mix versions, keeps notes per version, approves through the existing status call, and hides non-mix files", async () => {
    const core = ctx.as("u_core");
    const songId = await ctx.t.run(async (c) => {
      const artistId = await c.db.insert("artists", { orgId: "studio_core", name: "A", type: "artist", genres: [], tags: [], status: "active", reliability: "solid", sessionCount: 0, lifetimeValueCents: 0 });
      const id = await c.db.insert("songs", { orgId: "studio_core", title: "Blue Hour", artistId, kind: "single", stage: "mixing", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 });
      await c.db.insert("deliverables", { orgId: "studio_core", songId: id, kind: "stems", version: 1, label: "Stems", status: "delivered", paymentGated: false });
      return id;
    });
    expect((await core.query(api.finishedMixes.songChoices, {})).map((s) => s.title)).toEqual(["Blue Hour"]);
    const p1 = await upload(ctx.t, core, api.finishedMixes.prepareUpload);
    // The Growth-only stems row is numbered in the same song, so the first mix is version 2.
    const m1 = await core.mutation(api.finishedMixes.addVersion, { songId, kind: "mix", label: "Mix 1", mediaId: p1.mediaId as Id<"mediaFiles">, note: "Rough balance" });
    const p2 = await upload(ctx.t, core, api.finishedMixes.prepareUpload);
    const m2 = await core.mutation(api.finishedMixes.addVersion, { songId, kind: "mix", label: "Mix 2", mediaId: p2.mediaId as Id<"mediaFiles"> });
    expect(m2.version).toBe(m1.version + 1);

    await core.mutation(api.finishedMixes.addNote, { deliverableId: m2.deliverableId, body: "Snare is louder" });
    expect((await core.query(api.finishedMixes.notes, { deliverableId: m1.deliverableId })).map((n) => n.body)).toEqual(["Rough balance"]);
    expect((await core.query(api.finishedMixes.notes, { deliverableId: m2.deliverableId })).map((n) => n.body)).toEqual(["Snare is louder"]);

    await core.mutation(api.deliverables.setStatus, { id: m2.deliverableId, status: "approved", approvedBy: "Dana" });
    const list = await core.query(api.finishedMixes.list, {});
    expect(list).toHaveLength(1);
    expect(list[0].songTitle).toBe("Blue Hour");
    expect(list[0].versions.map((v) => [v.version, v.kind, v.status, v.noteCount])).toEqual([[m2.version, "mix", "approved", 1], [m1.version, "mix", "delivered", 1]]);
    const dl = await core.query(api.files.downloadUrl, { deliverableId: m2.deliverableId });
    expect(dl.url).toContain(orgBucketNames("studio_core", "studio-core").private);
  });

  it("is studio-isolated", async () => {
    const core = ctx.as("u_core");
    const theirs = await ctx.t.run(async (c) => {
      const artistId = await c.db.insert("artists", { orgId: "studio_growth", name: "A", type: "artist", genres: [], tags: [], status: "active", reliability: "solid", sessionCount: 0, lifetimeValueCents: 0 });
      const songId = await c.db.insert("songs", { orgId: "studio_growth", title: "Theirs", artistId, kind: "single", stage: "mixing", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 });
      const deliverableId = await c.db.insert("deliverables", { orgId: "studio_growth", songId, kind: "mix", version: 1, label: "Mix", status: "delivered", paymentGated: false });
      return { songId, deliverableId };
    });
    expect(await core.query(api.finishedMixes.list, {})).toEqual([]);
    await expect(core.query(api.finishedMixes.notes, { deliverableId: theirs.deliverableId })).rejects.toThrow(/not found/i);
    await expect(core.mutation(api.finishedMixes.addNote, { deliverableId: theirs.deliverableId, body: "x" })).rejects.toThrow(/not found/i);
    const p = await upload(ctx.t, core, api.finishedMixes.prepareUpload);
    await expect(core.mutation(api.finishedMixes.addVersion, { songId: theirs.songId, kind: "mix", label: "x", mediaId: p.mediaId as Id<"mediaFiles"> })).rejects.toThrow(/Song not found/);
  });
});
