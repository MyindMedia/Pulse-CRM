import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { gateAllows, isStaff } from "./files";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo"; // demo viewer resolves to this org as owner (staff)

describe("files - payment-gated download", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  /** Seed an org + artist + song and attach a stored file to a deliverable. */
  async function seed(opts: { paymentGated: boolean; rateCents: number; paidCents: number }) {
    return await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG,
        name: "Artist",
        type: "artist",
        genres: [],
        tags: [],
        status: "active",
        reliability: "solid",
        sessionCount: 0,
        lifetimeValueCents: 0,
      });
      const songId = await ctx.db.insert("songs", {
        orgId: ORG,
        title: "Song",
        artistId,
        kind: "single",
        stage: "tracking",
        moodTags: [],
        referenceTracks: [],
        revisionsIncluded: 3,
        revisionsUsed: 0,
      });
      await ctx.db.insert("sessions", {
        orgId: ORG,
        title: "Tracking",
        artistId,
        songId,
        serviceType: "recording",
        startTime: Date.now(),
        endTime: Date.now() + 3600000,
        status: "confirmed",
        rateCents: opts.rateCents,
        depositCents: Math.round(opts.rateCents * 0.3),
        depositPaid: true,
        intakeCompleted: false,
        amountPaidCents: opts.paidCents,
      });
      const fileId = await ctx.storage.store(new Blob(["audio-bytes"], { type: "audio/wav" }));
      const deliverableId = await ctx.db.insert("deliverables", {
        orgId: ORG,
        songId,
        kind: "master",
        version: 1,
        label: "Final master",
        status: "delivered",
        paymentGated: opts.paymentGated,
        fileId: fileId as Id<"_storage">,
        fileName: "final-master.wav",
        fileSize: 11,
        mimeType: "audio/wav",
      });
      return { songId, deliverableId };
    });
  }

  it("(a) non-gated deliverable returns a url", async () => {
    const { deliverableId } = await seed({ paymentGated: false, rateCents: 50000, paidCents: 0 });
    const res = await t.query(api.files.downloadUrl, { deliverableId });
    expect(res.url).toBeTruthy();
  });

  it("(c) gated + fully paid returns a url", async () => {
    const { deliverableId } = await seed({ paymentGated: true, rateCents: 50000, paidCents: 50000 });
    const res = await t.query(api.files.downloadUrl, { deliverableId });
    expect(res.url).toBeTruthy();
  });

  it("(d) gated + staff/owner caller returns a url even when unpaid", async () => {
    // The demo viewer resolves to an owner (staff), so the staff bypass applies.
    const { deliverableId } = await seed({ paymentGated: true, rateCents: 50000, paidCents: 0 });
    const res = await t.query(api.files.downloadUrl, { deliverableId });
    expect(res.url).toBeTruthy();
  });

  it("throws when no file has been uploaded", async () => {
    const deliverableId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", plan: "studio", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "A", type: "artist", genres: [], tags: [],
        status: "active", reliability: "solid",
        sessionCount: 0, lifetimeValueCents: 0,
      });
      const songId = await ctx.db.insert("songs", {
        orgId: ORG, title: "S", artistId, kind: "single", stage: "tracking",
        moodTags: [], referenceTracks: [],
        revisionsIncluded: 3, revisionsUsed: 0,
      });
      return await ctx.db.insert("deliverables", {
        orgId: ORG, songId, kind: "mix", version: 1, label: "Rough",
        status: "delivered", paymentGated: true,
      });
    });
    await expect(t.query(api.files.downloadUrl, { deliverableId })).rejects.toThrow(
      "No file uploaded yet.",
    );
  });

  it("generateUploadUrl returns an upload url for staff", async () => {
    const url = await t.mutation(api.files.generateUploadUrl, {});
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });

  it("attachFile patches file metadata onto the deliverable", async () => {
    const { deliverableId } = await seed({ paymentGated: true, rateCents: 1000, paidCents: 0 });
    const newFileId = await t.run(async (ctx) =>
      await ctx.storage.store(new Blob(["v2"], { type: "audio/wav" })),
    );
    await t.mutation(api.files.attachFile, {
      deliverableId,
      storageId: newFileId as Id<"_storage">,
      fileName: "v2.wav",
      fileSize: 2,
      mimeType: "audio/wav",
    });
    const d = await t.run(async (ctx) => await ctx.db.get(deliverableId));
    expect(d!.fileName).toBe("v2.wav");
    expect(d!.fileSize).toBe(2);
    expect(d!.fileId).toBe(newFileId);
  });
});

describe("files - gateAllows decision matrix", () => {
  it("(a) non-gated always allows", () => {
    expect(gateAllows({ paymentGated: false, staff: false, outstandingCents: 9999 })).toBe(true);
  });

  it("(b) gated + unpaid + non-staff is blocked", () => {
    expect(gateAllows({ paymentGated: true, staff: false, outstandingCents: 5000 })).toBe(false);
  });

  it("(c) gated + fully paid + non-staff allows", () => {
    expect(gateAllows({ paymentGated: true, staff: false, outstandingCents: 0 })).toBe(true);
  });

  it("(d) gated + staff allows regardless of balance", () => {
    expect(gateAllows({ paymentGated: true, staff: true, outstandingCents: 5000 })).toBe(true);
  });

  it("isStaff: guests are not staff, members are", () => {
    expect(isStaff("guest")).toBe(false);
    expect(isStaff("studio_member")).toBe(true);
    expect(isStaff("agency_member")).toBe(true);
  });
});
