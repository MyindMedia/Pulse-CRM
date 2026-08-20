import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { NDA_TERMS_HASH, NDA_VERSION, hashTerms, ndaCanonicalText } from "./lib/betaNda";
import { betaInviteHtml, betaInviteSubject } from "./lib/emailTemplates/betaInvite";

/* A signature record that nobody can verify is a decorative checkbox. These
   tests hold the two things that make it real: the gate is checked on the
   server, and the signature is bound to the exact terms that were shown. */

async function agency(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "ag1", name: "Myind Sound", slug: "myind", plan: "label",
      status: "active", ownerClerkUserId: "u_ag", ownerEmail: "ag@example.com",
    });
    await ctx.db.insert("agencyMembers", {
      agencyId: "ag1", clerkUserId: "u_ag", name: "Lawrence",
      email: "ag@example.com", role: "owner", status: "active", invitedAt: Date.now(),
    } as never);
  });
}

async function seedInvite(
  t: ReturnType<typeof convexTest>,
  over: Record<string, unknown> = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("betaInvites", {
      agencyId: "ag1",
      email: "ari@example.com",
      name: "Ari",
      company: "Vault Studios",
      code: "ABCDE-FGHJK",
      status: "sent",
      ndaVersion: NDA_VERSION,
      viewCount: 0,
      createdAt: Date.now(),
      ...over,
    } as never),
  );
}

describe("the agreement", () => {
  it("hashes its own canonical text, and the hash moves when the text does", () => {
    expect(hashTerms(ndaCanonicalText())).toBe(NDA_TERMS_HASH);
    expect(hashTerms(ndaCanonicalText() + " and one more thing")).not.toBe(NDA_TERMS_HASH);
  });

  it("is served with every clause the signer has to see", async () => {
    const t = convexTest(schema);
    const terms = await t.query(api.betaAccess.terms, {});
    expect(terms.version).toBe(NDA_VERSION);
    expect(terms.hash).toBe(NDA_TERMS_HASH);
    expect(terms.clauses.length).toBeGreaterThanOrEqual(8);
    const headings = terms.clauses.map((c) => c.heading);
    expect(headings).toContain("What is confidential");
    expect(headings).toContain("How long this lasts");
    // The carve-outs are what make it signable rather than absurd.
    expect(headings).toContain("The usual carve-outs");
  });
});

describe("the gate", () => {
  it("accepts a good code and reports it unsigned", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    const res = await t.query(api.betaAccess.check, { code: "ABCDE-FGHJK" });
    expect(res).toMatchObject({ valid: true, signed: false, recipientName: "Ari" });
  });

  it("is forgiving about how the code is typed", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    // Read down a phone and typed back in lowercase with stray spaces.
    const res = await t.query(api.betaAccess.check, { code: "  abcde-fghjk " });
    expect(res.valid).toBe(true);
  });

  it("says as little as possible about a bad code", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    const res = await t.query(api.betaAccess.check, { code: "ZZZZZ-ZZZZZ" });
    expect(res).toEqual({ valid: false, reason: "unknown" });
  });

  it("refuses a revoked or expired code", async () => {
    const t = convexTest(schema);
    await seedInvite(t, { code: "AAAAA-AAAAA", status: "revoked" });
    await seedInvite(t, { code: "BBBBB-BBBBB", expiresAt: Date.now() - 1000 });
    expect((await t.query(api.betaAccess.check, { code: "AAAAA-AAAAA" })).reason).toBe("revoked");
    expect((await t.query(api.betaAccess.check, { code: "BBBBB-BBBBB" })).reason).toBe("expired");
  });
});

