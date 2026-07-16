import { action, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCapability } from "./lib/access";
import { normalizeSiteUrl, parseStudioSite, type StudioSiteInfo } from "./lib/studioSite";

/* ============================================================
   Studio-website importer - when the agency provisions a
   sub-account, paste the studio's EXISTING website and pull its
   logo + basic info (name, tagline, contact) to prefill the new
   workspace. Mirrors the song importer's shape: `fetchFromSite`
   (action) does the network work and stores the logo into
   _storage without writing anything else; the client prefills
   the create dialog and calls `applyToOrg` after the sub-account
   exists.
   ============================================================ */

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_BYTES = 4 * 1024 * 1024;

export type StudioSiteImportResult = Omit<StudioSiteInfo, "logoCandidates"> & {
  website: string;
  logoStorageId: Id<"_storage"> | null;
  logoPreviewUrl: string | null;
};

/** Capability gate for the action - actions cannot touch ctx.db directly.
 *  Fetching happens while CREATING a sub-account, so that is the cap. */
export const access = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "agency.subaccount.create");
    return true;
  },
});

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Pulse-StudioOS/1.0 (https://pulse.myindsound.com)",
        Accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Store the first logo candidate that resolves to a real image. */
async function storeLogo(
  ctx: { storage: { store: (b: Blob) => Promise<Id<"_storage">> } },
  candidates: string[],
): Promise<Id<"_storage"> | null> {
  for (const url of candidates.slice(0, 4)) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!/image\//i.test(type)) continue;
      const blob = await res.blob();
      if (blob.size < 64 || blob.size > MAX_LOGO_BYTES) continue;
      return await ctx.storage.store(blob);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** Fetch a studio's existing website and extract logo + basic info. Network
 *  and parse failures degrade gracefully - every field is best-effort. */
export const fetchFromSite = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<StudioSiteImportResult> => {
    await ctx.runQuery(internal.studioImport.access, {});

    const site = normalizeSiteUrl(url);
    if (!site) throw new Error("Enter the studio's website address, like studioname.com");

    let html = "";
    let finalUrl = site;
    try {
      const res = await fetchWithTimeout(site);
      if (!res.ok) throw new Error(`The site responded with ${res.status}.`);
      finalUrl = res.url || site; // follow redirects for relative-URL resolution
      html = (await res.text()).slice(0, MAX_HTML_BYTES);
    } catch (e) {
      throw new Error(
        e instanceof Error && /responded with/.test(e.message)
          ? e.message
          : "Could not reach that website. Check the address and try again.",
      );
    }

    const info = parseStudioSite(html, finalUrl);
    const logoStorageId = await storeLogo(ctx, info.logoCandidates);

    return {
      name: info.name,
      tagline: info.tagline,
      email: info.email,
      phone: info.phone,
      address: info.address,
      website: finalUrl,
      logoStorageId,
      logoPreviewUrl: logoStorageId ? await ctx.storage.getUrl(logoStorageId) : null,
    };
  },
});

/** Apply imported branding/info to a freshly created sub-account. Gated by
 *  the same per-org agency capability as the other subaccount management
 *  mutations - the org must belong to the caller's agency. */
export const applyToOrg = mutation({
  args: {
    orgId: v.string(),
    logoStorageId: v.optional(v.id("_storage")),
    tagline: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, logoStorageId, tagline, email, phone, address, website }) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Subaccount not found");

    const patch: Record<string, unknown> = {};
    if (logoStorageId) patch.logoId = logoStorageId;
    if (tagline && !org.tagline) patch.tagline = tagline;
    if (email || phone || address || website) {
      patch.contact = {
        ...(org.contact ?? {}),
        ...(email ? { contactEmail: email } : {}),
        ...(phone ? { phone } : {}),
        ...(address ? { address } : {}),
        ...(website ? { website } : {}),
      };
    }
    if (Object.keys(patch).length === 0) return { applied: false };
    await ctx.db.patch(org._id, patch);
    return { applied: true };
  },
});
