import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo";

async function seedSheet(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const artistId = await ctx.db.insert("artists", {
      orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
      status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
    const songId = await ctx.db.insert("songs", {
      orgId: ORG, title: "Skyline", artistId, kind: "single", stage: "mixing",
      moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
    });
    const splitSheetId = await ctx.db.insert("splitSheets", {
      orgId: ORG, songId, status: "draft", updatedAt: Date.now(),
      contributors: [
        { name: "Already Signed", role: "Writer", masterPct: 50, publishingPct: 50, email: "signed@x.com", signed: true },
        { name: "Needs To Sign", role: "Producer", masterPct: 50, publishingPct: 50, email: "needs@x.com", signed: false },
        { name: "No Email", role: "Engineer", masterPct: 0, publishingPct: 0, signed: false },
      ],
    });
    return { splitSheetId };
  });
}

describe("split-sheet e-signature", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("issue creates one signing grant per unsigned contributor with an email", async () => {
    const { splitSheetId } = await seedSheet(t);
    const links = await t.mutation(api.splitSignatures.issue, { splitSheetId });

    expect(links).toHaveLength(1);
    expect(links[0].name).toBe("Needs To Sign");
    expect(links[0].email).toBe("needs@x.com");

    const grants = await t.run(async (ctx) =>
      (await ctx.db.query("collaboratorGrants").collect()).filter(
        (g) => g.orgId === ORG && g.scope === "splitsheet",
      ),
    );
    expect(grants).toHaveLength(1);
    expect(grants[0].capabilities).toContain("splitsheet.sign");

    const sheet = await t.run(async (ctx) => ctx.db.get(splitSheetId));
    expect(sheet?.status).toBe("sent");
  });

  it("re-issue revokes the prior unused link for the same contributor", async () => {
    const { splitSheetId } = await seedSheet(t);
    const first = await t.mutation(api.splitSignatures.issue, { splitSheetId });
    const firstToken = first[0].token;
    const second = await t.mutation(api.splitSignatures.issue, { splitSheetId });
    const secondToken = second[0].token;
    expect(firstToken).not.toBe(secondToken);

    const grants = await t.run(async (ctx) =>
      (await ctx.db.query("collaboratorGrants").collect()).filter((g) => g.scope === "splitsheet"),
    );
    const active = grants.filter((g) => !g.revoked);
    expect(active).toHaveLength(1);
    expect(active[0].token).toBe(secondToken);
  });

  it("lookup returns the sheet + signer for a valid token, null for invalid", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });

    const ok = await t.query(api.splitSignatures.lookup, { token: link.token });
    expect(ok).not.toBeNull();
    expect(ok!.signer.email).toBe("needs@x.com");
    expect(ok!.signer.contributorIndex).toBe(1);
    expect(ok!.song?.title).toBe("Skyline");
    expect(ok!.alreadySigned).toBe(false);

    expect(await t.query(api.splitSignatures.lookup, { token: "nope" })).toBeNull();
  });

  it("sign stamps the contributor, revokes the link, and writes audit", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });

    const res = await t.mutation(api.splitSignatures.sign, {
      token: link.token, signature: "Real Producer Name", userAgent: "test-ua/1.0",
    });
    expect(res.ok).toBe(true);

    const sheet = await t.run(async (ctx) => ctx.db.get(splitSheetId));
    const signer = sheet!.contributors[1];
    expect(signer.signed).toBe(true);
    expect(signer.signature).toBe("Real Producer Name");
    expect(signer.signedAt).toBeGreaterThan(0);
    expect(signer.signedFromUa).toBe("test-ua/1.0");

    const grant = await t.run(async (ctx) =>
      (await ctx.db.query("collaboratorGrants").collect()).find((g) => g.token === link.token),
    );
    expect(grant?.revoked).toBe(true);

    const audits = await t.run(async (ctx) =>
      (await ctx.db.query("auditEvents").collect()).filter(
        (a) => a.orgId === ORG && a.action === "splitsheet.sign",
      ),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].viewerType).toBe("guest");
  });

  it("flips the sheet to fully_executed once every contributor has signed", async () => {
    // Seed a sheet where the only un-signed contributor will become signed.
    const splitSheetId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const songId = await ctx.db.insert("songs", {
        orgId: ORG, title: "Solo", artistId, kind: "single", stage: "mixing",
        moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0,
      });
      return ctx.db.insert("splitSheets", {
        orgId: ORG, songId, status: "sent", updatedAt: Date.now(),
        contributors: [
          { name: "Already", role: "Writer", masterPct: 50, publishingPct: 50, email: "a@x.com", signed: true },
          { name: "Last One", role: "Producer", masterPct: 50, publishingPct: 50, email: "last@x.com", signed: false },
        ],
      });
    });

    const links = await t.mutation(api.splitSignatures.issue, { splitSheetId });
    const res = await t.mutation(api.splitSignatures.sign, { token: links[0].token, signature: "Last One" });
    expect(res.allSigned).toBe(true);

    const sheet = await t.run(async (ctx) => ctx.db.get(splitSheetId as Id<"splitSheets">));
    expect(sheet?.status).toBe("fully_executed");
  });

  it("rejects an empty signature and a used token", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });

    await expect(
      t.mutation(api.splitSignatures.sign, { token: link.token, signature: "   " }),
    ).rejects.toThrow();

    await t.mutation(api.splitSignatures.sign, { token: link.token, signature: "Producer Name" });
    await expect(
      t.mutation(api.splitSignatures.sign, { token: link.token, signature: "Again" }),
    ).rejects.toThrow();
  });

  it("a used link still resolves to the already-signed confirmation, not invalid", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });
    await t.mutation(api.splitSignatures.sign, { token: link.token, signature: "Producer Name" });

    // Re-opening the same (now revoked) link shows "you have signed".
    const revisit = await t.query(api.splitSignatures.lookup, { token: link.token });
    expect(revisit).not.toBeNull();
    expect(revisit!.alreadySigned).toBe(true);
  });

  it("a superseded link for a still-unsigned contributor stays invalid", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [first] = await t.mutation(api.splitSignatures.issue, { splitSheetId });
    await t.mutation(api.splitSignatures.issue, { splitSheetId }); // revokes the first

    expect(await t.query(api.splitSignatures.lookup, { token: first.token })).toBeNull();
  });

  it("stores a typed signature with its chosen script font", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });

    await t.mutation(api.splitSignatures.sign, {
      token: link.token, signature: "Needs To Sign",
      signatureKind: "typed", signatureFont: "great-vibes",
    });
    const sheet = await t.run(async (ctx) => ctx.db.get(splitSheetId));
    const signer = sheet!.contributors[1];
    expect(signer.signatureKind).toBe("typed");
    expect(signer.signatureFont).toBe("great-vibes");
  });

  it("stores a drawn signature as a PNG data URI and rejects junk", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });

    // Not a PNG data URI -> rejected before any lookup.
    await expect(
      t.mutation(api.splitSignatures.sign, {
        token: link.token, signature: "<svg>nope</svg>", signatureKind: "drawn",
      }),
    ).rejects.toThrow(/PNG/);

    const dataUrl = `data:image/png;base64,${"A".repeat(2000)}`;
    await t.mutation(api.splitSignatures.sign, {
      token: link.token, signature: dataUrl, signatureKind: "drawn",
    });
    const sheet = await t.run(async (ctx) => ctx.db.get(splitSheetId));
    const signer = sheet!.contributors[1];
    expect(signer.signatureKind).toBe("drawn");
    expect(signer.signature).toBe(dataUrl);
    expect(signer.signatureFont).toBeUndefined();
  });

  it("rejects an unknown typed signature style", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });
    await expect(
      t.mutation(api.splitSignatures.sign, {
        token: link.token, signature: "Name", signatureKind: "typed", signatureFont: "comic-sans",
      }),
    ).rejects.toThrow(/style/);
  });

  it("rejects an oversized drawn signature", async () => {
    const { splitSheetId } = await seedSheet(t);
    const [link] = await t.mutation(api.splitSignatures.issue, { splitSheetId });
    await expect(
      t.mutation(api.splitSignatures.sign, {
        token: link.token,
        signature: `data:image/png;base64,${"A".repeat(200_000)}`,
        signatureKind: "drawn",
      }),
    ).rejects.toThrow(/too large/);
  });
});
