import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (subject: string, orgId: string): Id => ({ subject, name: subject, orgId, orgType: "agency" });

const SITE = `<html><body><a href="mailto:studio@acme.com">e</a><p>(323) 760-7557</p>
<a href="https://instagram.com/acme">ig</a><a href="/contact">c</a></body></html>`;

describe("outreach prospects", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  async function seed(agencyId: string, owner: string, staff?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      if (staff) await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: staff, email: `${staff}@x`, name: staff, role: "staff", status: "active", invitedAt: 0 });
    });
  }
  const as = (s: string, o: string) => t.withIdentity(idOf(s, o) as never);
  const stubSite = (html = SITE) => vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    if (u.endsWith("/robots.txt")) return new Response("", { status: 404 });
    return new Response(html, { headers: { "content-type": "text/html" } });
  }));

  it("only owners/admins can add; anonymous and staff are refused; list is null for outsiders", async () => {
    await seed("org_a", "ua", "ustaff");
    await expect(t.mutation(api.outreachProspects.add, { lines: ["@acme"] })).rejects.toThrow();
    await expect(as("ustaff", "org_a").mutation(api.outreachProspects.add, { lines: ["@acme"] })).rejects.toThrow(/owner or admin/);
    expect(await t.query(api.outreachProspects.list, {})).toBeNull();
    const r = await as("ua", "org_a").mutation(api.outreachProspects.add, { lines: ["@acme"] });
    expect(r.added).toBe(1);
  });

  it("pasting dedupes, rejects junk, and a handle waits for a website", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    const r = await ua.mutation(api.outreachProspects.add, { lines: ["@Acme", "https://instagram.com/acme/", "acme.com", "!!bad!!", ""] });
    expect(r).toEqual({ added: 2, duplicates: 1, invalid: 1 });
    const list = await ua.query(api.outreachProspects.list, {});
    const byHandle = list?.rows.find((x) => x.handle === "acme");
    expect(byHandle?.status).toBe("needs_website");
    expect(list?.rows.find((x) => x.websiteUrl === "https://acme.com")?.status).toBe("ready_to_scrape");
  });

  it("a private or internal website is blocked at add and at setWebsite", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["http://169.254.169.254/latest", "@acme"] });
    const list = await ua.query(api.outreachProspects.list, {});
    expect(list?.rows.some((x) => x.status === "blocked")).toBe(true);
    const id = list!.rows.find((x) => x.handle === "acme")!.id;
    await expect(ua.mutation(api.outreachProspects.setWebsite, { id, url: "http://localhost" })).rejects.toThrow(/public website/);
  });

  it("scrape reads only the studio's own pages and stores published, source-attributed contacts", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["@acme"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    await ua.mutation(api.outreachProspects.setWebsite, { id, url: "acme.com", name: "Acme Sound" });
    stubSite();
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("scraped");
    expect(row.contacts?.emails[0]).toMatchObject({ address: "studio@acme.com", generic: true });
    expect(row.contacts?.emails[0].sourceUrl).toContain("acme.com");
    expect(row.contacts?.phones[0].number).toBe("(323) 760-7557");
    expect(row.contacts?.socials[0].url).toBe("https://instagram.com/acme");
  });

  it("robots.txt disallow blocks the scrape and nothing else is fetched", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["acme.com"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    const f = vi.fn(async (u: string) => u.endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /\n") : new Response(SITE));
    vi.stubGlobal("fetch", f);
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("blocked");
    expect(row.note).toMatch(/robots/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("no published email ends as no_contact, never a guessed address", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["acme.com"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    stubSite("<html><body>Nothing here</body></html>");
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("no_contact");
    expect(row.contacts?.emails).toEqual([]);
  });

  it("queueing needs a scrape and a non-suppressed address; suppression cascades", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["acme.com"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    await expect(ua.mutation(api.outreachProspects.queueForReview, { id })).rejects.toThrow(/scraped/);
    stubSite();
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    await ua.mutation(api.outreachProspects.suppressEmail, { email: "STUDIO@acme.com", reason: "opt-out" });
    await expect(ua.mutation(api.outreachProspects.queueForReview, { id })).rejects.toThrow(/suppressed/);
  });

  it("queued prospects are suppressed when their only address opts out", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["acme.com"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    stubSite();
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    await ua.mutation(api.outreachProspects.queueForReview, { id });
    expect((await ua.query(api.outreachProspects.list, {}))!.rows[0].status).toBe("queued");
    await ua.mutation(api.outreachProspects.suppressEmail, { email: "studio@acme.com", reason: "opt-out" });
    expect((await ua.query(api.outreachProspects.list, {}))!.rows[0].status).toBe("suppressed");
  });

  it("agencies cannot see or touch each other's prospects", async () => {
    await seed("org_a", "ua");
    await seed("org_b", "ub");
    await as("ua", "org_a").mutation(api.outreachProspects.add, { lines: ["@acme"] });
    const id = (await as("ua", "org_a").query(api.outreachProspects.list, {}))!.rows[0].id;
    expect((await as("ub", "org_b").query(api.outreachProspects.list, {}))!.rows).toEqual([]);
    await expect(as("ub", "org_b").mutation(api.outreachProspects.remove, { id })).rejects.toThrow(/not found/);
    await expect(as("ub", "org_b").mutation(api.outreachProspects.requestScrape, { id })).rejects.toThrow();
  });

  it("intake: off by default, bearer required, tenant comes from server config", async () => {
    await seed("org_a", "ua");
    const post = (auth: string | null, body: unknown) =>
      t.fetch("/outreach/intake", { method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post("Bearer s3cret", { handle: "@acme" })).status).toBe(503);
    vi.stubEnv("OUTREACH_INTAKE_SECRET", "s3cret");
    vi.stubEnv("OUTREACH_INTAKE_AGENCY_ID", "org_a");
    expect((await post(null, { handle: "@acme" })).status).toBe(401);
    expect((await post("Bearer wrong", { handle: "@acme" })).status).toBe(401);
    const ok = await post("Bearer s3cret", { url: "https://instagram.com/acme/", agencyId: "org_evil" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ result: "added" });
    const list = await as("ua", "org_a").query(api.outreachProspects.list, {});
    expect(list!.rows[0]).toMatchObject({ handle: "acme", source: "shortcut", status: "needs_website" });
    // a helper can later supply the website for the waiting handle
    const upd = await post("Bearer s3cret", { handle: "@acme", website: "acme.com", name: "Acme", source: "instaloader" });
    expect(await upd.json()).toEqual({ result: "updated" });
    expect((await as("ua", "org_a").query(api.outreachProspects.list, {}))!.rows[0].status).toBe("ready_to_scrape");
    expect((await post("Bearer s3cret", { handle: "!!bad!!" })).status).toBe(422);
  });
});
