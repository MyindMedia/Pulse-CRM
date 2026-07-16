import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { normalizeSiteUrl, parseStudioSite, metaTag } from "./lib/studioSite";

describe("normalizeSiteUrl", () => {
  it("adds https:// and accepts bare domains", () => {
    expect(normalizeSiteUrl("skylinesound.com")).toBe("https://skylinesound.com/");
    expect(normalizeSiteUrl("  http://a.io/studio ")).toBe("http://a.io/studio");
  });
  it("rejects non-http schemes and junk", () => {
    expect(normalizeSiteUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSiteUrl("ftp://x.com")).toBeNull();
    expect(normalizeSiteUrl("localhost")).toBeNull();
    expect(normalizeSiteUrl("")).toBeNull();
  });
});

describe("parseStudioSite", () => {
  it("prefers JSON-LD LocalBusiness over meta tags", () => {
    const html = `
      <html><head>
      <title>Skyline | Home</title>
      <meta property="og:site_name" content="Skyline OG" />
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"RecordingStudio","name":"Skyline Sound",
       "description":"Two rooms. One standard.","telephone":"+1 404 555 0100",
       "email":"book@skyline.com","logo":{"url":"/img/logo.png"},
       "address":{"@type":"PostalAddress","streetAddress":"12 Peach St","addressLocality":"Atlanta","addressRegion":"GA","postalCode":"30303"}}
      </script>
      </head><body></body></html>`;
    const info = parseStudioSite(html, "https://skyline.com/");
    expect(info.name).toBe("Skyline Sound");
    expect(info.tagline).toBe("Two rooms. One standard.");
    expect(info.phone).toBe("+1 404 555 0100");
    expect(info.email).toBe("book@skyline.com");
    expect(info.address).toBe("12 Peach St, Atlanta, GA, 30303");
    expect(info.logoCandidates[0]).toBe("https://skyline.com/img/logo.png");
  });

  it("falls back to og tags, icons, mailto/tel links and title", () => {
    const html = `
      <html><head>
      <title>Echo Studios – Recording in Austin</title>
      <meta name="description" content="Analog heart, digital brain." />
      <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png" />
      <link rel="icon" sizes="32x32" href="/favicon-32.png" />
      <meta property="og:image" content="https://cdn.echo.com/banner.jpg" />
      </head><body>
      <a href="mailto:hi@echostudios.com?subject=Booking">Email</a>
      <a href="tel:+15125550188">Call</a>
      </body></html>`;
    const info = parseStudioSite(html, "https://echostudios.com/");
    expect(info.name).toBe("Echo Studios");
    expect(info.tagline).toBe("Analog heart, digital brain.");
    expect(info.email).toBe("hi@echostudios.com");
    expect(info.phone).toBe("+15125550188");
    expect(info.logoCandidates[0]).toBe("https://echostudios.com/apple-icon.png");
    expect(info.logoCandidates).toContain("https://cdn.echo.com/banner.jpg");
  });

  it("ignores malformed JSON-LD and survives empty pages", () => {
    const html = `<script type="application/ld+json">{not json}</script>`;
    const info = parseStudioSite(html, "https://x.com/");
    expect(info.name).toBeNull();
    expect(info.logoCandidates).toEqual([]);
  });

  it("metaTag reads either attribute order", () => {
    expect(metaTag(`<meta content="A &amp; B" property="og:site_name">`, "og:site_name")).toBe("A & B");
  });
});

describe("studioImport.applyToOrg", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
  });

  async function agencyOwner(agencyId: string, user: string, subOrgId: string) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId, name: agencyId, slug: agencyId, plan: "agency", status: "active", ownerClerkUserId: user, ownerEmail: "o@x" });
      await ctx.db.insert("agencyMembers", { agencyId, clerkUserId: user, email: "o@x", name: "Owner", role: "owner", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: subOrgId, name: "Sub", slug: subOrgId, plan: "studio", status: "active", agencyId });
    });
    return t.withIdentity({ subject: user, name: "Owner" });
  }

  it("applies tagline + contact to the agency's own subaccount", async () => {
    const owner = await agencyOwner("org_ag", "u_own", "org_sub");
    const res = await owner.mutation(api.studioImport.applyToOrg, {
      orgId: "org_sub",
      tagline: "Where the record gets made.",
      email: "hi@sub.com",
      phone: "+1 404 555 0100",
      website: "https://sub.com/",
    });
    expect(res.applied).toBe(true);
    const org = await t.run(async (ctx) =>
      (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "org_sub"),
    );
    expect(org?.tagline).toBe("Where the record gets made.");
    expect(org?.contact?.contactEmail).toBe("hi@sub.com");
    expect(org?.contact?.phone).toBe("+1 404 555 0100");
    expect(org?.contact?.website).toBe("https://sub.com/");
  });

  it("never clobbers an existing tagline and rejects other agencies", async () => {
    const owner = await agencyOwner("org_ag", "u_own", "org_sub");
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "org_sub");
      await ctx.db.patch(org!._id, { tagline: "Existing voice" });
    });
    await owner.mutation(api.studioImport.applyToOrg, { orgId: "org_sub", tagline: "Scraped" });
    const org = await t.run(async (ctx) =>
      (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "org_sub"),
    );
    expect(org?.tagline).toBe("Existing voice");

    const other = await agencyOwner("org_ag2", "u_other", "org_sub2");
    await expect(
      other.mutation(api.studioImport.applyToOrg, { orgId: "org_sub", tagline: "X" }),
    ).rejects.toThrow();
  });
});
