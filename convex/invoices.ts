import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { notify, notifyTeam } from "./lib/notify";
import { money } from "./lib/money";

const statusV = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("viewed"),
  v.literal("paid"),
  v.literal("overdue"),
  v.literal("void"),
);

/** Flip "sent"/"viewed" rows to "overdue" when read past their due date. */
function effectiveStatus(inv: { status: string; dueDate: number }): string {
  if ((inv.status === "sent" || inv.status === "viewed") && inv.dueDate < Date.now()) {
    return "overdue";
  }
  return inv.status;
}

const SERVICE_TO_CATEGORY: Record<string, string> = {
  recording: "Studio time",
  rehearsal: "Studio time",
  consultation: "Consultation",
  production: "Production",
  mixing: "Mixing",
  mastering: "Mastering",
  writing: "Writing",
};

/** Decide what an invoice is "for" so the table + detail can show it at
 * a glance. Prefers the linked session's serviceType; falls back to
 * keyword-scanning the line item labels. */
function deriveCategory(
  serviceType: string | undefined,
  lineItems: { label: string }[],
): string {
  if (serviceType && SERVICE_TO_CATEGORY[serviceType]) {
    return SERVICE_TO_CATEGORY[serviceType];
  }
  const labels = lineItems.map((l) => l.label.toLowerCase()).join(" ");
  if (labels.includes("license") || labels.includes("lease")) return "License";
  if (labels.includes("master")) return "Mastering";
  if (labels.includes("mixing") || labels.includes("mix ")) return "Mixing";
  if (labels.includes("production") || labels.includes("produce")) return "Production";
  if (labels.includes("writ")) return "Writing";
  if (labels.includes("studio") || labels.includes("session") || labels.includes("tracking"))
    return "Studio time";
  return "Other";
}

export const list = query({
  args: { status: v.optional(statusV) },
  handler: async (ctx, { status }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const artistIds = [...new Set(rows.map((r) => r.artistId))];
    const sessionIds = [
      ...new Set(rows.map((r) => r.sessionId).filter((id): id is NonNullable<typeof id> => Boolean(id))),
    ];
    const [artists, sessions] = await Promise.all([
      Promise.all(artistIds.map((id) => ctx.db.get(id))).then(
        (arr) => new Map(arr.filter(Boolean).map((a) => [a!._id, a!] as const)),
      ),
      Promise.all(sessionIds.map((id) => ctx.db.get(id))).then(
        (arr) => new Map(arr.filter(Boolean).map((s) => [s!._id, s!] as const)),
      ),
    ]);
    const hydrated = rows.map((r) => {
      const session = r.sessionId ? sessions.get(r.sessionId) : null;
      return {
        ...r,
        status: effectiveStatus(r),
        artistName: artists.get(r.artistId)?.name ?? "Unknown",
        category: deriveCategory(session?.serviceType, r.lineItems),
      };
    });
    const filtered = status ? hydrated.filter((r) => r.status === status) : hydrated;
    return filtered.sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const get = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const inv = await ctx.db.get(id);
    if (!inv || inv.orgId !== orgId) return null;
    const [artist, song, session] = await Promise.all([
      ctx.db.get(inv.artistId),
      inv.songId ? ctx.db.get(inv.songId) : null,
      inv.sessionId ? ctx.db.get(inv.sessionId) : null,
    ]);
    return {
      ...inv,
      status: effectiveStatus(inv),
      artist,
      songTitle: song?.title ?? null,
      sessionTitle: session?.title ?? null,
      serviceType: session?.serviceType ?? null,
      category: deriveCategory(session?.serviceType, inv.lineItems),
    };
  },
});

