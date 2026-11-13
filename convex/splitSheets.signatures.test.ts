import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isReleasable } from "./lib/guardrails";
import { buildRightsPacket } from "./rightsExport";
import { allocateSongLines } from "./lib/royaltyAllocate";

/* H5: a split sheet is signed only when people signed it.
   Each test names the eval.md check it proves (specs/features/truth-split-signatures). */

const make = () => convexTest(schema);
type T = ReturnType<typeof make>;
type As = (user: string, orgId?: string) => ReturnType<T["withIdentity"]>;

async function setup() {
  const t = make();
  const ids = await t.run(async (ctx) => {
    for (const [orgId, owner] of [["o1", "u_owner"], ["o2", "u_other"]] as const) {
      await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "max", status: "active" });
      await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", skills: [], clerkUserId: owner });
    }
    await ctx.db.insert("members", { orgId: "o1", name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng" });
    await ctx.db.insert("members", { orgId: "o1", name: "Mgr", role: "manager", skills: [], clerkUserId: "u_mgr" });
    const artistId = await ctx.db.insert("artists", {
      orgId: "o1", name: "Nova", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const songId = await ctx.db.insert("songs", {
      orgId: "o1", title: "Skyline", artistId, kind: "single", stage: "mastering", isrc: "USABC2400001", iswc: "T1234567890",
      moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
    });
    return { songId };
  });
  const as: As = (user: string, orgId = "o1") => t.withIdentity({ subject: user, name: user, orgId });
  return { t, as, ...ids };
}

const two = (aPct = 50) => [
  { name: "Alice", role: "Songwriter", masterPct: aPct, publishingPct: aPct, email: "alice@x.com", signed: false },
  { name: "Bob", role: "Producer", masterPct: 100 - aPct, publishingPct: 100 - aPct, email: "bob@x.com", signed: false },
];

async function sheetOf(t: T, songId: Id<"songs">) {
  return t.run(async (ctx) => (await ctx.db.query("splitSheets").withIndex("by_song", (q) => q.eq("songId", songId)).first())!);
}

/** Issue links and sign as the named people, through the real public flow. */
async function signAs(t: T, as: As, sheetId: Id<"splitSheets">, emails: string[]) {
  const links = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
  for (const email of emails) {
    const link = links.find((l) => l.email === email)!;
    await t.mutation(api.splitSignatures.sign, { token: link.token, signature: link.name, signatureKind: "typed", signatureFont: "caveat", userAgent: "UA/1" });
  }
}

async function seedLine(t: T, songId: Id<"songs">, amountCents = 1000) {
  return t.run(async (ctx) => {
    const fileId = await ctx.db.insert("mediaFiles", {
      orgId: "o1", bucket: "private", bucketName: "b", key: "k/1", purpose: "royalty_statement",
      fileName: "dk.tsv", mimeType: "text/tab-separated-values", status: "ready", uploadedBy: "u_owner", createdAt: 0,
    });
    const statementId = await ctx.db.insert("royaltyStatements", {
      orgId: "o1", source: "distrokid", fileId, fileName: "dk.tsv", fileHash: "h", status: "ready",
      totals: [{ currency: "USD", cents: amountCents }], rowCount: 1, lineCount: 1, uploadedBy: "u_owner", createdAt: 0,
    });
    return ctx.db.insert("royaltyLines", {
      orgId: "o1", statementId, isrc: "USABC2400001", currency: "USD", amountCents, units: 1, rows: 1, songId, state: "unallocated",
    });
  });
}

const shares = (t: T) => t.run((ctx) => ctx.db.query("royaltyShares").collect());
const activity = (t: T, kind: string) => t.run(async (ctx) => (await ctx.db.query("activity").collect()).filter((a) => a.kind === kind));

describe("H5 split sheet signatures", () => {
  let t: T;
  let as: As;
  let songId: Id<"songs">;
  beforeEach(async () => {
    vi.useFakeTimers();
    ({ t, as, songId } = await setup());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("U-01: the browser cannot set signed: true, on a new sheet or an existing one", async () => {
    const forged = two().map((c) => ({ ...c, signed: true }));
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: forged });
    let sheet = await sheetOf(t, songId);
    expect(sheet.contributors.map((c) => c.signed)).toEqual([false, false]);
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: forged });
    sheet = await sheetOf(t, songId);
    expect(sheet.contributors.map((c) => c.signed)).toEqual([false, false]);
    expect(sheet.contributors.every((c) => c.signedAt === undefined)).toBe(true);
    const view = await as("u_owner").query(api.splitSheets.forSong, { songId });
    expect(view!.allSigned).toBe(false);
  });

  it("U-02: a re-save (adding an IPI) keeps the signature record exactly", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await signAs(t, as, sheetId, ["alice@x.com"]);
    const before = (await sheetOf(t, songId)).contributors[0];
    expect(before.signedAt).toBeTypeOf("number");

    // The browser's copy has no signature fields at all.
    const edited = two().map((c, i) => ({ ...c, ipi: i === 0 ? "00012345678" : undefined, pro: "BMI", fromIndex: i }));
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: edited });
    const after = await sheetOf(t, songId);
    const alice = after.contributors[0];
    expect(alice.ipi).toBe("00012345678");
    expect(alice).toMatchObject({
      signed: true, signedAt: before.signedAt, signature: before.signature,
      signatureKind: "typed", signatureFont: "caveat", signedFromUa: "UA/1",
    });
    expect(after.status).toBe("sent");
    expect(await activity(t, "split.reopened")).toHaveLength(0);
  });

  it("U-03: changing a signed person's share clears the signatures, reopens the sheet, logs it and keeps the evidence", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await signAs(t, as, sheetId, ["alice@x.com", "bob@x.com"]);
    expect((await sheetOf(t, songId)).status).toBe("fully_executed");
    const signedAlice = (await sheetOf(t, songId)).contributors[0];

    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two(60).map((c, i) => ({ ...c, fromIndex: i })) });
    const sheet = await sheetOf(t, songId);
    expect(sheet.status).toBe("sent");
    expect(sheet.contributors.every((c) => !c.signed && c.signedAt === undefined && c.signature === undefined)).toBe(true);
    const reopened = await activity(t, "split.reopened");
    expect(reopened).toHaveLength(1);
    expect(reopened[0].summary).toContain("Before: Alice 50/50, Bob 50/50");
    expect(reopened[0].summary).toContain("After: Alice 60/60, Bob 40/40");
    const history = await t.run((ctx) => ctx.db.query("splitSignatureHistory").withIndex("by_sheet", (q) => q.eq("splitSheetId", sheetId)).collect());
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      name: "Alice", masterPct: 50, signedByPerson: true, signedAt: signedAlice.signedAt,
      signature: signedAlice.signature, signatureKind: "typed", signedFromUa: "UA/1", reason: "terms_changed", orgId: "o1",
    });

    // The cleared people can be sent new links and sign the new terms.
    const links = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
    expect(links.map((l) => l.email).sort()).toEqual(["alice@x.com", "bob@x.com"]);
  });

  it("U-03: a name change or a removed contributor also clears signatures; a draft with nobody signed stays a draft", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    // Nobody signed yet: an edit is just an edit.
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two(70) });
    expect((await sheetOf(t, songId)).status).toBe("draft");
    expect(await activity(t, "split.reopened")).toHaveLength(0);

    const sheetId = (await sheetOf(t, songId))._id;
    await signAs(t, as, sheetId, ["alice@x.com"]);
    const renamed = two(70).map((c, i) => ({ ...c, name: i === 0 ? "Alice Smith" : c.name, fromIndex: i }));
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: renamed });
    expect((await sheetOf(t, songId)).contributors[0].signedAt).toBeUndefined();

    await signAs(t, as, sheetId, ["alice@x.com"]);
    await as("u_owner").mutation(api.splitSheets.upsert, {
      songId,
      contributors: [{ name: "Alice Smith", role: "Songwriter", masterPct: 100, publishingPct: 100, email: "alice@x.com", fromIndex: 0 }],
    });
    expect((await sheetOf(t, songId)).contributors[0].signedAt).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("splitSignatureHistory").collect())).toHaveLength(2);
  });

  it("U-04: fixing a PRO or IPI does not clear a signature; an email change clears only that person's (owner only)", async () => {
    // Changed in round 2 (H209-01, owner decision): the old version asserted
    // an email change on a signed row kept the signature. Royalty shares
    // follow the email, so the person at a new address must sign again.
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await signAs(t, as, sheetId, ["alice@x.com", "bob@x.com"]);
    const signed = await sheetOf(t, songId);
    expect(signed.status).toBe("fully_executed");

    // PRO and IPI fixes keep every signature and the status.
    await as("u_owner").mutation(api.splitSheets.upsert, {
      songId, contributors: two().map((c, i) => ({ ...c, fromIndex: i, pro: "ASCAP", ipi: "123" })),
    });
    let sheet = await sheetOf(t, songId);
    expect(sheet.status).toBe("fully_executed");
    expect(sheet.contributors.map((c) => c.signedAt)).toEqual(signed.contributors.map((c) => c.signedAt));

    // The owner changes Alice's email (and only re-cases Bob's).
    const fixed = two().map((c, i) => ({
      ...c, fromIndex: i, email: i === 0 ? "alice.new@x.com" : "BOB@x.com", pro: "ASCAP", ipi: "123",
    }));
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: fixed });
    sheet = await sheetOf(t, songId);
    expect(sheet.contributors[0]).toMatchObject({ email: "alice.new@x.com", signed: false });
    expect(sheet.contributors[0].signedAt).toBeUndefined();
    expect(sheet.contributors[0].signature).toBeUndefined();
    expect(sheet.contributors[1]).toMatchObject({ signed: true, signedAt: signed.contributors[1].signedAt });
    expect(sheet.status).toBe("sent");
    const view = await as("u_owner").query(api.splitSheets.forSong, { songId });
    expect(view!.allSigned).toBe(false);
    expect(view!.displayStatus).toBe("sent");
    const emailLog = await activity(t, "split.signer_email_changed");
    expect(emailLog).toHaveLength(1);
    expect(emailLog[0].summary).toContain("Alice alice@x.com -> alice.new@x.com");
    expect(emailLog[0].summary).not.toContain("BOB@x.com");
    const history = await t.run((ctx) => ctx.db.query("splitSignatureHistory").collect());
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ name: "Alice", email: "alice@x.com", signedByPerson: true, reason: "email_changed" });

    // Only the new address gets a link.
    const links = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
    expect(links.map((l) => l.email)).toEqual(["alice.new@x.com"]);
  });

  it("H209-01: a non-owner cannot change a signed sheet's emails or shares, and royalties never follow an unsigned address", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await signAs(t, as, sheetId, ["alice@x.com", "bob@x.com"]);
    const before = await sheetOf(t, songId);
    expect(before.status).toBe("fully_executed");

    const redirect = two().map((c, i) => ({ ...c, fromIndex: i, email: i === 0 ? "producer@x.com" : c.email }));
    await expect(
      as("u_mgr").mutation(api.splitSheets.upsert, { songId, contributors: redirect }),
    ).rejects.toMatchObject({ data: { code: "CAPABILITY_DENIED" } });
    await expect(
      as("u_mgr").mutation(api.splitSheets.upsert, { songId, contributors: two(60).map((c, i) => ({ ...c, fromIndex: i })) }),
    ).rejects.toMatchObject({ data: { code: "CAPABILITY_DENIED" } });
    // Adding someone changes who is paid, so it is a share change too.
    await expect(
      as("u_mgr").mutation(api.splitSheets.upsert, {
        songId,
        contributors: [...two().map((c, i) => ({ ...c, fromIndex: i })), { name: "Zed", role: "Writer", masterPct: 0, publishingPct: 0, email: "z@x.com" }],
      }),
    ).rejects.toMatchObject({ data: { code: "CAPABILITY_DENIED" } });
    expect(await sheetOf(t, songId)).toEqual(before);

    // A manager may still fix a PRO or IPI.
    await as("u_mgr").mutation(api.splitSheets.upsert, {
      songId, contributors: two().map((c, i) => ({ ...c, fromIndex: i, ipi: "999" })),
    });
    expect((await sheetOf(t, songId)).status).toBe("fully_executed");

    // The owner's change reopens the sheet; a new statement line is held, not
    // credited to the new address under Alice's old signature.
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: redirect });
    expect((await sheetOf(t, songId)).status).toBe("sent");
    const lineId = await seedLine(t, songId);
    await t.run(async (ctx) => { await allocateSongLines(ctx, "o1", songId); });
    expect((await t.run((ctx) => ctx.db.get(lineId)))!.state).toBe("unallocated");
    expect((await shares(t)).filter((s) => s.lineId === lineId)).toHaveLength(0);
  });

  it("H209-01: before anyone signs, a manager can still change emails and shares", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    await as("u_mgr").mutation(api.splitSheets.upsert, {
      songId, contributors: two(70).map((c, i) => ({ ...c, fromIndex: i, email: i === 0 ? "a2@x.com" : c.email })),
    });
    const sheet = await sheetOf(t, songId);
    expect(sheet.contributors[0]).toMatchObject({ email: "a2@x.com", masterPct: 70 });
    expect(sheet.status).toBe("draft");
  });

  it("H209-01: an email change on a sheet the owner marked signed reopens it", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "Paper copy in the safe" });
    const redirect = two().map((c, i) => ({ ...c, fromIndex: i, email: i === 0 ? "new@x.com" : c.email }));
    await expect(as("u_mgr").mutation(api.splitSheets.upsert, { songId, contributors: redirect })).rejects.toMatchObject({
      data: { code: "CAPABILITY_DENIED" },
    });
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: redirect });
    expect((await sheetOf(t, songId)).status).toBe("sent");
  });

  it("H209-01: an unused signing link for an address that left the sheet is revoked", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    const links = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
    const bobOld = links.find((l) => l.email === "bob@x.com")!;
    await as("u_owner").mutation(api.splitSheets.upsert, {
      songId, contributors: two().map((c, i) => ({ ...c, fromIndex: i, email: i === 1 ? "bob2@x.com" : c.email })),
    });
    const grants = await t.run(async (ctx) => (await ctx.db.query("collaboratorGrants").collect()).filter((g) => !g.revoked));
    expect(grants.map((g) => g.email)).toEqual(["alice@x.com"]);
    // Even if the old address comes back on another row, the old link is dead.
    await as("u_owner").mutation(api.splitSheets.upsert, {
      songId, contributors: two().map((c, i) => ({ ...c, fromIndex: i, email: i === 1 ? "bob@x.com" : c.email })),
    });
    await expect(t.mutation(api.splitSignatures.sign, { token: bobOld.token, signature: "Bob" })).rejects.toThrow(/no longer valid/);
  });

  it("H209-02: a legacy executed sheet with a hand tick can be re-saved (an IPI fix) and keeps its status and royalties", async () => {
    const lineId = await seedLine(t, songId);
    const sheetId = await t.run((ctx) => ctx.db.insert("splitSheets", {
      orgId: "o1", songId, status: "fully_executed", updatedAt: 0,
      contributors: [
        { name: "Ticked", role: "Writer", masterPct: 50, publishingPct: 50, email: "tick@x.com", signed: true },
        { name: "Real", role: "Writer", masterPct: 50, publishingPct: 50, email: "real@x.com", signed: true, signedAt: 5, signature: "Real" },
      ],
    }));
    const rows = [
      { name: "Ticked", role: "Writer", masterPct: 50, publishingPct: 50, email: "tick@x.com", ipi: "111", fromIndex: 0 },
      { name: "Real", role: "Writer", masterPct: 50, publishingPct: 50, email: "real@x.com", fromIndex: 1 },
    ];
    await as("u_mgr").mutation(api.splitSheets.upsert, { songId, contributors: rows });
    const sheet = await sheetOf(t, songId);
    expect(sheet.status).toBe("fully_executed");
    expect(sheet.contributors[0]).toMatchObject({ ipi: "111", signed: true });
    expect(sheet.contributors[1]).toMatchObject({ signedAt: 5, signature: "Real" });
    // Still shown as marked by the studio, never as signed by everyone.
    const view = await as("u_owner").query(api.splitSheets.forSong, { songId });
    expect(view!.displayStatus).toBe("marked_by_studio");
    // Royalties keep running for the sheet.
    expect((await shares(t)).filter((s) => s.lineId === lineId).length).toBeGreaterThan(0);
    // An explicit request to execute is still refused.
    await expect(
      as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: rows, status: "fully_executed" }),
    ).rejects.toMatchObject({ data: { code: "SPLIT_NOT_SIGNED" } });
    // The owner can relabel it with a note.
    await as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "Paper copy in the safe" });
    expect((await sheetOf(t, songId)).status).toBe("marked_by_studio");
  });

  it("U-05: setStatus(fully_executed) is refused while anyone has not signed, and allocates nothing", async () => {
    await seedLine(t, songId);
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await signAs(t, as, sheetId, ["alice@x.com"]);
    await expect(
      as("u_owner").mutation(api.splitSheets.setStatus, { id: sheetId, status: "fully_executed" }),
    ).rejects.toMatchObject({ data: { code: "SPLIT_NOT_SIGNED", names: ["Bob"] } });
    expect((await sheetOf(t, songId)).status).toBe("sent");
    expect(await shares(t)).toHaveLength(0);
  });

  it("U-05: a hand tick from before the fix does not count as a signature", async () => {
    await seedLine(t, songId);
    const sheetId = await t.run((ctx) => ctx.db.insert("splitSheets", {
      orgId: "o1", songId, status: "sent", updatedAt: 0,
      contributors: [
        { name: "Ticked", role: "Writer", masterPct: 50, publishingPct: 50, email: "tick@x.com", signed: true },
        { name: "Bob", role: "Producer", masterPct: 50, publishingPct: 50, email: "bob@x.com", signed: false },
      ],
    }));
    await expect(
      as("u_owner").mutation(api.splitSheets.setStatus, { id: sheetId, status: "fully_executed" }),
    ).rejects.toMatchObject({ data: { code: "SPLIT_NOT_SIGNED" } });
    // Bob signs by link: every row now says signed, but one is only a tick.
    await signAs(t, as, sheetId, ["bob@x.com"]);
    const sheet = await sheetOf(t, songId);
    expect(sheet.status).toBe("sent");
    expect(await shares(t)).toHaveLength(0);
    const view = await as("u_owner").query(api.splitSheets.forSong, { songId });
    expect(view!.contributors.map((c) => c.signedBy)).toEqual(["studio", "person"]);
    expect(view!.allSigned).toBe(false);
  });

  it("H209-03: a hand-ticked person gets a signing link, needs an email, and their real signature executes the sheet", async () => {
    await seedLine(t, songId);
    const sheetId = await t.run((ctx) => ctx.db.insert("splitSheets", {
      orgId: "o1", songId, status: "sent", updatedAt: 0,
      contributors: [
        { name: "Ticked", role: "Writer", masterPct: 50, publishingPct: 50, signed: true },
        { name: "Bob", role: "Producer", masterPct: 50, publishingPct: 50, email: "bob@x.com", signed: false },
      ],
    }));
    // The ticked row has no email: sending names them instead of skipping them.
    await expect(as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId })).rejects.toMatchObject({
      data: { code: "SPLIT_EMAIL_REQUIRED", names: ["Ticked"] },
    });
    expect((await as("u_owner").query(api.splitSheets.list, {}))[0].missingEmail).toBe(1);
    await t.run(async (ctx) => {
      const s = (await ctx.db.get(sheetId))!;
      await ctx.db.patch(sheetId, { contributors: s.contributors.map((c, i) => (i === 0 ? { ...c, email: "tick@x.com" } : c)) });
    });
    const links = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
    expect(links.map((l) => l.email).sort()).toEqual(["bob@x.com", "tick@x.com"]);
    await signAs(t, as, sheetId, ["tick@x.com", "bob@x.com"]);
    expect((await sheetOf(t, songId)).status).toBe("fully_executed");
    expect((await shares(t)).length).toBeGreaterThan(0);
  });

  it("U-06: upsert with status fully_executed is refused the same way, new or existing", async () => {
    await expect(
      as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two(), status: "fully_executed" }),
    ).rejects.toMatchObject({ data: { code: "SPLIT_NOT_SIGNED" } });
    expect(await t.run((ctx) => ctx.db.query("splitSheets").collect())).toHaveLength(0);
    await seedLine(t, songId);
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    await expect(
      as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two(), status: "fully_executed" }),
    ).rejects.toMatchObject({ data: { code: "SPLIT_NOT_SIGNED" } });
    expect((await sheetOf(t, songId)).status).toBe("draft");
    expect(await shares(t)).toHaveLength(0);
  });

  it("U-07: the last real signature executes the sheet and allocates royalties once", async () => {
    await seedLine(t, songId, 1001);
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await signAs(t, as, sheetId, ["alice@x.com"]);
    expect(await shares(t)).toHaveLength(0);
    await signAs(t, as, sheetId, ["bob@x.com"]);
    expect((await sheetOf(t, songId)).status).toBe("fully_executed");
    expect((await shares(t)).reduce((s, x) => s + x.amountCents, 0)).toBe(1001);
    expect(await shares(t)).toHaveLength(2);

    // A second execute, an identical re-save and a status re-click change nothing.
    await as("u_owner").mutation(api.splitSheets.setStatus, { id: sheetId, status: "fully_executed" });
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two().map((c, i) => ({ ...c, fromIndex: i })) });
    expect(await shares(t)).toHaveLength(2);
    expect(await activity(t, "split.executed")).toHaveLength(0);
    expect((await sheetOf(t, songId)).status).toBe("fully_executed");
  });

  it("U-08: only the owner can mark a sheet signed outside Pulse; it is logged, has its own status and lets royalties run", async () => {
    await seedLine(t, songId);
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    const note = "Paper sheet signed 3 May, scanned to the shared drive";

    for (const user of ["u_eng", "u_mgr"]) {
      await expect(
        as(user).mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note }),
      ).rejects.toThrow();
    }
    await expect(
      as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "  " }),
    ).rejects.toThrow(/where the signed copies are/);
    expect((await sheetOf(t, songId)).status).toBe("draft");
    expect(await shares(t)).toHaveLength(0);

    const res = await as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note });
    expect(res).toEqual({ alreadyMarked: false });
    const sheet = await sheetOf(t, songId);
    expect(sheet).toMatchObject({ status: "marked_by_studio", markedNote: note, markedByUserId: "u_owner" });
    expect(sheet.contributors.every((c) => !c.signed && c.signedAt === undefined)).toBe(true);
    expect(await shares(t)).toHaveLength(2);

    const audits = await t.run(async (ctx) => (await ctx.db.query("auditEvents").collect()).filter((a) => a.action === "splitsheet.mark_signed_outside"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ orgId: "o1", viewerId: "u_owner", resource: sheetId, result: "allow" });

    // Never shown as signed by the people.
    const view = await as("u_owner").query(api.splitSheets.forSong, { songId });
    expect(view!.displayStatus).toBe("marked_by_studio");
    expect(view!.allSigned).toBe(false);
    expect(view!.contributors.map((c) => [c.signed, c.signedBy])).toEqual([[false, "studio"], [false, "studio"]]);
    expect(view!.marked).toMatchObject({ note });
    const list = await as("u_owner").query(api.splitSheets.list, {});
    expect(list[0]).toMatchObject({ status: "marked_by_studio", signed: 0, total: 2 });

    // A double click does nothing more.
    expect(await as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note })).toEqual({ alreadyMarked: true });
    expect(await shares(t)).toHaveLength(2);

    // Real signatures still upgrade it to fully executed, with no second allocation.
    await signAs(t, as, sheetId, ["alice@x.com", "bob@x.com"]);
    expect((await sheetOf(t, songId)).status).toBe("fully_executed");
    expect(await shares(t)).toHaveLength(2);
    await expect(
      as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note }),
    ).rejects.toThrow(/already signed/);
  });

  it("U-08: changing the terms of a marked sheet reopens it", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "Paper copy in the safe" });
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two(30).map((c, i) => ({ ...c, fromIndex: i })) });
    expect((await sheetOf(t, songId)).status).toBe("sent");
    expect(await activity(t, "split.reopened")).toHaveLength(1);
  });

  it("U-09: a signed-out caller is refused", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.test");
    await expect(t.mutation(api.splitSheets.upsert, { songId, contributors: two() })).rejects.toThrow();
    await expect(t.mutation(api.splitSheets.setStatus, { id: sheetId, status: "draft" })).rejects.toThrow();
    await expect(t.mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "Paper copy" })).rejects.toThrow();
    await expect(t.mutation(api.splitSignatures.issue, { splitSheetId: sheetId })).rejects.toThrow();
    expect((await sheetOf(t, songId)).status).toBe("draft");
  });

  it("U-09: another studio's owner cannot touch this studio's sheet", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    const other = as("u_other", "o2");
    await expect(other.mutation(api.splitSheets.upsert, { songId, contributors: two(10) })).rejects.toThrow();
    await expect(other.mutation(api.splitSheets.setStatus, { id: sheetId, status: "sent" })).rejects.toThrow();
    await expect(other.mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "Paper copy" })).rejects.toThrow();
    await expect(other.mutation(api.splitSignatures.issue, { splitSheetId: sheetId })).rejects.toThrow();
    expect(await other.query(api.splitSheets.forSong, { songId })).toBeNull();
    const sheet = await sheetOf(t, songId);
    expect(sheet.status).toBe("draft");
    expect(sheet.contributors[0].masterPct).toBe(50);
  });

  it("U-10: a used, superseded or expired link cannot sign, and a signature on record is never overwritten", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    const [first] = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
    const links = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
    await expect(t.mutation(api.splitSignatures.sign, { token: first.token, signature: "Alice" })).rejects.toThrow(/no longer valid/);
    const alice = links.find((l) => l.email === "alice@x.com")!;
    await t.mutation(api.splitSignatures.sign, { token: alice.token, signature: "Alice" });
    await expect(t.mutation(api.splitSignatures.sign, { token: alice.token, signature: "Mallory" })).rejects.toThrow(/no longer valid/);

    // A stray live grant for someone who already signed cannot replace their signature.
    const stray = await t.run((ctx) => ctx.db.insert("collaboratorGrants", {
      orgId: "o1", email: "alice@x.com", name: "Alice", scope: "splitsheet", entityId: sheetId,
      capabilities: ["splitsheet.sign"], token: "stray", expiresAt: Date.now() + 1e9, invitedBy: "x", useCount: 0,
    }));
    await expect(t.mutation(api.splitSignatures.sign, { token: "stray", signature: "Mallory" })).rejects.toThrow(/already signed/);
    expect((await sheetOf(t, songId)).contributors[0].signature).toBe("Alice");
    expect(stray).toBeTruthy();

    // A grant made in another studio cannot sign this studio's sheet.
    await t.run((ctx) => ctx.db.insert("collaboratorGrants", {
      orgId: "o2", email: "bob@x.com", name: "Bob", scope: "splitsheet", entityId: sheetId,
      capabilities: ["splitsheet.sign"], token: "cross", expiresAt: Date.now() + 1e9, invitedBy: "x", useCount: 0,
    }));
    await expect(t.mutation(api.splitSignatures.sign, { token: "cross", signature: "Bob" })).rejects.toThrow(/not found/);

    // Expired.
    vi.setSystemTime(Date.now() + 2 * 365 * 24 * 3600 * 1000);
    const bob = links.find((l) => l.email === "bob@x.com")!;
    await expect(t.mutation(api.splitSignatures.sign, { token: bob.token, signature: "Bob" })).rejects.toThrow(/no longer valid/);
  });

  it("U-11: a double click on Send for signature leaves one live link per person", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await Promise.all([
      as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId }),
      as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId }),
    ]);
    const live = await t.run(async (ctx) =>
      (await ctx.db.query("collaboratorGrants").collect()).filter((g) => g.entityId === sheetId && !g.revoked),
    );
    expect(live.map((g) => g.email).sort()).toEqual(["alice@x.com", "bob@x.com"]);
  });

  it("U-12: the release gate stays closed until the sheet is executed (signed by everyone or marked by the owner)", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    const campaignId = await t.run((ctx) => ctx.db.insert("releaseCampaigns", { orgId: "o1", songId, releaseDate: 0, status: "active", tasks: [] }));
    await signAs(t, as, sheetId, ["alice@x.com"]);
    await expect(
      as("u_owner").mutation(api.releases.setStatus, { id: campaignId, status: "released" }),
    ).rejects.toThrow(/not fully executed/);
    expect(isReleasable("mastering", "sent")).toBe(false);
    expect(isReleasable("mastering", "marked_by_studio")).toBe(true);
    expect(isReleasable("mastering", "fully_executed")).toBe(true);

    await as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "Paper copy in the safe" });
    await as("u_owner").mutation(api.releases.setStatus, { id: campaignId, status: "released" });
    expect((await t.run((ctx) => ctx.db.get(campaignId)))!.status).toBe("released");
  });

  it("rights export: a marked sheet is release-ready but never reports the people as signed", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, { songId, contributors: two() });
    const sheetId = (await sheetOf(t, songId))._id;
    await as("u_owner").mutation(api.splitSheets.markSignedOutsidePulse, { id: sheetId, note: "Paper copy in the safe" });
    const packet = await as("u_owner").query(api.rightsExport.packet, { songId });
    expect(packet!.validation).toMatchObject({ allSigned: false, sheetExecuted: true, releaseReady: true });
    expect(packet!.csv).toContain("marked by studio");
    expect(packet!.warnings.join(" ")).toContain("outside Pulse");

    const unsigned = buildRightsPacket({
      title: "x", primaryArtist: "y", kind: "single", isrc: "I", iswc: "W", sheetStatus: "sent",
      contributors: [{ name: "A", role: "W", masterPct: 100, publishingPct: 100, signed: false }],
    });
    expect(unsigned.validation.releaseReady).toBe(false);
  });

  it("lookup: a hand-ticked person opening a dead link sees the invalid screen, not 'you have signed'", async () => {
    const sheetId = await t.run((ctx) => ctx.db.insert("splitSheets", {
      orgId: "o1", songId, status: "sent", updatedAt: 0,
      contributors: [{ name: "Ticked", role: "Writer", masterPct: 100, publishingPct: 100, email: "tick@x.com", signed: true }],
    }));
    await t.run((ctx) => ctx.db.insert("collaboratorGrants", {
      orgId: "o1", email: "tick@x.com", name: "Ticked", scope: "splitsheet", entityId: sheetId,
      capabilities: ["splitsheet.sign"], token: "dead", expiresAt: Date.now() + 1e9, invitedBy: "x", useCount: 0, revoked: true,
    }));
    expect(await t.query(api.splitSignatures.lookup, { token: "dead" })).toBeNull();
  });

  it("H209-04: the public signing lookup never returns another signer's signature, email or browser", async () => {
    await as("u_owner").mutation(api.splitSheets.upsert, {
      songId, contributors: two().map((c) => ({ ...c, ipi: "00012345678", pro: "BMI" })),
    });
    const sheetId = (await sheetOf(t, songId))._id;
    const links = await as("u_owner").mutation(api.splitSignatures.issue, { splitSheetId: sheetId });
    const alice = links.find((l) => l.email === "alice@x.com")!;
    await t.mutation(api.splitSignatures.sign, {
      token: alice.token, signature: "data:image/png;base64,AAAA", signatureKind: "drawn", userAgent: "AliceBrowser/1",
    });
    const bob = links.find((l) => l.email === "bob@x.com")!;
    const view = await t.query(api.splitSignatures.lookup, { token: bob.token });
    expect(view!.sheet.contributors).toEqual([
      { name: "Alice", role: "Songwriter", masterPct: 50, publishingPct: 50, signed: true },
      { name: "Bob", role: "Producer", masterPct: 50, publishingPct: 50, signed: false },
    ]);
    const raw = JSON.stringify(view);
    for (const leak of ["alice@x.com", "data:image/png", "AliceBrowser", "00012345678", "BMI"]) {
      expect(raw).not.toContain(leak);
    }
    expect(view!.signer.email).toBe("bob@x.com");
  });

  it("report: lists hand-ticked sheets and changes nothing", async () => {
    const other = await t.run(async (ctx) => {
      const s = (await ctx.db.get(songId))!;
      return ctx.db.insert("songs", { ...s, _id: undefined, _creationTime: undefined, title: "Clean" } as never);
    });
    const ticked = await t.run((ctx) => ctx.db.insert("splitSheets", {
      orgId: "o1", songId, status: "fully_executed", updatedAt: 0,
      contributors: [
        { name: "Ticked", role: "Writer", masterPct: 50, publishingPct: 50, signed: true },
        { name: "Real", role: "Writer", masterPct: 50, publishingPct: 50, signed: true, signedAt: 5, signature: "Real" },
      ],
    }));
    await t.run((ctx) => ctx.db.insert("splitSheets", {
      orgId: "o1", songId: other, status: "draft", updatedAt: 0,
      contributors: [{ name: "Nobody", role: "Writer", masterPct: 100, publishingPct: 100, signed: false }],
    }));
    const before = await t.run((ctx) => ctx.db.query("splitSheets").collect());
    const report = await t.query(internal.splitSheets.reportHandTickedSheets, { numItems: 100 });
    expect(report.isDone).toBe(true);
    expect(report.rows).toEqual([
      { sheetId: ticked, orgId: "o1", songId, status: "fully_executed", handTicked: ["Ticked"], signedByLink: 1, total: 2, wouldBecome: "marked_by_studio" },
    ]);
    expect(await t.run((ctx) => ctx.db.query("splitSheets").collect())).toEqual(before);

    // Meanwhile screens already call it marked by the studio, not fully signed.
    const view = await as("u_owner").query(api.splitSheets.forSong, { songId });
    expect(view!.displayStatus).toBe("marked_by_studio");
  });
});
