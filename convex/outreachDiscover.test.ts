import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

type Id = { subject: string; name: string; orgId: string; orgType: string };
const idOf = (subject: string, orgId: string): Id => ({ subject, name: subject, orgId, orgType: "agency" });

const MAPS = { output: { found: true, data: { items: [
  { name: "Union Recording Studio", website: "http://unionrecstudios.com/", emails: ["info@unionrecstudios.com"], phone: "+13236153575", phones: ["+13236153575"], category: "Recording studio", address: "5458 Santa Monica Blvd", rating: 4.8, reviewCount: 243 },
  { name: "MIX Recording Studio", website: "http://mixrecordingstudio.com/", emails: [], phones: [], category: "Recording studio" },
] } } };
const IG = { output: { users: [
  { username: "mixrecordingstudio", full_name: "MIX Recording Studio", biography: "We mix", external_url: "https://msgsndr.com/l/x", category_name: "Music Production Studio", follower_count: 39654 },
  { username: "icecreamsound", full_name: "Ice Cream Sound", biography: "Recording studio", external_url: "http://icecreamsound.com", category_name: "Recording Studio" },
  { username: "pizzaplace", full_name: "Pizza", biography: "best slices", category_name: "Restaurant" },
] } };
const CONTACT = { output: { found: true, data: { publicEmail: "studio@icecreamsound.com", emails: ["studio@icecreamsound.com"], publicPhone: "+13237607557", phones: ["+13237607557"], displayName: "Ice Cream Sound Studios" } } };

