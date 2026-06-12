import { action, internalAction, internalQuery, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { resolveViewer } from "./lib/access";

/* ============================================================
   Staged demo accounts - the pitch machine.

   Give it a company name and (ideally) their website, and it
   builds a fully branded sub-account: scrapes the site, extracts
   identity/brand colors/rooms/rates with Gemini, imports the logo
   and room photos into Convex storage, generates the AI brand
   hero, and fills the account with demo data (demo mode ON). The
   agency pitches from the prospect's own "live-looking" account;
   when the deal closes, the demo toggle wipes the demo rows and
   the account goes live with its real configuration intact.
   ============================================================ */

const EXTRACT_MODEL = "gemini-2.5-flash";

export const _viewerAgency = internalQuery({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind !== "agency_member") return null;
    return { agencyId: viewer.agencyId };
  },
});

export const _createStagedOrg = internalMutation({
  args: {
    name: v.string(),
    slug: v.string(),
    agencyId: v.string(),
    tagline: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    brandPalette: v.optional(v.array(v.string())),
    bookingHeadline: v.optional(v.string()),
    bookingIntro: v.optional(v.string()),
    depositPolicyText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const taken = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    const slug = taken ? `${args.slug}-${String(Date.now()).slice(-4)}` : args.slug;
    const orgId = `staged-${slug}`;
    await ctx.db.insert("orgs", {
      orgId,
      name: args.name,
      slug,
      plan: "studio",
      status: "active",
      agencyId: args.agencyId,
      createdByAgency: true,
      tier: "studio",
      tagline: args.tagline,
      accentColor: args.accentColor,
      brandPalette: args.brandPalette,
      bookingHeadline: args.bookingHeadline,
      bookingIntro: args.bookingIntro,
      depositPolicyText: args.depositPolicyText,
    });
    return { orgId, slug };
  },
});

export const _setStagedLogo = internalMutation({
  args: { orgId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { orgId, storageId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (org) await ctx.db.patch(org._id, { logoId: storageId });
  },
});

export const _addStagedRoom = internalMutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    roomType: v.optional(v.string()),
    hourlyRateCents: v.optional(v.number()),
    notes: v.optional(v.string()),
    heroImageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("rooms", {
      orgId: args.orgId,
      name: args.name,
      roomType: args.roomType,
      hourlyRateCents: args.hourlyRateCents,
      status: "available",
      minimumHours: 2,
      depositPct: 30,
      bookable: true,
      notes: args.notes,
      heroImageId: args.heroImageId,
    });
  },
});

/* ── Website extraction ───────────────────────────────────────── */

