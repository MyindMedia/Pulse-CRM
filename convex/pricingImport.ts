import { internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";

/* ============================================================
   Load a studio's brochure into its price list.

   Onboarding a studio means retyping its whole rate card - ten memberships,
   five bundles, a dozen add-ons - into three different screens. Done by hand
   that is where a $2,400 podcast residency quietly becomes $2,000, where a
   20-hour tier ships with 15, and where nobody notices until a member's card
   is charged the wrong number. The numbers arrive as one payload here
   instead, so they can be read back against the PDF before anything is
   written.

   Two properties make it safe to run against a live account:

     Dry by default. No `apply` means it reads, diffs and reports. The
     operator checks the diff against the brochure, THEN applies.

     Idempotent by name. A second run patches the row it made the first
     time rather than adding a second "Podcast Bundle". Brochures get
     corrected mid-onboarding; re-running has to be the cheap move, not
     the one that doubles the price list.

   Matching is case-insensitive and whitespace-insensitive, because a
   brochure that says "PODCAST BUNDLE" in a header and "Podcast bundle" in
   a table is describing one product, and treating those as two is the same
   duplicate bug wearing a hat.

   What it will not do is delete. Rows already in the account that the
   brochure does not mention come back under `stale` for a human to judge -
   an old tier someone is still subscribed to is not garbage, and the import
   has no way to tell the difference.

   Internal only. Nothing here can be reached from a browser.
   ============================================================ */

const membershipInput = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  priceCents: v.number(),
  billingInterval: v.optional(v.union(v.literal("month"), v.literal("year"))),
  bundledHoursPerPeriod: v.optional(v.number()),
  memberDiscountPct: v.optional(v.number()),
  priorityBooking: v.optional(v.boolean()),
});

const packageInput = v.object({
  name: v.string(),
  hours: v.number(),
  priceCents: v.number(),
  description: v.optional(v.string()),
});

const addOnInput = v.object({
  label: v.string(),
  amountCents: v.number(),
  description: v.optional(v.string()),
});

/** The key two names are the same product under. */
function key(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanText(s: string | undefined) {
  const t = s?.trim();
  return t ? t : undefined;
}

/** Money and hours arrive from a human reading a PDF, so check them here
 *  rather than discovering a NaN in someone's invoice total later. */
function positive(value: number, what: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError(`${what} must be a positive number, got ${value}`);
  }
  return Math.round(value);
}

async function orgOrThrow(ctx: MutationCtx, orgId: string) {
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (!org) throw new ConvexError(`No studio with orgId ${orgId}`);
  return org;
}

type Item = {
  table: string;
  name: string;
  action: "create" | "update" | "unchanged";
  /** On an update, only what actually moves - this is the line the operator
   *  reads against the brochure. */
  changes?: Record<string, { from: unknown; to: unknown }>;
};

/** Fields the caller supplied that differ from what is stored. A field the
 *  caller left out is a field the brochure is silent on, and silence is not
 *  an instruction to erase it. */
function changedFields(row: Record<string, unknown>, next: Record<string, unknown>) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, value] of Object.entries(next)) {
    if (value === undefined) continue;
    if (row[field] !== value) changes[field] = { from: row[field], to: value };
  }
  return changes;
}

/** A `changes` map is built for the operator to read; Convex wants the plain
 *  field values. One place converts between the two. */
function patchFrom(changes: Record<string, { from: unknown; to: unknown }>) {
  const patch: Record<string, unknown> = {};
  for (const [field, move] of Object.entries(changes)) patch[field] = move.to;
  return patch as never;
}

