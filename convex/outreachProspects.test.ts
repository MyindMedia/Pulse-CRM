import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { fetchTuning } from "./outreach/safeFetch";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (subject: string, orgId: string): Id => ({ subject, name: subject, orgId, orgType: "agency" });

const SITE = `<html><body><a href="mailto:studio@acme.com">e</a><p>(323) 760-7557</p>
<a href="https://instagram.com/acme">ig</a><a href="/contact">c</a></body></html>`;

describe("outreach prospects", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); fetchTuning.backoffMs = 0; });
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

  it("robots.txt 5xx never hard-blocks: homepage and contact pages are read, with a clear note", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["acme.com"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    const f = vi.fn(async (u: string) => u.endsWith("/robots.txt")
      ? new Response("down", { status: 503 })
      : new Response(SITE, { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", f);
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("scraped");
    expect(row.note).toMatch(/robots\.txt unreachable \(HTTP 503\), so only the homepage and contact pages were read/);
    const doc = await t.run(async (ctx) => await ctx.db.get(id));
    expect(doc?.contacts?.pages).toEqual(["https://acme.com/", "https://acme.com/contact"]);
  });

  it("a domain with no DNS record is unreachable, not blocked (thamyind.org case)", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["nope-nxdomain.org"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    const f = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); });
    vi.stubGlobal("fetch", f);
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("unreachable");
    expect(row.note).toBe("nope-nxdomain.org does not resolve (no DNS record). Check the address.");
    expect(f).toHaveBeenCalledTimes(1);
    // the operator can correct the address and read again
    await ua.mutation(api.outreachProspects.setWebsite, { id, url: "acme.com" });
    expect((await ua.query(api.outreachProspects.list, {}))!.rows[0].status).toBe("ready_to_scrape");
  });

  it("a site with no working https is read over http (slangcity.com case)", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["acme.com"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    const f = vi.fn(async (u: string) => {
      if (u.startsWith("https://")) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      if (u.endsWith("/robots.txt")) return new Response("Not Found", { status: 404 });
      return new Response(SITE, { headers: { "content-type": "text/html" } });
    });
    vi.stubGlobal("fetch", f);
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("scraped");
    expect(row.contacts?.emails[0].address).toBe("studio@acme.com");
    const doc = await t.run(async (ctx) => await ctx.db.get(id));
    expect(doc?.contacts?.pages[0]).toBe("http://acme.com/");
    expect(doc?.contacts?.emails[0].sourceUrl).toMatch(/^http:\/\/acme\.com/);
    expect(row.note).toMatch(/read over HTTP/);
  });

  it("a site that answers nothing at all is unreachable, not blocked", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["acme.com"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); }));
    await t.run(async (ctx) => { await ctx.db.patch(id, { status: "scraping" }); });
    await t.action(internal.outreachProspects._scrape, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("unreachable");
    expect(row.note).toBe("Could not read the site (Connection refused).");
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

describe("outreach CSV import", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });
  const as = (s: string, o = "org_a") => t.withIdentity(idOf(s, o) as never);
  const HEADER = "website,personalization_hook,hook_source_url,email_subject,email_body,ig_dm,followup_day3,followup_day7,followup_day14,email_generic,fit_score,priority,extra_column";

  async function seed() {
    await t.run(async (ctx) => {
      for (const [agencyId, owner] of [["org_a", "ua"], ["org_b", "ub"]]) {
        await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
        await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      }
      await ctx.db.insert("agencyMembers", { agencyId: "org_a", clerkUserId: "ustaff", email: "ustaff@x", name: "ustaff", role: "staff", status: "active", invitedAt: 0 });
    });
  }
  const prospect = (agencyId: string, site: string, extra: Record<string, unknown> = {}) => t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
    agencyId, dedupeKey: `site:${site}`, name: site, websiteUrl: `https://${site}`, source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
    contacts: { emails: [{ address: `jane@${site}`, generic: false, rank: 50, sourceUrl: `https://${site}` }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 },
    ...extra,
  }));

  it("updates matching prospects by website, never creates one, never imports an email, and reports the rest", async () => {
    await seed();
    const mix = await prospect("org_a", "mix.com");
    const ig = await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId: "org_a", dedupeKey: "ig:union", handle: "union", websiteUrl: "https://union.studio/la", source: "paste", status: "scraped", createdAt: 1, updatedAt: 1,
    }));
    await prospect("org_b", "other.com");
    const csv = [
      HEADER,
      `https://www.MIX.com/,"Saw your second live room, nice.",https://mix.com/news,Four rooms one calendar,"Custom middle.\n\nSecond paragraph.","Hey, loved the room.",Day 3 note,Day 7 note,Day 14 note,info@mix.com,8.5,high,ignored`,
      `union.studio,Hook for union,,,,,,,,,,,`,
      `notonthelist.com,x,,,,,,,,,,,`,
      `other.com,belongs to another agency,,,,,,,,,,,`,
      `,no website,,,,,,,,,,,`,
      `http://localhost,private,,,,,,,,,,,`,
      `mix.com,repeat,,,,,,,,,,,`,
    ].join("\n");
    const r = await as("ua").mutation(api.outreachProspects.importCsv, { csv });
    expect(r).toMatchObject({ matched: 2, unmatched: 2, skipped: 3 });
    expect(r.unmatchedWebsites).toEqual(["notonthelist.com", "other.com"]);
    expect(r.skippedRows.map((x) => x.reason)).toEqual(["no website", "not a public website", "website repeated in this file"]);
    const [m, u, count, other] = await t.run(async (ctx) => [
      await ctx.db.get(mix), await ctx.db.get(ig),
      (await ctx.db.query("outreachProspects").collect()).length,
      (await ctx.db.query("outreachProspects").collect()).find((x) => x.agencyId === "org_b") ?? null,
    ] as const);
    expect(m).toMatchObject({
      hook: "Saw your second live room, nice.", hookSourceUrl: "https://mix.com/news", subjectDefault: "Four rooms one calendar",
      bodyDefault: "Custom middle.\n\nSecond paragraph.", igDmDraft: "Hey, loved the room.",
      followups: { step1: "Day 3 note", step2: "Day 7 note", step3: "Day 14 note" }, fitScore: 8.5, priority: "high",
    });
    expect(m?.contacts?.emails.map((e: { address: string }) => e.address)).toEqual(["jane@mix.com"]); // email_generic never becomes a contact
    expect(JSON.stringify(m)).not.toContain("info@mix.com");
    expect(u?.hook).toBe("Hook for union");
    expect(count).toBe(3); // nothing created
    expect(other?.hook).toBeUndefined(); // another agency's prospect is never touched
  });

  it("is owner/admin only and capped at 200 rows", async () => {
    await seed();
    await expect(as("ustaff").mutation(api.outreachProspects.importCsv, { csv: `${HEADER}\nmix.com,x` })).rejects.toThrow(/owner or admin/);
    await expect(t.mutation(api.outreachProspects.importCsv, { csv: `${HEADER}\nmix.com,x` })).rejects.toThrow();
    const rows = Array.from({ length: 201 }, (_, i) => `s${i}.com,hook`).join("\n");
    await expect(as("ua").mutation(api.outreachProspects.importCsv, { csv: `website,personalization_hook\n${rows}` })).rejects.toThrow(/at most 200/);
    const ok = Array.from({ length: 200 }, (_, i) => `s${i}.com,hook`).join("\n");
    expect((await as("ua").mutation(api.outreachProspects.importCsv, { csv: `website,personalization_hook\n${ok}` })).unmatched).toBe(200);
    await expect(as("ua").mutation(api.outreachProspects.importCsv, { csv: "name,hook\nx,y" })).rejects.toThrow(/website column/);
  });

  it("a changed hook, subject, body or follow-up voids the open draft that used the old copy; blank cells keep values", async () => {
    await seed();
    const pid = await prospect("org_a", "mix.com", { hook: "Old hook.", followups: { step2: "Old day 7." } });
    const ua = as("ua");
    const step0 = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jane@mix.com", persona: "lawrence", templateKey: "lawrence_first", observation: "Old hook." });
    const step2 = await t.run(async (ctx) => await ctx.db.insert("outreachDrafts", {
      agencyId: "org_a", prospectId: pid, studio: "mix.com", recipient: "jane@mix.com", persona: "maxb", templateKey: "maxb_followup_2", signatureMode: "image",
      sequenceStep: 2, threadSubject: "s", inReplyTo: "<a@b>", references: "<a@b>", subject: "Re: s", html: "", text: "", contentHash: "h", blockers: [], status: "approved", approvedAt: Date.now(), approvedHash: "h", createdAt: 1,
    }));
    // Same values again: nothing is voided.
    let r = await ua.mutation(api.outreachProspects.importCsv, { csv: "website,personalization_hook,followup_day7\nmix.com,Old hook.,Old day 7." });
    expect(r.draftsVoided).toBe(0);
    r = await ua.mutation(api.outreachProspects.importCsv, { csv: "website,personalization_hook,followup_day7\nmix.com,New hook.," });
    expect(r.draftsVoided).toBe(1);
    expect((await t.run(async (ctx) => await ctx.db.get(step0)))?.status).toBe("superseded");
    expect((await t.run(async (ctx) => await ctx.db.get(step2)))?.status).toBe("approved");
    expect((await t.run(async (ctx) => await ctx.db.get(pid)))?.followups?.step2).toBe("Old day 7."); // blank cell kept it
    r = await ua.mutation(api.outreachProspects.importCsv, { csv: "website,followup_day7\nmix.com,New day 7." });
    expect(r.draftsVoided).toBe(1);
    expect((await t.run(async (ctx) => await ctx.db.get(step2)))?.status).toBe("superseded");
  });

  it("a studio_name column sets the greeting name and voids open drafts that used the old one", async () => {
    await seed();
    const pid = await t.run(async (ctx) => await ctx.db.insert("outreachProspects", {
      agencyId: "org_a", dedupeKey: "site:apexarts.com", websiteUrl: "https://apexarts.com", source: "paste", status: "queued", createdAt: 1, updatedAt: 1,
      contacts: { emails: [{ address: "jo@apexarts.com", generic: false, rank: 50, sourceUrl: "https://apexarts.com" }], phones: [], socials: [], booking: [], pages: [], scrapedAt: 1 },
    }));
    const ua = as("ua");
    const old = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jo@apexarts.com", persona: "lawrence", templateKey: "lawrence_first", observation: "Saw the new room." });
    const r = await ua.mutation(api.outreachProspects.importCsv, { csv: "website,studio_name\napexarts.com,Apex Arts\nother.com,https://other.com" });
    expect(r).toMatchObject({ matched: 1, draftsVoided: 1, skippedRows: [{ line: 3, reason: "studio_name is a web address, not a name" }] });
    expect((await t.run(async (ctx) => await ctx.db.get(old)))?.status).toBe("superseded");
    const id = await ua.mutation(api.outreachDrafts.prepare, { prospectId: pid, email: "jo@apexarts.com", persona: "lawrence", templateKey: "lawrence_first", observation: "Saw the new room." });
    expect((await ua.query(api.outreachDrafts.preview, { id }))?.text.split("\n\n")[0]).toBe("Hi Apex Arts team,");
  });

  it("the imported ig_dm is the DMs tab draft", async () => {
    await seed();
    const pid = await prospect("org_a", "mix.com", { handle: "mixstudio" });
    await as("ua").mutation(api.outreachProspects.importCsv, { csv: "website,ig_dm\nmix.com,Hey MIX team. Loved the new live room. Open to a quick look at Pulse OS?" });
    const { id } = await as("ua").mutation(api.outreachDms.prepare, { prospectId: pid });
    expect((await t.run(async (ctx) => await ctx.db.get(id)))?.text).toBe("Hey MIX team. Loved the new live room. Open to a quick look at Pulse OS?");
  });
});
