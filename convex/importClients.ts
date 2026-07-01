import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrgWithCapability } from "./lib/tenant";
import { normalizePhone } from "./lib/phone";

/* ============================================================
   Client CSV import - the missing counterpart to exports.ts.
   Unblocks a switcher: paste/upload their existing client list
   and upsert it into the caller's org. Dedupes by email when
   present, skips empty-name rows, tags each contact source
   "import". Strictly org-scoped via currentOrgWithCapability.
   ============================================================ */

/** Cap so one import can never sweep an unbounded payload into the DB. */
const MAX_ROWS = 1000;

const rowV = v.object({
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
});

export const importClients = mutation({
  args: { rows: v.array(rowV) },
  handler: async (
    ctx,
    { rows },
  ): Promise<{ created: number; updated: number; skipped: number }> => {
    const orgId = await currentOrgWithCapability(ctx, "artists.edit");

    const capped = rows.slice(0, MAX_ROWS);

    // Load existing artists once so dedupe-by-email is a map lookup, not an
    // N+1 query. Anything imported this batch is folded into the same map so
    // two rows sharing an email collapse to one contact.
    const existing = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const byEmail = new Map<string, (typeof existing)[number]>();
    for (const a of existing) {
      if (a.email && a.email.trim()) byEmail.set(a.email.trim().toLowerCase(), a);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const raw of capped) {
      const name = (raw.name ?? "").trim();
      if (!name) {
        skipped++;
        continue;
      }
      const email = raw.email?.trim() ? raw.email.trim() : undefined;
      const emailKey = email?.toLowerCase();
      const phone = raw.phone?.trim()
        ? (normalizePhone(raw.phone) ?? raw.phone.trim())
        : undefined;
      const notes = raw.notes?.trim() ? raw.notes.trim() : undefined;
      const tags = (raw.tags ?? []).map((t) => t.trim()).filter(Boolean);

      const match = emailKey ? byEmail.get(emailKey) : undefined;

      if (match) {
        const patch: Record<string, unknown> = { lastContactAt: Date.now() };
        patch.name = name;
        if (phone) patch.phone = phone;
        if (notes) patch.notes = notes;
        if (tags.length) {
          patch.tags = Array.from(new Set([...(match.tags ?? []), ...tags]));
        }
        await ctx.db.patch(match._id, patch);
        updated++;
      } else {
        const id = await ctx.db.insert("artists", {
          orgId,
          name,
          type: "artist",
          email,
          phone,
          genres: [],
          tags,
          status: "lead",
          source: "import",
          lifetimeValueCents: 0,
          sessionCount: 0,
          reliability: "solid",
          notes,
          lastContactAt: Date.now(),
        });
        created++;
        // Fold into the map so a later duplicate row updates instead of dupes.
        if (emailKey) {
          const inserted = await ctx.db.get(id);
          if (inserted) byEmail.set(emailKey, inserted);
        }
      }
    }

    if (created + updated > 0) {
      const total = created + updated;
      await ctx.db.insert("activity", {
        orgId,
        kind: "artist.imported",
        summary: `Imported ${total} client${total === 1 ? "" : "s"} (${created} new, ${updated} updated)`,
        entityType: "artist",
        accent: "gold",
      });
    }

    return { created, updated, skipped };
  },
});