export const _importPricing = internalMutation({
  args: {
    orgId: v.string(),
    apply: v.optional(v.boolean()),
    memberships: v.optional(v.array(membershipInput)),
    packages: v.optional(v.array(packageInput)),
    addOns: v.optional(v.array(addOnInput)),
  },
  handler: async (ctx, args) => {
    const org = await orgOrThrow(ctx, args.orgId);
    const orgId = args.orgId;
    const apply = Boolean(args.apply);
    const now = Date.now();

    const items: Item[] = [];
    /** Names the brochure claims, per table - anything left in the account
     *  outside this set is reported, never touched. */
    const claimed: Record<string, Set<string>> = {
      membershipPlans: new Set(),
      packageProducts: new Set(),
      feeTemplates: new Set(),
    };

    /* One payload should never name the same product twice. If it does, the
       transcription is wrong and the last line silently wins - exactly the
       failure this function exists to stop, so it stops here instead. */
    function claim(table: string, name: string) {
      const k = key(name);
      if (!k) throw new ConvexError(`${table}: every row needs a name`);
      if (claimed[table].has(k)) {
        throw new ConvexError(`${table}: "${name}" appears twice in the import`);
      }
      claimed[table].add(k);
      return k;
    }

    // ── Memberships ──────────────────────────────────────────────
    const existingPlans = await ctx.db
      .query("membershipPlans")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    for (const plan of args.memberships ?? []) {
      const k = claim("membershipPlans", plan.name);
      const name = plan.name.trim().replace(/\s+/g, " ");
      const fields = {
        name, // the brochure's own casing wins over whatever was typed before
        description: cleanText(plan.description),
        priceCents: positive(plan.priceCents, `${name} price`),
        billingInterval: plan.billingInterval ?? ("month" as const),
        bundledHoursPerPeriod: plan.bundledHoursPerPeriod,
        memberDiscountPct: plan.memberDiscountPct,
        priorityBooking: plan.priorityBooking,
        /* A tier printed in the current brochure is on sale, whatever the
           account said before. Re-importing is how a studio turns a
           retired tier back on. */
        active: true,
      };

      const match = existingPlans
        .filter((row) => key(row.name) === k)
        .sort((a, b) => a._creationTime - b._creationTime)[0];

      if (!match) {
        items.push({ table: "membershipPlans", name, action: "create" });
        if (apply) {
          await ctx.db.insert("membershipPlans", { orgId, createdAt: now, ...fields });
        }
        continue;
      }

      const changes = changedFields(match as unknown as Record<string, unknown>, fields);
      if (Object.keys(changes).length === 0) {
        items.push({ table: "membershipPlans", name, action: "unchanged" });
        continue;
      }
      items.push({ table: "membershipPlans", name, action: "update", changes });
      if (apply) await ctx.db.patch(match._id, patchFrom(changes));
    }

    // ── Hour-block packages and bundles ──────────────────────────
    const existingPackages = await ctx.db
      .query("packageProducts")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    for (const pkg of args.packages ?? []) {
      const k = claim("packageProducts", pkg.name);
      const name = pkg.name.trim().replace(/\s+/g, " ");
      const fields = {
        name,
        hours: positive(pkg.hours, `${name} hours`),
        priceCents: positive(pkg.priceCents, `${name} price`),
        description: cleanText(pkg.description),
        active: true,
      };

      const match = existingPackages
        .filter((row) => key(row.name) === k)
        .sort((a, b) => a._creationTime - b._creationTime)[0];

      if (!match) {
        items.push({ table: "packageProducts", name, action: "create" });
        if (apply) await ctx.db.insert("packageProducts", { orgId, ...fields });
        continue;
      }

      const changes = changedFields(match as unknown as Record<string, unknown>, fields);
      if (Object.keys(changes).length === 0) {
        items.push({ table: "packageProducts", name, action: "unchanged" });
        continue;
      }
      items.push({ table: "packageProducts", name, action: "update", changes });
      if (apply) await ctx.db.patch(match._id, patchFrom(changes));
    }

    // ── Add-ons, stored as reusable invoice fees ─────────────────
    const existingFees = await ctx.db
      .query("feeTemplates")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    for (const fee of args.addOns ?? []) {
      const k = claim("feeTemplates", fee.label);
      const label = fee.label.trim().replace(/\s+/g, " ");
      const fields = {
        label,
        amountCents: positive(fee.amountCents, `${label} amount`),
        description: cleanText(fee.description),
        active: true,
      };

      const match = existingFees
        .filter((row) => key(row.label) === k)
        .sort((a, b) => a._creationTime - b._creationTime)[0];

      if (!match) {
        items.push({ table: "feeTemplates", name: label, action: "create" });
        if (apply) await ctx.db.insert("feeTemplates", { orgId, createdAt: now, ...fields });
        continue;
      }

      const changes = changedFields(match as unknown as Record<string, unknown>, fields);
      if (Object.keys(changes).length === 0) {
        items.push({ table: "feeTemplates", name: label, action: "unchanged" });
        continue;
      }
      items.push({ table: "feeTemplates", name: label, action: "update", changes });
      if (apply) await ctx.db.patch(match._id, patchFrom(changes));
    }

    /* Rows the account already had that this brochure never mentions. Not an
       error and not deleted - a studio can have a legacy tier with a live
       subscriber on it. Surfaced so the operator can retire it deliberately
       rather than leaving two prices for one product on the booking page. */
    const stale = [
      ...(args.memberships
        ? existingPlans
            .filter((r) => !claimed.membershipPlans.has(key(r.name)))
            .map((r) => ({ table: "membershipPlans", name: r.name, cents: r.priceCents, active: r.active }))
        : []),
      ...(args.packages
        ? existingPackages
            .filter((r) => !claimed.packageProducts.has(key(r.name)))
            .map((r) => ({ table: "packageProducts", name: r.name, cents: r.priceCents, active: r.active }))
        : []),
      ...(args.addOns
        ? existingFees
            .filter((r) => !claimed.feeTemplates.has(key(r.label)))
            .map((r) => ({ table: "feeTemplates", name: r.label, cents: r.amountCents, active: r.active }))
        : []),
    ];

    const created = items.filter((i) => i.action === "create").length;
    const updated = items.filter((i) => i.action === "update").length;
    const unchanged = items.filter((i) => i.action === "unchanged").length;

    if (apply && created + updated > 0) {
      await ctx.db.insert("activity", {
        orgId,
        kind: "pricing.imported",
        summary: `Price list imported: ${created} added, ${updated} updated`,
        accent: "gold",
      });
    }

    return { applied: apply, studio: org.name, created, updated, unchanged, items, stale };
  },
});
