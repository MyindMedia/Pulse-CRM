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
      agencyId: "ag1", name: "ThaMyind", slug: "myind", plan: "label",
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
    // XXXX-XXXX-XXXX from a 32-symbol alphabet with no ambiguous characters.
    expect(a.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("gives two invitees different codes, and does not derive them from the email", async () => {
    const t = convexTest(schema);
    await agency(t);
    const codes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const r = await t.mutation(internal.betaAccess._create, {
        agencyId: "ag1", email: `person${i}@example.com`,
      });
      codes.add(r.code);
    }
    // Every invitee gets their own code: a shared code would make every
    // "who opened it" answer meaningless and let one leak admit everybody.
    expect(codes.size).toBe(12);
  });

  it("does not produce the same code twice for the same inputs", async () => {
    const t = convexTest(schema);
    await agency(t);
    // The old generator was seeded from (timestamp, email), so the same
    // person invited at the same instant got a predictable code. Real
    // entropy means two agencies inviting the same address never collide.
    const a = await t.mutation(internal.betaAccess._create, {
      agencyId: "ag1", email: "same@example.com",
    });
    const b = await t.mutation(internal.betaAccess._create, {
      agencyId: "ag2", email: "same@example.com",
    });
    expect(a.code).not.toBe(b.code);
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

describe("claiming produces a workspace the owner can actually open", () => {
  it("returns an account-creation token, so the Clerk user gets linked", async () => {
    const t = convexTest(schema);
    await agency(t);
    await seedInvite(t, { status: "signed", signedName: "Ari", signedAt: Date.now() });

    const res = await t.action(api.betaAccess.claim, {
      code: "ABCDE-FGHJK", studioName: "Vault Studios", slug: "vault-studios",
    });
    expect(res.slug).toBe("vault-studios");
    // Without this the owner lands in a studio the access engine cannot match
    // them to, and every query throws.
    expect(res.inviteToken).toBeTruthy();

    const invite = (await t.run((ctx) => ctx.db.query("invites").collect()))[0];
    expect(invite.orgId).toBe(res.orgId);
    expect(invite.email).toBe("ari@example.com");
    expect(invite.role).toBe("owner");
  });

  it("seeds the owner's member row against the email the link will match on", async () => {
    const t = convexTest(schema);
    await agency(t);
    await seedInvite(t, { status: "signed", signedName: "Ari", signedAt: Date.now() });
    const res = await t.action(api.betaAccess.claim, {
      code: "ABCDE-FGHJK", studioName: "Vault", slug: "vault",
    });
    const member = (await t.run((ctx) => ctx.db.query("members").collect()))
      .find((m) => m.orgId === res.orgId)!;
    // invites.markAccepted matches on (orgId, email), so both must be present.
    expect(member.email).toBe("ari@example.com");
    expect(member.role).toBe("owner");
    expect(member.clerkUserId).toBeUndefined();
  });
});

describe("linkMe recovery", () => {
  async function strandedOwner(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "beta_vault", name: "Vault", slug: "vault", plan: "studio",
        tier: "pro", status: "setup", betaCohort: true,
      });
      await ctx.db.insert("members", {
        orgId: "beta_vault", name: "Ari", email: "ari@example.com",
        role: "owner", skills: [],
      });
    });
  }

  it("attaches a signed-in owner to the seat waiting for them", async () => {
    const t = convexTest(schema);
    await strandedOwner(t);
    const asAri = t.withIdentity({ subject: "user_ari", email: "ari@example.com" });
    const res = await asAri.mutation(api.betaAccess.linkMe, {});
    expect(res).toMatchObject({ linked: true, orgId: "beta_vault" });

    const member = (await t.run((ctx) => ctx.db.query("members").collect()))[0];
    expect(member.clerkUserId).toBe("user_ari");
  });

  it("matches on the caller's own email, and nobody else's", async () => {
    const t = convexTest(schema);
    await strandedOwner(t);
    const someoneElse = t.withIdentity({ subject: "user_x", email: "x@example.com" });
    expect(await someoneElse.mutation(api.betaAccess.linkMe, {}))
      .toMatchObject({ linked: false, reason: "nothing_waiting" });
  });

  it("never takes over a seat that is already linked", async () => {
    const t = convexTest(schema);
    await strandedOwner(t);
    await t.run(async (ctx) => {
      const m = (await ctx.db.query("members").collect())[0];
      await ctx.db.patch(m._id, { clerkUserId: "user_original" });
    });
    const attacker = t.withIdentity({ subject: "user_attacker", email: "ari@example.com" });
    expect(await attacker.mutation(api.betaAccess.linkMe, {}))
      .toMatchObject({ linked: false });
    const member = (await t.run((ctx) => ctx.db.query("members").collect()))[0];
    expect(member.clerkUserId).toBe("user_original");
  });

  it("only repairs beta workspaces", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_normal", name: "Normal", slug: "normal", plan: "studio",
      });
      await ctx.db.insert("members", {
        orgId: "org_normal", name: "Ari", email: "ari@example.com", role: "owner", skills: [],
      });
    });
    const asAri = t.withIdentity({ subject: "user_ari", email: "ari@example.com" });
    expect(await asAri.mutation(api.betaAccess.linkMe, {}))
      .toMatchObject({ linked: false, reason: "not_beta" });
  });
});

/* A studio staged by the agency has a workspace but no login for its owner,
   and the link that creates one is a different link. The signature page used
   to send them to /welcome, which is behind the sign-in wall: a dead end at
   the exact moment they had just signed. */
describe("a signed owner with no login yet", () => {
  async function stagedStudio(t: ReturnType<typeof convexTest>, inviteOver: Record<string, unknown> = {}) {
    await agency(t);
    await seedInvite(t, {
      signedAt: Date.now(),
      signedName: "OT",
      claimedOrgId: "staged-playback",
      claimedSlug: "playback",
      status: "claimed",
    });
    await t.run((ctx) =>
      ctx.db.insert("invites", {
        orgId: "staged-playback",
        agencyId: "ag1",
        email: "ari@example.com",
        ownerName: "OT",
        studioName: "Playback",
        role: "owner",
        token: "tok_playback",
        status: "pending",
        expiresAt: Date.now() + 86_400_000,
        invitedBy: "u_ag",
        emailStatus: "sent",
        ...inviteOver,
      } as never),
    );
  }

  it("is handed the invite that creates the login", async () => {
    const t = convexTest(schema);
    await stagedStudio(t);
    const data = await t.query(api.betaAccess.preview, { code: "ABCDE-FGHJK" });
    expect(data.unlocked).toBe(true);
    if (!data.unlocked) return;
    expect(data.ownerInviteToken).toBe("tok_playback");
  });

  it("is not handed a spent or expired one", async () => {
    for (const over of [{ status: "accepted" }, { expiresAt: Date.now() - 1000 }]) {
      const t = convexTest(schema);
      await stagedStudio(t, over);
      const data = await t.query(api.betaAccess.preview, { code: "ABCDE-FGHJK" });
      if (!data.unlocked) throw new Error("should be unlocked");
      expect(data.ownerInviteToken).toBeNull();
    }
  });

  it("is not handed a staff invite - it creates the wrong kind of account", async () => {
    const t = convexTest(schema);
    await stagedStudio(t, { role: "engineer" });
    const data = await t.query(api.betaAccess.preview, { code: "ABCDE-FGHJK" });
    if (!data.unlocked) throw new Error("should be unlocked");
    expect(data.ownerInviteToken).toBeNull();
  });
});
