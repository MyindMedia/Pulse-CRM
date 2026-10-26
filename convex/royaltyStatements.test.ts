import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { statementEmail } from "./royaltyStatements";

/* Contributor Statements: owner-only send, one private link per contributor,
   the public page shows only that contributor's shares at that studio, and
   revoked or expired links show nothing. */

const ISRC = "USABC2600001";

async function setup(enabled = true) {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "ag",
      name: "Ag",
      slug: "ag",
      plan: "max",
      status: "active",
      ownerClerkUserId: "u_ag",
      ownerEmail: "o@x",
      royaltiesEnabled: enabled,
    });
    for (const [orgId, name, owner] of [
      ["o1", "Studio One", "u_owner"],
      ["o2", "Studio Two", "u_other"],
    ] as const) {
      await ctx.db.insert("orgs", {
        orgId,
        name,
        slug: orgId,
        tier: "max",
        status: "active",
        agencyId: "ag",
      });
      await ctx.db.insert("members", {
        orgId,
        name: "Owner",
        role: "owner",
        skills: [],
        clerkUserId: owner,
      });
      const artistId = await ctx.db.insert("artists", {
        orgId,
        name: "LB",
        type: "artist",
        genres: [],
        tags: [],
        status: "active",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
      });
      const songId = await ctx.db.insert("songs", {
        orgId,
        title: `${name} Song`,
        artistId,
        isrc: ISRC,
        kind: "single",
        stage: "released",
        moodTags: [],
        referenceTracks: [],
        revisionsIncluded: 0,
        revisionsUsed: 0,
      });
      const c = (n: string, email: string, pct: number) => ({
        name: n,
        email,
        role: "Writer",
        masterPct: pct,
        publishingPct: pct,
        signed: true,
      });
      await ctx.db.insert("splitSheets", {
        orgId,
        songId,
        status: "fully_executed",
        updatedAt: 0,
        contributors: [
          c("Ana Ruiz", "ana@x.com", 60),
          c("Bo", "bo@x.com", 30),
          c("Cy", "", 10),
        ],
      });
    }
    await ctx.db.insert("members", {
      orgId: "o1",
      name: "Eng",
      role: "engineer",
      skills: [],
      clerkUserId: "u_eng",
    });
  });
  const as = (user: string, orgId = "o1") =>
    t.withIdentity({ subject: user, name: user, orgId });
  return { t, as };
}

async function statement(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  actor: string,
  cents: number,
  hash: string,
) {
  const mediaId = await t.run((ctx) =>
    ctx.db.insert("mediaFiles", {
      orgId,
      bucket: "private",
      bucketName: "b",
      key: `k/${hash}`,
      purpose: "royalty_statement",
      fileName: "dk.tsv",
      mimeType: "text/tab-separated-values",
      status: "ready",
      uploadedBy: actor,
      createdAt: Date.now(),
    }),
  );
  const statementId = await t.mutation(internal.royalties._createStatement, {
    orgId,
    actor,
    mediaId,
    fileName: "dk.tsv",
    fileHash: hash,
    source: "distrokid",
    totals: [{ currency: "USD", cents }],
    rowCount: 1,
    lineCount: 1,
  });
  await t.mutation(internal.royalties._addLines, {
    statementId,
    lines: [
      { isrc: ISRC, amountCents: cents, currency: "USD", units: 1, rows: 1 },
    ],
  });
  await t.mutation(internal.royalties._finishStatement, { statementId });
  return statementId;
}

const grants = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("collaboratorGrants").collect());

beforeEach(() => vi.stubEnv("RESEND_API_KEY", ""));
afterEach(() => vi.unstubAllEnvs());

describe("send", () => {
  it("mints one link per contributor with an email, and lists the ones without", async () => {
    const { t, as } = await setup();
    const st = await statement(t, "o1", "u_owner", 1000, "h1");
    const res = await as("u_owner").action(api.royaltyStatements.send, {
      statementId: st,
    });
    expect(res).toEqual({ sent: 2, failed: [], noEmail: ["Cy"] });
    const g = await grants(t);
    expect(g.map((x) => [x.email, x.scope, x.entityId, x.orgId])).toEqual([
      ["ana@x.com", "royalty_statement", "o1", "o1"],
      ["bo@x.com", "royalty_statement", "o1", "o1"],
    ]);
    expect(g[0].expiresAt - Date.now()).toBeGreaterThan(179 * 86_400_000);
  });

  it("replaces the old link on re-send, and can target one contributor", async () => {
    const { t, as } = await setup();
    const st = await statement(t, "o1", "u_owner", 1000, "h1");
    await as("u_owner").action(api.royaltyStatements.send, { statementId: st });
    const first = (await grants(t)).find((g) => g.email === "ana@x.com")!;
    const res = await as("u_owner").action(api.royaltyStatements.send, {
      statementId: st,
      contributorKey: "ana@x.com",
    });
    expect(res.sent).toBe(1);
    const all = await grants(t);
    expect(
      all.filter((g) => g.email === "ana@x.com" && !g.revoked),
    ).toHaveLength(1);
    expect(all.find((g) => g._id === first._id)?.revoked).toBe(true);
    expect(
      await t.query(api.royaltyStatements.view, { token: first.token }),
    ).toBeNull();
  });

  it("is owner/manager only, gated by the switch, and refuses another studio's statement", async () => {
    const { t, as } = await setup();
    const st = await statement(t, "o1", "u_owner", 1000, "h1");
    await expect(
      as("u_eng").action(api.royaltyStatements.send, { statementId: st }),
    ).rejects.toMatchObject({
      data: { code: "CAPABILITY_DENIED" },
    });
    await expect(
      as("u_other", "o2").action(api.royaltyStatements.send, {
        statementId: st,
      }),
    ).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
    // Switched off after the statement was imported: nothing goes out.
    await t.run(async (ctx) => {
      const ag = (await ctx.db.query("agencies").collect())[0];
      await ctx.db.patch(ag._id, { royaltiesEnabled: false });
    });
    await expect(
      as("u_owner").action(api.royaltyStatements.send, { statementId: st }),
    ).rejects.toMatchObject({
      data: { code: "ROYALTIES_OFF" },
    });
    expect(await grants(t)).toHaveLength(0);
  });
});