/** Money summary for the Payments dashboard. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let outstanding = 0;
    let overdue = 0;
    let collectedThisMonth = 0;
    let draftValue = 0;
    for (const r of rows) {
      const status = effectiveStatus(r);
      if (status === "sent" || status === "viewed") outstanding += r.amountCents;
      if (status === "overdue") {
        outstanding += r.amountCents;
        overdue += r.amountCents;
      }
      if (status === "draft") draftValue += r.amountCents;
      if (status === "paid" && r.paidAt && r.paidAt >= monthStart.getTime()) {
        collectedThisMonth += r.amountCents;
      }
    }
    return { outstanding, overdue, collectedThisMonth, draftValue, count: rows.length };
  },
});

export const create = mutation({
  args: {
    artistId: v.id("artists"),
    songId: v.optional(v.id("songs")),
    sessionId: v.optional(v.id("sessions")),
    lineItems: v.array(v.object({ label: v.string(), amountCents: v.number() })),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(args.artistId);
    if (!artist || artist.orgId !== orgId) throw new Error("Artist not found");
    const amountCents = args.lineItems.reduce((s, li) => s + li.amountCents, 0);
    const number = `PLS-${String(Date.now()).slice(-6)}`;
    const id = await ctx.db.insert("invoices", {
      orgId,
      number,
      artistId: args.artistId,
      songId: args.songId,
      sessionId: args.sessionId,
      status: "draft",
      lineItems: args.lineItems,
      amountCents,
      dueDate: args.dueDate ?? Date.now() + 14 * 86400000,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "invoice.created",
      summary: `Invoice ${number} drafted for ${artist.name}`,
      entityType: "invoice",
      entityId: id,
      accent: "info",
    });
    return id;
  },
});

export const setStatus = mutation({
  args: { id: v.id("invoices"), status: statusV },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrg(ctx);
    const inv = await ctx.db.get(id);
    if (!inv || inv.orgId !== orgId) throw new Error("Not found");

    const patch: Record<string, unknown> = { status };
    if (status === "paid") patch.paidAt = Date.now();
    await ctx.db.patch(id, patch);

    const artist = await ctx.db.get(inv.artistId);
    let emailed = false;

    if (status === "paid") {
      await ctx.db.insert("activity", {
        orgId,
        kind: "invoice.paid",
        summary: `${inv.number} paid in full by ${artist?.name ?? "client"}`,
        entityType: "invoice",
        entityId: id,
        accent: "positive",
      });
      // Receipt to the client + heads-up to the team.
      if (artist?.email) {
        emailed = true;
        await notify(ctx, {
          orgId,
          channel: "email",
          recipient: artist.email,
          subject: `Payment received - invoice ${inv.number}`,
          body: `We received your payment of ${money(inv.amountCents)} for invoice ${inv.number}. Thank you - this invoice is settled in full.`,
          kind: "invoice.paid",
        });
      }
      await notifyTeam(ctx, {
        orgId,
        subject: `Invoice paid - ${inv.number} (${money(inv.amountCents)})`,
        body: `${artist?.name ?? "A client"} paid invoice ${inv.number} in full: ${money(inv.amountCents)}.`,
        kind: "invoice.paid",
      });
    } else if (status === "sent") {
      await ctx.db.insert("activity", {
        orgId,
        kind: "invoice.sent",
        summary: `Invoice ${inv.number} sent`,
        entityType: "invoice",
        entityId: id,
        accent: "info",
      });
      // The actual send: the client gets the invoice with a payment link.
      if (artist?.email) {
        emailed = true;
        const payUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/pay/invoice/${id}`;
        const lines = inv.lineItems
          .map((li) => `- ${li.label}: ${money(li.amountCents)}`)
          .join("\n");
        await notify(ctx, {
          orgId,
          channel: "email",
          recipient: artist.email,
          subject: `Invoice ${inv.number} - ${money(inv.amountCents)} due ${new Date(
            inv.dueDate,
          ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          body: `Hi ${artist.name ?? "there"},\n\nHere is your invoice ${inv.number}:\n\n${lines}\n\nTotal: ${money(inv.amountCents)}\nDue: ${new Date(inv.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}\n\nPay securely online:\n${payUrl}\n\nThank you.`,
          kind: "invoice.sent",
        });
      }
    }
    return { emailed };
  },
});

export const remove = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const inv = await ctx.db.get(id);
    if (!inv || inv.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
