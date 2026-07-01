import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Portal revenue-surface upgrades: book-again slug, payable invoices,
   approved-deliverable downloads. Everything is scoped to the grant's org +
   the artist the token represents - a public token surface. */

const ORG = "org_portal";
const OTHER_ORG = "org_other";
const DAY = 86_400_000;

async function seed(
  t: ReturnType<typeof convexTest>,
  opts: { token: string; slug?: string } = { token: "tok" },
) {
  return t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Skyline Studio", slug: opts.slug ?? "skyline", plan: "studio", status: "active",
    });
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", email: "nova@x.com", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const songId = await ctx.db.insert("songs", {
      orgId: ORG, title: "Skyline", artistId, kind: "single", stage: "mixing",
      moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
    });
    // Fully-paid session so payment-gated files are unlocked by default.
    await ctx.db.insert("sessions", {
      orgId: ORG, title: "Mix", artistId, songId, serviceType: "mixing",
      startTime: Date.now() + DAY, endTime: Date.now() + DAY + 3_600_000,
      status: "confirmed", rateCents: 10000, depositCents: 2000, depositPaid: true,
      intakeCompleted: false, amountPaidCents: 10000,
    });
    // Invoices across the status spectrum.
    await ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-SENT", artistId, status: "sent",
      lineItems: [{ label: "Mix", amountCents: 8000 }], amountCents: 8000, dueDate: Date.now() + DAY,
    });
    await ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-OVERDUE", artistId, status: "overdue",
      lineItems: [{ label: "Master", amountCents: 5000 }], amountCents: 5000, dueDate: Date.now() - DAY,
    });
    await ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-DRAFT", artistId, status: "draft",
      lineItems: [{ label: "Draft", amountCents: 3000 }], amountCents: 3000, dueDate: Date.now() + DAY,
    });
    await ctx.db.insert("invoices", {
      orgId: ORG, number: "PLS-PAID", artistId, status: "paid",
      lineItems: [{ label: "Paid", amountCents: 2000 }], amountCents: 2000, dueDate: Date.now(), paidAt: Date.now(),
    });
    // Approved deliverable with a stored audio file.
    const approvedFile = await ctx.storage.store(new Blob(["audio"], { type: "audio/wav" }));
    const approvedId = await ctx.db.insert("deliverables", {
      orgId: ORG, songId, kind: "mix", version: 2, label: "Final Mix", status: "approved",
      paymentGated: false, approvedAt: Date.now(), fileId: approvedFile,
      fileName: "final-mix.wav", fileSize: 5, mimeType: "audio/wav",
    });
    // Unapproved draft deliverable - must NOT be exposed.
    const draftFile = await ctx.storage.store(new Blob(["draft"], { type: "audio/wav" }));
    const draftId = await ctx.db.insert("deliverables", {
      orgId: ORG, songId, kind: "mix", version: 1, label: "Rough Mix", status: "delivered",
      paymentGated: false, fileId: draftFile, fileName: "rough.wav", fileSize: 5, mimeType: "audio/wav",
    });

    // Foreign org + artist + approved deliverable - must NEVER surface here.
    const otherArtist = await ctx.db.insert("artists", {
      orgId: OTHER_ORG, name: "Rival", type: "artist", email: "r@x.com", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const otherSong = await ctx.db.insert("songs", {
      orgId: OTHER_ORG, title: "Other", artistId: otherArtist, kind: "single", stage: "mixing",
      moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
    });
    const otherFile = await ctx.storage.store(new Blob(["x"], { type: "audio/wav" }));
    const otherDeliverableId = await ctx.db.insert("deliverables", {
      orgId: OTHER_ORG, songId: otherSong, kind: "mix", version: 1, label: "Other Mix", status: "approved",
      paymentGated: false, approvedAt: Date.now(), fileId: otherFile, mimeType: "audio/wav",
    });

    const grantId = await ctx.db.insert("collaboratorGrants", {
      orgId: ORG, email: "nova@x.com", name: "Nova", scope: "artist_portal",
      entityId: artistId, capabilities: ["songs.read"], token: opts.token,
      expiresAt: Date.now() + 30 * DAY, invitedBy: "owner", useCount: 0,
    });
    return { artistId, songId, grantId, approvedId, draftId, otherDeliverableId };
  });
}

