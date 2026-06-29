import { mutation, type MutationCtx } from "./_generated/server";
import { currentOrgWithCapability } from "./lib/tenant";
import { periodFor } from "./usage";

/* ============================================================
   Org-scoped CSV exports. Each export is a mutation (not a query)
   because it meters a "+1" against usageCounters[exports] as a
   side effect. Every export reads strictly within the caller's
   org via currentOrg(), so cross-tenant rows can never leak.
   ============================================================ */

/** RFC-4180 cell escaping: wrap in quotes + double internal quotes when needed. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV string from a header row + data rows. */
function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  return lines.join("\r\n");
}

/** Increment the org's monthly export counter by one. */
async function meterExport(ctx: MutationCtx, orgId: string): Promise<void> {
  const period = periodFor("exports");
  const existing = await ctx.db
    .query("usageCounters")
    .withIndex("by_org_period_metric", (q) =>
      q.eq("orgId", orgId).eq("period", period).eq("metric", "exports"),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { value: existing.value + 1, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("usageCounters", {
      orgId,
      period,
      metric: "exports",
      value: 1,
      updatedAt: Date.now(),
    });
  }
}

function isoDate(ms: number | undefined): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function dollars(cents: number | undefined): string {
  if (cents === undefined || cents === null) return "";
  return (cents / 100).toFixed(2);
}

export const clientsCsv = mutation({
  args: {},
  handler: async (ctx): Promise<{ filename: string; csv: string }> => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const artists = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const csv = toCsv(
      ["Name", "Type", "Status", "Email", "Phone", "Location", "Genres", "Tags", "LifetimeValueUSD", "Sessions", "Reliability", "Source", "Spotify", "Instagram"],
      artists.map((a) => [
        a.name, a.type, a.status, a.email, a.phone, a.location,
        a.genres.join("; "), a.tags.join("; "), dollars(a.lifetimeValueCents),
        a.sessionCount, a.reliability, a.source, a.spotify, a.instagram,
      ]),
    );
    await meterExport(ctx, orgId);
    return { filename: "pulse-clients.csv", csv };
  },
});

export const songsCsv = mutation({
  args: {},
  handler: async (ctx): Promise<{ filename: string; csv: string }> => {
    const orgId = await currentOrgWithCapability(ctx, "songs.read");
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const csv = toCsv(
      ["Title", "Kind", "Stage", "Genre", "BPM", "Key", "Mode", "Moods", "ISRC", "ISWC", "ReleaseDate", "RevisionsUsed", "RevisionsIncluded", "Streams"],
      songs.map((s) => [
        s.title, s.kind, s.stage, s.genre, s.bpm, s.musicalKey, s.mode,
        s.moodTags.join("; "), s.isrc, s.iswc, isoDate(s.releaseDate),
        s.revisionsUsed, s.revisionsIncluded, s.streamCount,
      ]),
    );
    await meterExport(ctx, orgId);
    return { filename: "pulse-songs.csv", csv };
  },
});

export const bookingsCsv = mutation({
  args: {},
  handler: async (ctx): Promise<{ filename: string; csv: string }> => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const csv = toCsv(
      ["Title", "Service", "Status", "Start", "End", "RateUSD", "DepositUSD", "DepositPaid", "AmountPaidUSD", "IntakeCompleted", "Source"],
      sessions.map((s) => [
        s.title, s.serviceType, s.status,
        new Date(s.startTime).toISOString(), new Date(s.endTime).toISOString(),
        dollars(s.rateCents), dollars(s.depositCents), s.depositPaid ? "yes" : "no",
        dollars(s.amountPaidCents), s.intakeCompleted ? "yes" : "no", s.source,
      ]),
    );
    await meterExport(ctx, orgId);
    return { filename: "pulse-bookings.csv", csv };
  },
});

export const invoicesCsv = mutation({
  args: {},
  handler: async (ctx): Promise<{ filename: string; csv: string }> => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.read");
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const csv = toCsv(
      ["Number", "Status", "AmountUSD", "DueDate", "PaidAt", "LineItems"],
      invoices.map((inv) => [
        inv.number, inv.status, dollars(inv.amountCents), isoDate(inv.dueDate),
        isoDate(inv.paidAt),
        inv.lineItems.map((li) => `${li.label}: ${dollars(li.amountCents)}`).join("; "),
      ]),
    );
    await meterExport(ctx, orgId);
    return { filename: "pulse-invoices.csv", csv };
  },
});

export const splitSheetsCsv = mutation({
  args: {},
  handler: async (ctx): Promise<{ filename: string; csv: string }> => {
    const orgId = await currentOrgWithCapability(ctx, "splitsheet.read");
    const sheets = await ctx.db
      .query("splitSheets")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    // One row per contributor so the split is machine-readable.
    const rows: unknown[][] = [];
    for (const sheet of sheets) {
      const song = await ctx.db.get(sheet.songId);
      for (const c of sheet.contributors) {
        rows.push([
          song?.title ?? "", sheet.status, c.name, c.role,
          c.masterPct, c.publishingPct, c.pro, c.ipi, c.email,
          c.signed ? "yes" : "no",
        ]);
      }
    }
    const csv = toCsv(
      ["Song", "SheetStatus", "Contributor", "Role", "MasterPct", "PublishingPct", "PRO", "IPI", "Email", "Signed"],
      rows,
    );
    await meterExport(ctx, orgId);
    return { filename: "pulse-split-sheets.csv", csv };
  },
});

export const activityCsv = mutation({
  args: {},
  handler: async (ctx): Promise<{ filename: string; csv: string }> => {
    const orgId = await currentOrgWithCapability(ctx, "activity.read");
    const events = await ctx.db
      .query("activity")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .collect();
    const csv = toCsv(
      ["When", "Kind", "Summary", "Actor", "EntityType", "EntityId"],
      events.map((e) => [
        new Date(e._creationTime).toISOString(), e.kind, e.summary,
        e.actorName, e.entityType, e.entityId,
      ]),
    );
    await meterExport(ctx, orgId);
    return { filename: "pulse-activity.csv", csv };
  },
});