describe("view", () => {
  it("shows only that contributor's shares at that studio", async () => {
    const { t, as } = await setup();
    const st1 = await statement(t, "o1", "u_owner", 1000, "h1");
    const st2 = await statement(t, "o2", "u_other", 5000, "h2");
    await as("u_owner").action(api.royaltyStatements.send, {
      statementId: st1,
    });
    await as("u_other", "o2").action(api.royaltyStatements.send, {
      statementId: st2,
    });
    const ana1 = (await grants(t)).find(
      (g) => g.email === "ana@x.com" && g.orgId === "o1",
    )!;
    const page = await t.query(api.royaltyStatements.view, {
      token: ana1.token,
    });
    expect(page).toMatchObject({ studioName: "Studio One", name: "Ana Ruiz" });
    expect(page!.shares).toEqual([
      expect.objectContaining({
        songTitle: "Studio One Song",
        pct: 60,
        amountCents: 600,
        currency: "USD",
        paidAt: null,
      }),
    ]);
    // No other contributor's rows, no ids, no emails.
    expect(JSON.stringify(page)).not.toMatch(
      /bo@x\.com|Studio Two|_id|contributorKey/,
    );
  });

  it("returns nothing for a revoked, expired, malformed or unknown token", async () => {
    const { t, as } = await setup();
    const st = await statement(t, "o1", "u_owner", 1000, "h1");
    await as("u_owner").action(api.royaltyStatements.send, { statementId: st });
    const [ana, bo] = await grants(t);
    expect(
      await t.query(api.royaltyStatements.view, { token: ana.token }),
    ).not.toBeNull();

    expect(
      await as("u_owner").mutation(api.royaltyStatements.revoke, {
        contributorKey: "ana@x.com",
      }),
    ).toEqual({ revoked: 1 });
    expect(
      await t.query(api.royaltyStatements.view, { token: ana.token }),
    ).toBeNull();

    await t.run((ctx) => ctx.db.patch(bo._id, { expiresAt: Date.now() - 1 }));
    expect(
      await t.query(api.royaltyStatements.view, { token: bo.token }),
    ).toBeNull();

    expect(
      await t.query(api.royaltyStatements.view, { token: "not a token" }),
    ).toBeNull();
    expect(
      await t.query(api.royaltyStatements.view, { token: "a".repeat(64) }),
    ).toBeNull();
  });

  it("ignores a grant of another scope that happens to share the token shape", async () => {
    const { t } = await setup();
    const token = "b".repeat(64);
    await t.run((ctx) =>
      ctx.db.insert("collaboratorGrants", {
        orgId: "o1",
        email: "ana@x.com",
        name: "Ana",
        scope: "splitsheet",
        entityId: "o1",
        capabilities: [],
        token,
        expiresAt: Date.now() + 1e9,
        invitedBy: "u_owner",
        useCount: 0,
      }),
    );
    expect(await t.query(api.royaltyStatements.view, { token })).toBeNull();
  });

  it("revoke is owner/manager only", async () => {
    const { as } = await setup();
    await expect(
      as("u_eng").mutation(api.royaltyStatements.revoke, {
        contributorKey: "ana@x.com",
      }),
    ).rejects.toMatchObject({
      data: { code: "CAPABILITY_DENIED" },
    });
  });
});

describe("statementEmail", () => {
  it("escapes names, totals per currency, and says payment comes from the studio", () => {
    const { subject, html } = statementEmail({
      studioName: "<b>Evil</b> Studio",
      name: "Ana <script>",
      periodStart: Date.UTC(2026, 6, 1),
      periodEnd: Date.UTC(2026, 8, 30),
      lines: [
        { songTitle: "A & B", pct: 50, currency: "USD", amountCents: 1234 },
        { songTitle: "C", pct: 25, currency: "USD", amountCents: 100 },
      ],
      link: "https://studiopulse.tech/royalty/abc",
    });
    expect(subject).toBe("Your royalty statement from <b>Evil</b> Studio");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("$13.34");
    expect(html).toContain("July 2026 to September 2026");
    expect(html).toContain(
      "Payment comes from &lt;b&gt;Evil&lt;/b&gt; Studio directly",
    );
    expect(html).not.toMatch(/—/);
  });
});