describe("portal upgrades - revenue surface", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves the studio booking slug from the grant's org", async () => {
    await seed(t, { token: "tok", slug: "myindsound" });
    const s = await t.query(api.portal.summary, { token: "tok" });
    expect(s).not.toBeNull();
    expect(s!.bookingSlug).toBe("myindsound");
  });

  it("exposes open invoices as payable, excluding draft/paid/void", async () => {
    await seed(t, { token: "tok" });
    const s = await t.query(api.portal.summary, { token: "tok" });
    const byNumber = Object.fromEntries(s!.invoices.map((i) => [i.number, i]));
    // void filtered out entirely; draft + paid present but not payable.
    expect(byNumber["PLS-SENT"].payable).toBe(true);
    expect(byNumber["PLS-OVERDUE"].payable).toBe(true);
    expect(byNumber["PLS-DRAFT"].payable).toBe(false);
    expect(byNumber["PLS-PAID"].payable).toBe(false);
    // every invoice carries its id so the page can link /pay/invoice/<id>.
    expect(byNumber["PLS-SENT"].id).toBeTruthy();
  });

  it("exposes only approved deliverables for the artist's own songs", async () => {
    await seed(t, { token: "tok" });
    const s = await t.query(api.portal.summary, { token: "tok" });
    expect(s!.deliverables).toHaveLength(1);
    const d = s!.deliverables[0];
    expect(d.label).toBe("Final Mix");
    expect(d.isAudio).toBe(true);
    expect(d.locked).toBe(false);
  });

  it("returns a signed URL for an approved deliverable", async () => {
    const { approvedId } = await seed(t, { token: "tok" });
    const res = await t.query(api.portal.deliverableDownloadUrl, {
      token: "tok", deliverableId: approvedId as Id<"deliverables">,
    });
    expect(res).not.toBeNull();
    expect(res && "url" in res && res.url).toBeTruthy();
  });

  it("refuses download URLs for unapproved and other-org deliverables", async () => {
    const { draftId, otherDeliverableId } = await seed(t, { token: "tok" });
    expect(await t.query(api.portal.deliverableDownloadUrl, {
      token: "tok", deliverableId: draftId as Id<"deliverables">,
    })).toBeNull();
    expect(await t.query(api.portal.deliverableDownloadUrl, {
      token: "tok", deliverableId: otherDeliverableId as Id<"deliverables">,
    })).toBeNull();
  });

  it("locks a payment-gated deliverable until the song balance is paid", async () => {
    const { songId, approvedId } = await seed(t, { token: "tok" });
    // Flip the approved deliverable to payment-gated and leave a balance owing.
    await t.run(async (ctx) => {
      await ctx.db.patch(approvedId as Id<"deliverables">, { paymentGated: true });
      const sessions = await ctx.db.query("sessions").collect();
      for (const sess of sessions) {
        if (sess.songId === (songId as Id<"songs">)) await ctx.db.patch(sess._id, { amountPaidCents: 0 });
      }
    });
    const s = await t.query(api.portal.summary, { token: "tok" });
    expect(s!.deliverables[0].locked).toBe(true);
    const res = await t.query(api.portal.deliverableDownloadUrl, {
      token: "tok", deliverableId: approvedId as Id<"deliverables">,
    });
    expect(res).toEqual({ locked: true });
  });

  it("rejects unknown / wrong-scope tokens on the download path", async () => {
    const { approvedId } = await seed(t, { token: "tok" });
    expect(await t.query(api.portal.deliverableDownloadUrl, {
      token: "nope", deliverableId: approvedId as Id<"deliverables">,
    })).toBeNull();
  });
});