describe("outreach discovery", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); vi.stubEnv("TREG_TOKEN", "tok"); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  async function seed(agencyId: string, owner: string, staff?: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x` });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: owner, email: `${owner}@x`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      if (staff) await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: staff, email: `${staff}@x`, name: staff, role: "staff", status: "active", invitedAt: 0 });
    });
  }
  const as = (s: string, o: string) => t.withIdentity(idOf(s, o) as never);
  const stubTreg = (json: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(json), { status })));
  /** Starts a job and runs it by hand so the stubbed fetch is what answers. */
  async function runJob(ua: ReturnType<typeof as>, args: Record<string, unknown>) {
    const { jobId } = await ua.mutation(api.outreachDiscover.start, args as never);
    await t.action(internal.outreachDiscover._run, { jobId });
    return jobId;
  }

  it("only owners/admins can start; staff and anonymous are refused; list is null for outsiders", async () => {
    await seed("org_a", "ua", "ustaff");
    await expect(t.mutation(api.outreachDiscover.start, { kind: "instagram", query: "recording studio" })).rejects.toThrow();
    await expect(as("ustaff", "org_a").mutation(api.outreachDiscover.start, { kind: "instagram", query: "recording studio" })).rejects.toThrow(/owner or admin/);
    expect(await t.query(api.outreachDiscover.list, {})).toBeNull();
  });

  it("is off, with a clear message, when TREG_TOKEN is missing", async () => {
    vi.stubEnv("TREG_TOKEN", "");
    await seed("org_a", "ua");
    await expect(as("ua", "org_a").mutation(api.outreachDiscover.start, { kind: "instagram", query: "recording studio" })).rejects.toThrow(/TREG_TOKEN/);
    expect((await as("ua", "org_a").query(api.outreachDiscover.list, {}))?.enabled).toBe(false);
  });

  it("a Maps search needs a city and a sane query", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await expect(ua.mutation(api.outreachDiscover.start, { kind: "maps", query: "recording studio" })).rejects.toThrow(/city/);
    await expect(ua.mutation(api.outreachDiscover.start, { kind: "maps", query: "x", location: "LA" })).rejects.toThrow(/2 to 80/);
  });

  it("Maps results become prospects with source-attributed, published contacts and dedupe on rerun", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    stubTreg(MAPS);
    await runJob(ua, { kind: "maps", query: "recording studio", location: "Los Angeles, CA" });
    const rows = (await ua.query(api.outreachProspects.list, {}))!.rows;
    expect(rows).toHaveLength(2);
    const union = rows.find((r) => r.name === "Union Recording Studio")!;
    expect(union.source).toBe("maps");
    expect(union.status).toBe("scraped");
    expect(union.contacts?.emails[0]).toMatchObject({ address: "info@unionrecstudios.com", generic: true });
    expect(union.contacts?.emails[0].sourceUrl).toContain("unionrecstudios.com");
    expect(rows.find((r) => r.name === "MIX Recording Studio")?.status).toBe("ready_to_scrape");
    const job = (await ua.query(api.outreachDiscover.list, {}))!.rows[0];
    expect(job).toMatchObject({ status: "done", found: 2, added: 2, duplicates: 0 });

    await runJob(ua, { kind: "maps", query: "recording studio", location: "Los Angeles, CA" });
    expect((await ua.query(api.outreachProspects.list, {}))!.rows).toHaveLength(2);
    expect((await ua.query(api.outreachDiscover.list, {}))!.rows[0]).toMatchObject({ added: 0, duplicates: 2 });
  });

  it("Instagram results keep only studio-like accounts and never trust a link-in-bio page as the website", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    stubTreg(IG);
    await runJob(ua, { kind: "instagram", query: "recording studio los angeles" });
    const rows = (await ua.query(api.outreachProspects.list, {}))!.rows;
    expect(rows.map((r) => r.handle).sort()).toEqual(["icecreamsound", "mixrecordingstudio"]);
    const mix = rows.find((r) => r.handle === "mixrecordingstudio")!;
    expect(mix.status).toBe("needs_website");
    expect(mix.note).toMatch(/link-in-bio/i);
    expect(mix.websiteUrl).toBeNull();
    expect(rows.find((r) => r.handle === "icecreamsound")).toMatchObject({ status: "ready_to_scrape", websiteUrl: "http://icecreamsound.com" });
  });

  it("a treg failure marks the job failed with a short reason and adds nothing", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    stubTreg("insufficient balance", 402);
    await runJob(ua, { kind: "instagram", query: "recording studio" });
    expect((await ua.query(api.outreachDiscover.list, {}))!.rows[0]).toMatchObject({ status: "failed", error: "treg balance is empty", added: 0 });
    expect((await ua.query(api.outreachProspects.list, {}))!.rows).toHaveLength(0);
  });

  it("agencies never see each other's discoveries or prospects", async () => {
    await seed("org_a", "ua");
    await seed("org_b", "ub");
    stubTreg(IG);
    await runJob(as("ua", "org_a"), { kind: "instagram", query: "recording studio" });
    expect((await as("ub", "org_b").query(api.outreachDiscover.list, {}))!.rows).toHaveLength(0);
    expect((await as("ub", "org_b").query(api.outreachProspects.list, {}))!.rows).toHaveLength(0);
  });

  it("caps discovery requests per agency per day", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    stubTreg({ output: { users: [] } });
    for (let i = 0; i < 20; i++) await ua.mutation(api.outreachDiscover.start, { kind: "instagram", query: `studio ${i}` });
    await expect(ua.mutation(api.outreachDiscover.start, { kind: "instagram", query: "one more" })).rejects.toThrow(/Daily discovery limit/);
  });

  it("Instagram contact lookup merges the profile's own email without overwriting the site's, and is manager-only", async () => {
    await seed("org_a", "ua", "ustaff");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["@icecreamsound"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    await expect(as("ustaff", "org_a").mutation(api.outreachDiscover.findInstagramContact, { id })).rejects.toThrow(/owner or admin/);
    stubTreg(CONTACT);
    await ua.mutation(api.outreachDiscover.findInstagramContact, { id });
    await t.action(internal.outreachDiscover._igContact, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.status).toBe("scraped");
    expect(row.contacts?.emails[0]).toMatchObject({ address: "studio@icecreamsound.com", generic: true });
    expect(row.contacts?.emails[0].sourceUrl).toBe("https://www.instagram.com/icecreamsound/");
    expect(row.contacts?.phones[0].number).toBe("+13237607557");
  });

  it("a profile with nothing published leaves a note instead of inventing contacts", async () => {
    await seed("org_a", "ua");
    const ua = as("ua", "org_a");
    await ua.mutation(api.outreachProspects.add, { lines: ["@quiet"] });
    const id = (await ua.query(api.outreachProspects.list, {}))!.rows[0].id;
    stubTreg({ output: { found: true, data: {} } });
    await t.action(internal.outreachDiscover._igContact, { id });
    const row = (await ua.query(api.outreachProspects.list, {}))!.rows[0];
    expect(row.contacts).toBeNull();
    expect(row.note).toMatch(/No public email/);
  });
});
