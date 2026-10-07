import { action, internalAction, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { requireCapability } from "./lib/access";
import { claimFile, retireFile, type FileRef } from "./lib/media";
import { fileRefV } from "./lib/fileRef";
import { readFileBlob, storeBytes } from "./media";
import { normalizeSiteUrl, parseStudioSite, type StudioSiteInfo } from "./lib/studioSite";

/* ============================================================
   Studio-website importer - when the agency provisions a
   sub-account, paste the studio's EXISTING website and pull its
   logo + basic info (name, tagline, contact) to prefill the new
   workspace. Mirrors the song importer's shape: `fetchFromSite`
   (action) does the network work and stages the logo in R2 under
   the agency's scope (the sub-account does not exist yet) without
   writing anything else; the client prefills the create dialog and
   calls `applyToOrg` after the sub-account exists, which copies the
   logo into the new studio's own scope and bucket.
   ============================================================ */

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_BYTES = 4 * 1024 * 1024;

export type StudioSiteImportResult = Omit<StudioSiteInfo, "logoCandidates"> & {
  website: string;
  /** A staged R2 mediaFiles id (a Convex storage id only on a deployment without R2). */
  logoStorageId: FileRef | null;
  logoPreviewUrl: string | null;
};

/** Capability gate for the action - actions cannot touch ctx.db directly.
 *  Fetching happens while CREATING a sub-account, so that is the cap. */
export const access = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ scope: string | null }> => {
    const viewer = await requireCapability(ctx, "agency.subaccount.create");
    return { scope: "agencyId" in viewer && viewer.agencyId ? `agency:${viewer.agencyId}` : null };
  },
});

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Pulse-StudioOS/1.0 (https://studiopulse.tech)",
        Accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Store the first logo candidate that resolves to a real image. */
async function storeLogo(
  ctx: ActionCtx,
  scope: string,
  candidates: string[],
): Promise<FileRef | null> {
  for (const url of candidates.slice(0, 4)) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!/image\//i.test(type)) continue;
      const blob = await res.blob();
      if (blob.size < 64 || blob.size > MAX_LOGO_BYTES) continue;
      return await storeBytes(ctx, { scope, purpose: "logo", blob, fileName: "site-logo", mimeType: type, actor: "studio-import" });
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
    const { scope } = await ctx.runQuery(internal.studioImport.access, {});

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
    const logoStorageId = scope ? await storeLogo(ctx, scope, info.logoCandidates) : null;

    return {
      name: info.name,
      tagline: info.tagline,
      email: info.email,
      phone: info.phone,
      address: info.address,
      website: finalUrl,
      logoStorageId,
      logoPreviewUrl: logoStorageId ? await ctx.runQuery(internal.media._fileUrl, { ref: logoStorageId }) : null,
    };
  },
});

/** Apply imported branding/info to a freshly created sub-account. Gated by
 *  the same per-org agency capability as the other subaccount management
 *  mutations - the org must belong to the caller's agency. */
const HEX = /^#[0-9a-fA-F]{6}$/;
const STOCK_ACCENT = "#fdb913";

export const applyToOrg = mutation({
  args: {
    orgId: v.string(),
    logoStorageId: v.optional(fileRefV),
    tagline: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
    // Brand colors the client extracted from the imported logo
    // (lib/brand-theme extractBrandFromImage - canvas is browser-only).
    accentColor: v.optional(v.string()),
    brandPalette: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    { orgId, logoStorageId, tagline, email, phone, address, website, accentColor, brandPalette },
  ) => {
    await requireCapability(ctx, "agency.subaccount.pause", { orgId });
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("Subaccount not found");

    const patch: Record<string, unknown> = {};
    let logoQueued = false;
    const stagedId = logoStorageId ? ctx.db.normalizeId("mediaFiles", logoStorageId) : null;
    if (stagedId) {
      // Staged by fetchFromSite under the agency's scope, or already this studio's.
      const row = await ctx.db.get(stagedId);
      const agencyScope = org.agencyId ? `agency:${org.agencyId}` : null;
      if (!row || row.status !== "ready" || (row.orgId !== orgId && row.orgId !== agencyScope)) throw new Error("Upload not found.");
      if (row.orgId === orgId) {
        await claimFile(ctx, stagedId, orgId);
        patch.logoId = stagedId;
      } else {
        // Copy it into the studio's own scope (and bucket), then drop the staged copy.
        await ctx.db.patch(stagedId, { attachedAt: Date.now() });
        await ctx.scheduler.runAfter(0, internal.studioImport._adoptLogo, { orgId, mediaId: stagedId });
        logoQueued = true;
      }
    } else if (logoStorageId) {
      patch.logoId = logoStorageId;
    }
    if (tagline && !org.tagline) patch.tagline = tagline;
    if (accentColor) {
      if (!HEX.test(accentColor)) throw new Error("Invalid accent color.");
      if (brandPalette && (brandPalette.length > 6 || brandPalette.some((p) => !HEX.test(p)))) {
        throw new Error("Invalid palette.");
      }
      // Same rule as the white-label engine: stock gold = no explicit choice
      // yet, safe to theme from the logo; a chosen accent is never clobbered.
      const stock = !org.accentColor || org.accentColor.toLowerCase() === STOCK_ACCENT;
      if (stock) {
        patch.accentColor = accentColor;
        if (brandPalette?.length) patch.brandPalette = brandPalette;
      }
    }
    if (email || phone || address || website) {
      patch.contact = {
        ...(org.contact ?? {}),
        ...(email ? { contactEmail: email } : {}),
        ...(phone ? { phone } : {}),
        ...(address ? { address } : {}),
        ...(website ? { website } : {}),
      };
    }
    if (Object.keys(patch).length === 0) return { applied: logoQueued };
    const previousLogo = org.logoId;
    await ctx.db.patch(org._id, patch);
    if (patch.logoId) await retireFile(ctx, previousLogo, patch.logoId as FileRef);
    return { applied: true };
  },
});

/** Copies a logo staged under the agency into the new studio's own R2 scope. */
export const _adoptLogo = internalAction({
  args: { orgId: v.string(), mediaId: v.id("mediaFiles") },
  handler: async (ctx, { orgId, mediaId }): Promise<boolean> => {
    const staged = await ctx.runQuery(internal.media._row, { mediaId });
    if (!staged) return false;
    const blob = await readFileBlob(ctx, mediaId);
    if (!blob) return false;
    const ref = await storeBytes(ctx, { scope: orgId, purpose: "logo", blob, fileName: staged.fileName, mimeType: staged.mimeType, actor: "studio-import", noFallback: true });
    await ctx.runMutation(internal.studioImport._setLogo, { orgId, ref });
    await ctx.runMutation(internal.media._discard, { mediaId });
    return true;
  },
});

export const _setLogo = internalMutation({
  args: { orgId: v.string(), ref: fileRefV },
  handler: async (ctx, { orgId, ref }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    await claimFile(ctx, ref, orgId);
    const previous = org.logoId;
    await ctx.db.patch(org._id, { logoId: ref });
    await retireFile(ctx, previous, ref);
    return null;
  },
});
