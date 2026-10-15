import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import r2Test from "@convex-dev/r2/test";
import { R2 } from "@convex-dev/r2";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sessionFileLimit, BIG_FILE_MAX, DOC_FILE_MAX } from "./sessionFiles";

/* The session modal's staff extras: notes, files (bytes in Cloudflare R2) and
   extra songs. The rule that matters most: a member of studio A can never read
   or change studio B's notes, files or songs. R2 is never called for real: the
   presigned URLs are signed locally with fake keys and deletes are mocked. */

const A = "org_alpha";
const B = "org_bravo";
const HOUR = 3_600_000;

let deletes: string[] = [];

function env() {
  vi.stubEnv("R2_ENDPOINT", "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIATEST");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-test-value");
  vi.stubEnv("R2_PRIVATE_BUCKET", "pulse-private");
  vi.stubEnv("R2_MEDIA_BUCKET", "pulse-media");
  vi.stubEnv("R2_KEY_PREFIX", "test");
  vi.stubEnv("R2_PUBLIC_URL", "https://media.example.test");
}

type Studio = { sessionId: Id<"sessions">; songId: Id<"songs">; otherSongId: Id<"songs">; artistId: Id<"artists"> };

async function setup() {
  const t = convexTest(schema);
  r2Test.register(t);
  const ids = await t.run(async (ctx) => {
    const out: Record<string, Studio> = {};
    for (const orgId of [A, B]) {
      await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "growth", status: "active" } as never);
      const artistId = await ctx.db.insert("artists", {
        orgId, name: `Artist ${orgId}`, type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      } as never);
      const song = (title: string) =>
        ctx.db.insert("songs", {
          orgId, title, artistId, kind: "single", stage: "writing", moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
        } as never);
      const songId = await song(`Main ${orgId}`);
      const otherSongId = await song(`B-side ${orgId}`);
      const start = Date.now() + 24 * HOUR;
      const sessionId = await ctx.db.insert("sessions", {
        orgId, title: `Tracking ${orgId}`, artistId, songId, serviceType: "recording", startTime: start, endTime: start + 2 * HOUR,
        status: "confirmed", rateCents: 20000, depositCents: 6000, depositPaid: true, intakeCompleted: false,
        gearRequestNote: "Bring the U47", source: "public_booking", notes: "First time in the room",
      } as never);
      await ctx.db.insert("invoices", {
        orgId, artistId, sessionId, number: `INV-${orgId}`, status: "sent", amountCents: 14000, dueDate: start, lineItems: [],
      } as never);
      out[orgId] = { sessionId, songId, otherSongId, artistId } as Studio;
    }
    const members: [string, string, string, string][] = [
      ["Olu", "owner", "u_a_owner", A],
      ["Eli", "engineer", "u_a_eng", A],
      ["Ivy", "intern", "u_a_intern", A],
      ["Bea", "owner", "u_b_owner", B],
    ];
    for (const [name, role, clerkUserId, orgId] of members) {
      await ctx.db.insert("members", { orgId, name, role, email: `${clerkUserId}@x.test`, skills: [], clerkUserId } as never);
    }
    return out;
  });
  const as = (subject: string, orgId: string) => t.withIdentity({ subject, orgId, name: subject });
  return {
    t,
    a: ids[A],
    b: ids[B],
    owner: as("u_a_owner", A),
    engineer: as("u_a_eng", A),
    intern: as("u_a_intern", A),
    outsider: as("u_b_owner", B),
  };
}