type SiteBrand = {
  name?: string;
  tagline?: string;
  headline?: string;
  intro?: string;
  depositPolicy?: string;
  accentColor?: string;
  palette?: string[];
  logoUrl?: string;
  rooms?: {
    name: string;
    type?: string;
    hourlyRateUsd?: number;
    description?: string;
    photoUrls?: string[];
  }[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .slice(0, 60_000);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PulseBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Pull the homepage plus a handful of likely room/rate/about subpages. */
async function gatherSite(website: string): Promise<string | null> {
  const base = website.startsWith("http") ? website : `https://${website}`;
  const home = await fetchPage(base);
  if (!home) return null;
  const origin = new URL(base).origin;
  const links = [...home.matchAll(/href=["']([^"'#?]+)["']/gi)]
    .map((m) => m[1])
    .filter((href) => /room|studio|rate|pricing|service|about|book/i.test(href))
    .map((href) => (href.startsWith("http") ? href : `${origin}${href.startsWith("/") ? "" : "/"}${href}`))
    .filter((u) => u.startsWith(origin));
  const unique = [...new Set(links)].slice(0, 4);
  const pages = await Promise.all(unique.map(fetchPage));
  return [
    `<!-- PAGE: ${base} -->\n${stripHtml(home)}`,
    ...pages.filter(Boolean).map((p, i) => `<!-- PAGE: ${unique[i]} -->\n${stripHtml(p!)}`),
  ]
    .join("\n\n")
    .slice(0, 160_000);
}

async function extractBrand(siteHtml: string, fallbackName?: string): Promise<SiteBrand | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const prompt = `You are configuring a recording-studio booking platform from the studio's own website HTML below. Extract a JSON object with:
{
  "name": exact studio/business name,
  "tagline": short brand line if present,
  "headline": a booking-page headline in the studio's voice (e.g. "Book time at X"),
  "intro": 1-2 sentence booking intro in the studio's voice,
  "depositPolicy": their deposit/cancellation wording if stated (else omit),
  "accentColor": the dominant brand color as 6-digit hex (from CSS/theme/buttons; omit if truly unknown),
  "palette": up to 3 supporting brand hex colors,
  "logoUrl": ABSOLUTE url of the logo image (og:image only if it is actually a logo),
  "rooms": [{ "name": exact room name, "type": e.g. "Live room"/"Mix suite"/"Rehearsal", "hourlyRateUsd": number if listed, "description": <=160 chars from their copy, "photoUrls": up to 2 ABSOLUTE image urls clearly showing that room }]
}
Only include rooms that are actual bookable spaces. Make every URL absolute. Respond with JSON only.
${fallbackName ? `If the site is ambiguous the business is called "${fallbackName}".` : ""}

HTML:
${siteHtml}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EXTRACT_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) {
      console.error("stageDemo: extract error", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as SiteBrand;
  } catch {
    return null;
  }
}

async function importImage(
  ctx: { storage: { store: (b: Blob) => Promise<string> } },
  url: string,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PulseBot/1.0)" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 8_000_000) return null;
    return await ctx.storage.store(new Blob([buf], { type }));
  } catch {
    return null;
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The one-call pitch machine (agency console entry). */
export const stage = action({
  args: { name: v.string(), website: v.optional(v.string()) },
  handler: async (
    ctx,
    { name, website },
  ): Promise<{ orgId: string; slug: string; rooms: number; usedWebsite: boolean }> => {
    const viewer = await ctx.runQuery(internal.stageDemo._viewerAgency, {});
    if (!viewer) throw new ConvexError("Staged demos are created from the agency console.");
    return await ctx.runAction(internal.stageDemo.stageInternal, {
      name,
      website,
      agencyId: viewer.agencyId,
    });
  },
});

/** Same pipeline with an explicit agency - ops/CLI entry. */
export const stageInternal = internalAction({
  args: { name: v.string(), website: v.optional(v.string()), agencyId: v.string() },
  handler: async (
    ctx,
    { name, website, agencyId },
  ): Promise<{ orgId: string; slug: string; rooms: number; usedWebsite: boolean }> => {
    const viewer = { agencyId };

    // 1. Scrape + extract (best effort - a name alone still works).
    let brand: SiteBrand | null = null;
    if (website) {
      const site = await gatherSite(website);
      if (site) brand = await extractBrand(site, name);
    }

    const studioName = brand?.name?.trim() || name.trim();
    const slugBase = studioName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "staged-studio";

    // 2. Create the org with the extracted identity.
    const accent = brand?.accentColor && HEX.test(brand.accentColor) ? brand.accentColor : undefined;
    const palette = [
      ...(accent ? [accent] : []),
      ...(brand?.palette ?? []).filter((p) => HEX.test(p)),
    ].slice(0, 4);
    const created: { orgId: string; slug: string } = await ctx.runMutation(
      internal.stageDemo._createStagedOrg,
      {
        name: studioName,
        slug: slugBase,
        agencyId: viewer.agencyId,
        tagline: brand?.tagline,
        accentColor: accent,
        brandPalette: palette.length > 0 ? palette : undefined,
        bookingHeadline: brand?.headline ?? `Book time at ${studioName}`,
        bookingIntro: brand?.intro,
        depositPolicyText: brand?.depositPolicy,
      },
    );

    // 3. Logo -> storage.
    if (brand?.logoUrl) {
      const logoId = await importImage(ctx, brand.logoUrl);
      if (logoId) {
        await ctx.runMutation(internal.stageDemo._setStagedLogo, {
          orgId: created.orgId,
          storageId: logoId as never,
        });
      }
    }

    // 4. Rooms with their real photos.
    const rooms = (brand?.rooms ?? []).slice(0, 8);
    for (const room of rooms) {
      let heroImageId: string | null = null;
      for (const photo of room.photoUrls ?? []) {
        heroImageId = await importImage(ctx, photo);
        if (heroImageId) break;
      }
      await ctx.runMutation(internal.stageDemo._addStagedRoom, {
        orgId: created.orgId,
        name: room.name,
        roomType: room.type,
        hourlyRateCents: room.hourlyRateUsd ? Math.round(room.hourlyRateUsd * 100) : undefined,
        notes: room.description,
        heroImageId: (heroImageId as never) ?? undefined,
      });
    }

    // 5. AI brand hero + demo data, ready to pitch.
    await ctx.runAction(internal.brandHero.generate, { orgId: created.orgId });
    await ctx.runMutation(internal.demoMode.fillInternal, { orgId: created.orgId });

    return { orgId: created.orgId, slug: created.slug, rooms: rooms.length, usedWebsite: Boolean(brand) };
  },
});

/** Ops: add one room to a staged org, importing its photo from a URL. */
export const addRoomFromUrl = internalAction({
  args: {
    orgId: v.string(),
    name: v.string(),
    roomType: v.optional(v.string()),
    hourlyRateCents: v.optional(v.number()),
    notes: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const heroImageId = args.photoUrl ? await importImage(ctx, args.photoUrl) : null;
    await ctx.runMutation(internal.stageDemo._addStagedRoom, {
      orgId: args.orgId,
      name: args.name,
      roomType: args.roomType,
      hourlyRateCents: args.hourlyRateCents,
      notes: args.notes,
      heroImageId: (heroImageId as never) ?? undefined,
    });
    return { photo: Boolean(heroImageId) };
  },
});

/** Ops: patch brand fields on a staged org. */
export const _patchStagedBrand = internalMutation({
  args: {
    orgId: v.string(),
    accentColor: v.optional(v.string()),
    tagline: v.optional(v.string()),
    depositPolicyText: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, ...fields }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return;
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v2]) => v2 !== undefined));
    await ctx.db.patch(org._id, clean);
  },
});