describe("signing", () => {
  it("records the signature and opens the gate", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    const res = await t.mutation(api.betaAccess.sign, {
      code: "ABCDE-FGHJK",
      signedName: "Ari Levine",
      signedTitle: "Owner",
      termsHash: NDA_TERMS_HASH,
    });
    expect(res.ok).toBe(true);

    const check = await t.query(api.betaAccess.check, { code: "ABCDE-FGHJK" });
    expect(check).toMatchObject({ valid: true, signed: true, signedName: "Ari Levine" });
    expect(check.signedAt).toBeTruthy();
  });

  it("refuses a signature bound to terms that have since changed", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    await expect(
      t.mutation(api.betaAccess.sign, {
        code: "ABCDE-FGHJK", signedName: "Ari Levine", termsHash: "fnv1a-deadbeef-1",
      }),
    ).rejects.toMatchObject({ data: { code: "TERMS_CHANGED" } });
  });

  it("will not take a name that is not one", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    await expect(
      t.mutation(api.betaAccess.sign, { code: "ABCDE-FGHJK", signedName: "x", termsHash: NDA_TERMS_HASH }),
    ).rejects.toMatchObject({ data: { code: "NAME_REQUIRED" } });
  });

  it("will not let a revoked code sign", async () => {
    const t = convexTest(schema);
    await seedInvite(t, { status: "revoked" });
    await expect(
      t.mutation(api.betaAccess.sign, {
        code: "ABCDE-FGHJK", signedName: "Ari Levine", termsHash: NDA_TERMS_HASH,
      }),
    ).rejects.toMatchObject({ data: { code: "REVOKED" } });
  });

  it("flags a signature captured against an older version of the terms", async () => {
    const t = convexTest(schema);
    await seedInvite(t, {
      status: "signed", signedName: "Ari", signedAt: Date.now(), ndaVersion: "2020-01-01.1",
    });
    const check = await t.query(api.betaAccess.check, { code: "ABCDE-FGHJK" });
    expect(check.staleTerms).toBe(true);
  });
});

describe("attribution", () => {
  it("counts opens and never walks a signature backwards", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    await t.mutation(api.betaAccess.recordView, { code: "ABCDE-FGHJK" });
    await t.mutation(api.betaAccess.recordView, { code: "ABCDE-FGHJK" });
    let row = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0];
    expect(row.viewCount).toBe(2);
    expect(row.status).toBe("viewed");
    expect(row.firstViewedAt).toBeTruthy();

    await t.mutation(api.betaAccess.sign, {
      code: "ABCDE-FGHJK", signedName: "Ari Levine", termsHash: NDA_TERMS_HASH,
    });
    await t.mutation(api.betaAccess.recordView, { code: "ABCDE-FGHJK" });
    row = (await t.run((ctx) => ctx.db.query("betaInvites").collect()))[0];
    expect(row.status).toBe("signed");
    expect(row.viewCount).toBe(3);
  });

  it("gives one person one code, and reuses it on a re-invite", async () => {
    const t = convexTest(schema);
    await agency(t);
    const a = await t.mutation(internal.betaAccess._create, {
      agencyId: "ag1", email: "Ari@Example.com ", name: "Ari",
    });
    const b = await t.mutation(internal.betaAccess._create, {
      agencyId: "ag1", email: "ari@example.com", name: "Ari",
    });
    expect(b.reused).toBe(true);
    expect(b.code).toBe(a.code);
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  });

  it("keeps another agency's invites out of the list", async () => {
    const t = convexTest(schema);
    await agency(t);
    await seedInvite(t, { agencyId: "ag2", code: "OTHER-CODEX" });
    await seedInvite(t);
    const asAgency = t.withIdentity({ subject: "u_ag" });
    const res = await asAgency.query(api.betaAccess.list, {});
    expect(res.items.every((i) => i.agencyId === "ag1")).toBe(true);
  });

  it("shows nothing at all to someone who is not an agency member", async () => {
    const t = convexTest(schema);
    await seedInvite(t);
    const res = await t.query(api.betaAccess.list, {});
    expect(res.items).toHaveLength(0);
  });
});

describe("the invite email", () => {
  it("prints the code as well as linking it", () => {
    // A link that dies in a corporate mail scanner still leaves them something
    // they can type.
    const html = betaInviteHtml({
      recipientName: "Ari",
      accessUrl: "https://studiopulse.tech/preview?code=ABCDE-FGHJK",
      code: "ABCDE-FGHJK",
    });
    expect(html).toContain("ABCDE-FGHJK");
    expect(html).toContain("https://studiopulse.tech/preview?code=ABCDE-FGHJK");
    expect(html).toContain("Hi Ari,");
    expect(html).toContain("#fdb913");
  });

  it("escapes a name rather than rendering it as markup", () => {
    const html = betaInviteHtml({
      recipientName: '<script>alert(1)</script>',
      accessUrl: "https://x.test", code: "AAAAA-BBBBB",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("addresses the studio in the subject when we know it", () => {
    expect(betaInviteSubject("Vault Studios")).toBe("Vault Studios, here is your early look at Pulse");
    expect(betaInviteSubject()).toBe("Your early look at Pulse");
  });
});