beforeEach(() => {
  env();
  deletes = [];
  vi.spyOn(R2.prototype, "deleteObject").mockImplementation(async (_ctx, key) => {
    deletes.push(key);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("session notes", () => {
  it("staff add notes, newest first, with the author", async () => {
    const { owner, intern, a } = await setup();
    await owner.mutation(api.sessionNotes.add, { sessionId: a.sessionId, body: "Client prefers the SSL" });
    await intern.mutation(api.sessionNotes.add, { sessionId: a.sessionId, body: "Parking pass left at desk" });
    const notes = await owner.query(api.sessionNotes.list, { sessionId: a.sessionId });
    expect(notes?.map((n) => n.body)).toEqual(["Parking pass left at desk", "Client prefers the SSL"]);
    expect(notes?.[0].authorName).toBe("Ivy");
    expect(notes?.[1].authorName).toBe("Olu");
  });

  it("refuses an empty note", async () => {
    const { owner, a } = await setup();
    await expect(owner.mutation(api.sessionNotes.add, { sessionId: a.sessionId, body: "   " })).rejects.toThrow(/Write a note/);
  });

  it("the author deletes their own; only an owner or manager deletes someone else's", async () => {
    const { owner, intern, engineer, a } = await setup();
    const ownerNote = await owner.mutation(api.sessionNotes.add, { sessionId: a.sessionId, body: "owner" });
    const internNote = await intern.mutation(api.sessionNotes.add, { sessionId: a.sessionId, body: "intern" });

    const seenByIntern = await intern.query(api.sessionNotes.list, { sessionId: a.sessionId });
    expect(seenByIntern?.find((n) => n._id === ownerNote)?.canDelete).toBe(false);
    expect(seenByIntern?.find((n) => n._id === internNote)?.canDelete).toBe(true);

    await expect(intern.mutation(api.sessionNotes.remove, { noteId: ownerNote })).rejects.toThrow(/Only the author/);
    await expect(engineer.mutation(api.sessionNotes.remove, { noteId: internNote })).rejects.toThrow(/Only the author/);
    await owner.mutation(api.sessionNotes.remove, { noteId: internNote });
    await owner.mutation(api.sessionNotes.remove, { noteId: ownerNote });
    expect(await owner.query(api.sessionNotes.list, { sessionId: a.sessionId })).toEqual([]);
  });

  it("a member of another studio can never read, add or delete them", async () => {
    const { owner, outsider, a, b } = await setup();
    const note = await owner.mutation(api.sessionNotes.add, { sessionId: a.sessionId, body: "Studio A only" });
    expect(await outsider.query(api.sessionNotes.list, { sessionId: a.sessionId })).toBeNull();
    await expect(outsider.mutation(api.sessionNotes.add, { sessionId: a.sessionId, body: "hi" })).rejects.toThrow(/Session not found/);
    await expect(outsider.mutation(api.sessionNotes.remove, { noteId: note })).rejects.toThrow(/Session not found/);
    // Their own studio still works, and never shows A's note.
    await outsider.mutation(api.sessionNotes.add, { sessionId: b.sessionId, body: "Studio B" });
    expect((await outsider.query(api.sessionNotes.list, { sessionId: b.sessionId }))?.map((n) => n.body)).toEqual(["Studio B"]);
  });
});

describe("session file limits", () => {
  it("accepts audio, stems and documents, refuses anything a browser could run", () => {
    expect(sessionFileLimit("audio/wav")).toBe(BIG_FILE_MAX);
    expect(sessionFileLimit("application/zip")).toBe(BIG_FILE_MAX);
    expect(sessionFileLimit("")).toBe(BIG_FILE_MAX); // a .ptx or .als with no type
    expect(sessionFileLimit("application/pdf")).toBe(DOC_FILE_MAX);
    expect(sessionFileLimit("image/jpeg")).toBe(DOC_FILE_MAX);
    expect(sessionFileLimit("text/html")).toBeNull();
    expect(sessionFileLimit("image/svg+xml")).toBeNull();
    expect(sessionFileLimit("application/javascript")).toBeNull();
  });
});

/** prepareUpload, then what media.confirmUpload does once R2 reports the object. */
async function uploaded(
  s: Awaited<ReturnType<typeof setup>>,
  who: typeof s.owner,
  sessionId: Id<"sessions">,
  file = { fileName: "Lead vox take 3.wav", mimeType: "audio/wav", size: 48_000_000 },
) {
  const prep = await who.mutation(api.sessionFiles.prepareUpload, { sessionId, ...file });
  await s.t.mutation(internal.media._markReady, { mediaId: prep.mediaId, size: file.size });
  return prep;
}

describe("session files in R2", () => {
  it("presigns a PUT into the studio's private bucket, files it, and presigns a short GET", async () => {
    const s = await setup();
    const prep = await uploaded(s, s.engineer, s.a.sessionId);
    const put = new URL(prep.url);
    expect(put.hostname).toBe("pulse-private.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
    expect(put.pathname).toContain(`/test/${A}/deliverable/lead-vox-take-3-`);
    expect(put.searchParams.get("X-Amz-Signature")).toBeTruthy();

    const row = await s.t.run((ctx) => ctx.db.get(prep.mediaId));
    expect(row).toMatchObject({ orgId: A, bucket: "private", purpose: "deliverable", status: "ready" });

    const { versionId } = await s.engineer.mutation(api.sessionFiles.attach, { sessionId: s.a.sessionId, mediaId: prep.mediaId });
    const list = await s.intern.query(api.sessionFiles.list, { sessionId: s.a.sessionId });
    expect(list?.files).toHaveLength(1);
    expect(list?.files[0]).toMatchObject({ fileName: "Lead vox take 3.wav", size: 48_000_000, kind: "session", uploadedBy: "Eli" });
    // The intern sees files but did not upload this one and is no manager.
    expect(list?.files[0].canDelete).toBe(false);
    expect(list?.canUpload).toBe(false);

    const dl = await s.intern.query(api.sessionFiles.downloadUrl, { versionId });
    const get = new URL(dl.url);
    expect(get.hostname.startsWith("pulse-private.")).toBe(true);
    expect(get.pathname).toBe(put.pathname);
    expect(get.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(get.searchParams.get("X-Amz-Signature")).toBeTruthy();

    // Bytes count against the plan's storage, and nothing went to Convex storage.
    const stored = await s.t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(stored).toHaveLength(0);
  });

  it("checks type and size before minting a URL, and the real size again on attach", async () => {
    const s = await setup();
    const prep = (mimeType: string, size: number) =>
      s.owner.mutation(api.sessionFiles.prepareUpload, { sessionId: s.a.sessionId, fileName: "x", mimeType, size });
    await expect(prep("text/html", 100)).rejects.toThrow(/not supported/);
    await expect(prep("audio/wav", BIG_FILE_MAX + 1)).rejects.toThrow(/too large \(limit 2 GB\)/);
    await expect(prep("application/pdf", DOC_FILE_MAX + 1)).rejects.toThrow(/too large \(limit 100 MB\)/);
    await expect(prep("audio/wav", 0)).rejects.toThrow(/empty/);

    // Declared small, arrived big: refused when filing.
    const p = await s.owner.mutation(api.sessionFiles.prepareUpload, { sessionId: s.a.sessionId, fileName: "notes.pdf", mimeType: "application/pdf", size: 1000 });
    await s.t.mutation(internal.media._markReady, { mediaId: p.mediaId, size: DOC_FILE_MAX + 5 });
    await expect(s.owner.mutation(api.sessionFiles.attach, { sessionId: s.a.sessionId, mediaId: p.mediaId })).rejects.toThrow(/too large/);
  });

  it("an intern cannot upload", async () => {
    const s = await setup();
    await expect(
      s.intern.mutation(api.sessionFiles.prepareUpload, { sessionId: s.a.sessionId, fileName: "a.wav", mimeType: "audio/wav", size: 10 }),
    ).rejects.toThrow();
  });

  it("a member of another studio can never list, download, attach to, or delete studio A's files", async () => {
    const s = await setup();
    const prep = await uploaded(s, s.owner, s.a.sessionId);
    const { assetId, versionId } = await s.owner.mutation(api.sessionFiles.attach, { sessionId: s.a.sessionId, mediaId: prep.mediaId });

    expect(await s.outsider.query(api.sessionFiles.list, { sessionId: s.a.sessionId })).toBeNull();
    await expect(s.outsider.query(api.sessionFiles.downloadUrl, { versionId })).rejects.toThrow(/not found/i);
    await expect(s.outsider.mutation(api.sessionFiles.remove, { assetId })).rejects.toThrow(/not found/i);
    await expect(
      s.outsider.mutation(api.sessionFiles.prepareUpload, { sessionId: s.a.sessionId, fileName: "x.wav", mimeType: "audio/wav", size: 10 }),
    ).rejects.toThrow(/Session not found/);

    // Studio B cannot file studio A's upload on its own booking either.
    const stray = await uploaded(s, s.owner, s.a.sessionId);
    await expect(s.outsider.mutation(api.sessionFiles.attach, { sessionId: s.b.sessionId, mediaId: stray.mediaId })).rejects.toThrow(/Upload not found/);

    // B's own booking shows none of A's files.
    expect((await s.outsider.query(api.sessionFiles.list, { sessionId: s.b.sessionId }))?.files).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("the uploader or an owner deletes a file, and its R2 object goes with it", async () => {
    vi.useFakeTimers();
    const s = await setup();
    const prep = await uploaded(s, s.engineer, s.a.sessionId);
    const { assetId } = await s.engineer.mutation(api.sessionFiles.attach, { sessionId: s.a.sessionId, mediaId: prep.mediaId });
    await expect(s.intern.mutation(api.sessionFiles.remove, { assetId })).rejects.toThrow(/Only the person who uploaded/);
    await s.owner.mutation(api.sessionFiles.remove, { assetId });
    expect(await s.t.run((ctx) => ctx.db.get(prep.mediaId))).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.get(assetId))).toBeNull();
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain(`test/${A}/deliverable/`);
  });
});

describe("session songs", () => {
  it("lists the main song, links and unlinks more, and an upload can tag a song", async () => {
    const s = await setup();
    let list = await s.owner.query(api.sessionFiles.list, { sessionId: s.a.sessionId });
    expect(list?.songs.map((x) => [x.title, x.primary])).toEqual([[`Main ${A}`, true]]);

    const linkId = await s.engineer.mutation(api.sessionFiles.linkSong, { sessionId: s.a.sessionId, songId: s.a.otherSongId });
    // Linking twice (or linking the main song) never duplicates.
    await s.engineer.mutation(api.sessionFiles.linkSong, { sessionId: s.a.sessionId, songId: s.a.otherSongId });
    await s.engineer.mutation(api.sessionFiles.linkSong, { sessionId: s.a.sessionId, songId: s.a.songId });
    list = await s.owner.query(api.sessionFiles.list, { sessionId: s.a.sessionId });
    expect(list?.songs.map((x) => x.title)).toEqual([`Main ${A}`, `B-side ${A}`]);

    await expect(s.intern.mutation(api.sessionFiles.unlinkSong, { linkId: linkId! })).rejects.toThrow();
    await s.owner.mutation(api.sessionFiles.unlinkSong, { linkId: linkId! });

    const prep = await uploaded(s, s.owner, s.a.sessionId, { fileName: "Rough mix.mp3", mimeType: "audio/mpeg", size: 9_000_000 });
    await s.owner.mutation(api.sessionFiles.attach, { sessionId: s.a.sessionId, mediaId: prep.mediaId, songId: s.a.otherSongId });
    list = await s.owner.query(api.sessionFiles.list, { sessionId: s.a.sessionId });
    expect(list?.songs.map((x) => x.title)).toEqual([`Main ${A}`, `B-side ${A}`]);
    expect(list?.files[0].songId).toBe(s.a.otherSongId);
  });

  it("never links another studio's song, and another studio cannot touch A's songs", async () => {
    const s = await setup();
    await expect(s.owner.mutation(api.sessionFiles.linkSong, { sessionId: s.a.sessionId, songId: s.b.songId })).rejects.toThrow(/Song not found/);
    await expect(s.outsider.mutation(api.sessionFiles.linkSong, { sessionId: s.a.sessionId, songId: s.b.songId })).rejects.toThrow(/Session not found/);
    const linkId = await s.owner.mutation(api.sessionFiles.linkSong, { sessionId: s.a.sessionId, songId: s.a.otherSongId });
    await expect(s.outsider.mutation(api.sessionFiles.unlinkSong, { linkId: linkId! })).rejects.toThrow(/Session not found/);
    expect(await s.outsider.query(api.sessionFiles.songChoices, { sessionId: s.a.sessionId })).toBeNull();
    const mine = await s.outsider.query(api.sessionFiles.songChoices, { sessionId: s.b.sessionId });
    expect(mine?.every((x) => x.title.endsWith(B))).toBe(true);
  });
});

describe("session detail extras", () => {
  it("shows the booking's invoice to staff who see money, and nothing to another studio", async () => {
    const s = await setup();
    const extras = await s.owner.query(api.sessionDetail.extras, { sessionId: s.a.sessionId });
    expect(extras?.invoices.map((i) => i.number)).toEqual([`INV-${A}`]);
    expect(extras?.source).toBe("public_booking");
    expect(await s.outsider.query(api.sessionDetail.extras, { sessionId: s.a.sessionId })).toBeNull();
    // An intern sees the booking but not client money.
    const internView = await s.intern.query(api.sessionDetail.extras, { sessionId: s.a.sessionId });
    expect(internView?.seesMoney).toBe(false);
    expect(internView?.invoices).toEqual([]);
  });
});
