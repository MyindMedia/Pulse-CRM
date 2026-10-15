import { query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { resolveViewer, requireCapability } from "./lib/access";
import { currentOrg, currentOrgWithCapability, currentActor } from "./lib/tenant";
import { bookingFeatures } from "./lib/roomBusy";
import { BOOKING_FEATURE_COPY, BOOKING_FEATURE_KEYS } from "./lib/bookingFeatureCopy";
import { visibleOrgs } from "./agency";

/* ============================================================
   Booking features: the four per-studio switches behind the
   hardcover booking work (orgs.bookingFeatures). Off by default,
   every plan (decision 2026-10-14, no tier gate).

   - Studio: owners and managers (branding.edit, the same gate as
     the rest of studio settings) read and flip their own switches.
   - Agency: owners, admins and scoped staff flip them for many
     studios at once (agency.subaccount.pause, the same gate and
     the same per-org scope check as agency.setFeatures).

   Every write merges: setting one switch never clears another.
   Each switch that actually changes leaves one activity entry.
   ============================================================ */

const featuresV = v.object({
  hidePricing: v.optional(v.boolean()),
  requireApproval: v.optional(v.boolean()),
  roomBlocks: v.optional(v.boolean()),
  changeApproval: v.optional(v.boolean()),
});

type FeaturePatch = {
  hidePricing?: boolean;
  requireApproval?: boolean;
  roomBlocks?: boolean;
  changeApproval?: boolean;
};

/** Bulk calls stay well inside one mutation's budget. */
const MAX_BULK_ORGS = 200;

async function orgDoc(ctx: { db: MutationCtx["db"] }, orgId: string) {
  return ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

/** Merge `patch` into the org's switches, log each real change, and return
 *  how many switches changed. Undefined fields are left alone. */
async function applyFeatures(
  ctx: MutationCtx,
  org: Doc<"orgs">,
  patch: FeaturePatch,
  actor: string,
): Promise<number> {
  const before = bookingFeatures(org);
  const changed = BOOKING_FEATURE_KEYS.filter(
    (k) => patch[k] !== undefined && patch[k] !== before[k],
  );
  if (changed.length === 0) return 0;

  const next = { ...(org.bookingFeatures ?? {}) };
  for (const k of changed) next[k] = patch[k];
  await ctx.db.patch(org._id, { bookingFeatures: next });

  for (const k of changed) {
    const on = patch[k] === true;
    await ctx.db.insert("activity", {
      orgId: org.orgId,
      kind: "settings.booking_feature",
      summary: `${BOOKING_FEATURE_COPY[k].label} turned ${on ? "on" : "off"} by ${actor}`,
      actorName: actor,
      entityType: "org",
      entityId: org.orgId,
      accent: "info",
    });
  }
  return changed.length;
}

/** The caller's studio switches. All false when unset. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    return bookingFeatures(org);
  },
});

/** Flip one or more of the caller's studio switches. Owners and managers. */
export const set = mutation({
  args: featuresV.fields,
  handler: async (ctx, patch) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await orgDoc(ctx, orgId);
    if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Studio not found." });
    const changed = await applyFeatures(ctx, org, patch, await currentActor(ctx));
    return { changed, features: bookingFeatures(await ctx.db.get(org._id)) };
  },
});

/** Every studio the agency member may manage, with its four switches.
 *  Staff see only their scoped studios; anyone without the agency
 *  sub-account capability sees nothing. */
export const agencyListBookingFeatures = query({
  args: {},
  handler: async (ctx) => {
    let viewer;
    try {
      viewer = await resolveViewer(ctx);
    } catch {
      return [];
    }
    if (viewer.kind !== "agency_member") return [];
    if (!viewer.capabilities.has("agency.subaccount.pause")) return [];
    const orgs = await visibleOrgs(ctx);
    return orgs
      .map((o) => ({
        orgId: o.orgId,
        name: o.name,
        slug: o.slug,
        status: o.status ?? "active",
        features: bookingFeatures(o),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Apply the same switches to many studios at once. Every org is checked
 *  before anything is written: one studio outside the caller's agency or
 *  staff scope refuses the whole call, so a bulk apply never half-lands. */
export const agencySetBookingFeatures = mutation({
  args: { orgIds: v.array(v.string()), features: featuresV },
  handler: async (ctx, { orgIds, features }) => {
    const ids = [...new Set(orgIds)];
    if (ids.length === 0) return { studios: 0, changed: 0 };
    if (ids.length > MAX_BULK_ORGS) {
      throw new ConvexError({
        code: "TOO_MANY",
        message: `Pick at most ${MAX_BULK_ORGS} studios at a time.`,
      });
    }

    const orgs: Doc<"orgs">[] = [];
    for (const orgId of ids) {
      await requireCapability(ctx, "agency.subaccount.pause", { orgId });
      const org = await orgDoc(ctx, orgId);
      if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Subaccount not found." });
      orgs.push(org);
    }

    const actor = `${await currentActor(ctx)} (agency)`;
    let changed = 0;
    for (const org of orgs) changed += await applyFeatures(ctx, org, features, actor);
    return { studios: orgs.length, changed };
  },
});
