import { query, action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { complete } from "./lib/openai";
import { tenantGuard, fenceUntrusted, detectInjection } from "./lib/aiGuard";
import { whitelabelFor } from "./usage";

/* ============================================================
   Client concierge portal.

   A magic-link surface for an artist (collaboratorGrants, scope
   "artist_portal"). It is token-authenticated and public (no Clerk
   login), so every read here validates the grant itself rather than
   going through the studio access engine. The concierge answers the
   artist's questions strictly from their own songs / sessions /
   invoices, with a deterministic fallback when no LLM key is set.
   ============================================================ */

/** Invoice statuses that the artist can actually pay from the portal. */
const PAYABLE_INVOICE_STATUSES = new Set(["sent", "viewed", "overdue"]);
function invoicePayable(status: string): boolean {
  return PAYABLE_INVOICE_STATUSES.has(status);
}

/** Deliverable statuses the artist is allowed to see / download (approved work only). */
function deliverableVisible(status: string): boolean {
  return status === "approved" || status === "final";
}

function isAudioMime(mimeType?: string): boolean {
  return !!mimeType && mimeType.toLowerCase().startsWith("audio/");
}

/** Validate an artist-portal grant by token. Null when missing/expired/wrong scope. */
async function loadGrant(ctx: { db: QueryCtx["db"] }, token: string) {
  const g = await ctx.db
    .query("collaboratorGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!g || g.revoked || g.expiresAt < Date.now() || g.scope !== "artist_portal") return null;
  return g;
}

/**
 * Sum of what's still owed across a song's linked sessions. Mirrors the gate
 * math in files.ts / payments.ts so a payment-gated deliverable stays locked
 * on the portal until the song's balance is settled.
 */
async function songOutstandingCents(ctx: { db: QueryCtx["db"] }, songId: Doc<"songs">["_id"]): Promise<number> {
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_song", (q) => q.eq("songId", songId))
    .collect();
  let outstanding = 0;
  for (const s of sessions) {
    if (s.status === "cancelled") continue;
    outstanding += Math.max(0, s.rateCents - (s.amountPaidCents ?? 0));
  }
  return outstanding;
}

async function gatherContext(ctx: { db: QueryCtx["db"] }, orgId: string, artistId: string) {
  const artist = await ctx.db.get(artistId as never);
  if (!artist || (artist as { orgId: string }).orgId !== orgId) return null;

  const songs = await ctx.db
    .query("songs")
    .withIndex("by_org_artist", (q) => q.eq("orgId", orgId).eq("artistId", artistId as never))
    .collect();
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_artist", (q) => q.eq("artistId", artistId as never))
    .collect();
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_artist", (q) => q.eq("artistId", artistId as never))
    .collect();
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();

  // Approved deliverables for this artist's own songs only. Scoped by walking
  // the artist's org+artist song set, then re-checking each deliverable's org
  // and approval status - never other orgs, never unapproved drafts.
  const deliverables: {
    id: Doc<"deliverables">["_id"];
    label: string;
    kind: Doc<"deliverables">["kind"];
    version: number;
    songTitle: string;
    fileName?: string;
    mimeType?: string;
    isAudio: boolean;
    durationSec?: number;
    locked: boolean;
  }[] = [];
  for (const song of songs) {
    const rows = await ctx.db
      .query("deliverables")
      .withIndex("by_song", (q) => q.eq("songId", song._id))
      .collect();
    const approved = rows.filter((d) => d.orgId === orgId && deliverableVisible(d.status) && d.fileId);
    if (approved.length === 0) continue;
    // Compute the pay-gate once per song (only if any approved file is gated).
    const gatedHere = approved.some((d) => d.paymentGated);
    const outstanding = gatedHere ? await songOutstandingCents(ctx, song._id) : 0;
    for (const d of approved) {
      deliverables.push({
        id: d._id,
        label: d.label,
        kind: d.kind,
        version: d.version,
        songTitle: song.title,
        fileName: d.fileName,
        mimeType: d.mimeType,
        isAudio: isAudioMime(d.mimeType),
        durationSec: d.durationSec,
        locked: d.paymentGated && outstanding > 0,
      });
    }
  }
  deliverables.sort((a, b) => (a.songTitle === b.songTitle ? b.version - a.version : a.songTitle.localeCompare(b.songTitle)));

  const now = Date.now();
  return {
    studioName: org?.name ?? "the studio",
    artistName: (artist as { name: string }).name,
    bookingSlug: org?.slug ?? null,
    songs: songs.map((s) => ({ title: s.title, stage: s.stage })),
    upcomingSessions: sessions
      .filter((s) => s.startTime > now && s.status !== "cancelled")
      .sort((a, b) => a.startTime - b.startTime)
      .map((s) => ({ title: s.title, startTime: s.startTime, status: s.status })),
    invoices: invoices
      .filter((i) => i.status !== "void")
      .map((i) => ({ id: i._id, number: i.number, amountCents: i.amountCents, status: i.status, payable: invoicePayable(i.status) })),
    deliverables,
  };
}

/** Public: read-only summary of the artist's world for the portal home. */
export const summary = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const grant = await loadGrant(ctx, token);
    if (!grant) return null;
    const ctxData = await gatherContext(ctx, grant.orgId, grant.entityId);
    if (!ctxData) return null;
    const outstandingCents = ctxData.invoices
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => s + i.amountCents, 0);
    return {
      ...ctxData,
      outstandingCents,
      expiresAt: grant.expiresAt,
      whitelabel: await whitelabelFor(ctx, grant.orgId),
    };
  },
});

/**
 * Public: token-scoped signed download URL for a single APPROVED deliverable.
 * Re-verifies the grant, the org, that the deliverable's song belongs to the
 * artist this token represents, and that the version is approved - a public
 * token surface, so ownership is re-checked on every read. Returns
 * { locked: true } when a payment-gated file's balance is unpaid, or null when
 * the deliverable is not available to this artist.
 */
export const deliverableDownloadUrl = query({
  args: { token: v.string(), deliverableId: v.id("deliverables") },
  handler: async (ctx, { token, deliverableId }) => {
    const grant = await loadGrant(ctx, token);
    if (!grant) return null;

    const artist = await ctx.db.get(grant.entityId as never);
    if (!artist || (artist as { orgId: string }).orgId !== grant.orgId) return null;

    const d = await ctx.db.get(deliverableId);
    if (!d || d.orgId !== grant.orgId) return null;
    if (!deliverableVisible(d.status) || !d.fileId) return null;

    // The deliverable's song must belong to this org + this artist.
    const song = await ctx.db.get(d.songId);
    if (!song || song.orgId !== grant.orgId || song.artistId !== grant.entityId) return null;

    if (d.paymentGated && (await songOutstandingCents(ctx, d.songId)) > 0) {
      return { locked: true as const };
    }

    const url = await ctx.storage.getUrl(d.fileId);
    return url ? { url } : null;
  },
});

/** Internal: same context, used by the concierge action. */
export const _context = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const grant = await loadGrant(ctx, token);
    if (!grant) return null;
    const ctxData = await gatherContext(ctx, grant.orgId, grant.entityId);
    if (!ctxData) return null;
    return { grantId: grant._id, ...ctxData };
  },
});

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fallbackAnswer(c: NonNullable<Awaited<ReturnType<typeof gatherContext>>>): string {
  const next = c.upcomingSessions[0];
  const unpaid = c.invoices.filter((i) => i.status !== "paid");
  const owed = unpaid.reduce((s, i) => s + i.amountCents, 0);
  const parts = [
    `You have ${c.songs.length} song${c.songs.length === 1 ? "" : "s"} in progress with ${c.studioName}.`,
    next ? `Your next session is "${next.title}" on ${fmtDate(next.startTime)}.` : "You have no upcoming sessions booked.",
    unpaid.length > 0 ? `You have ${unpaid.length} open invoice${unpaid.length === 1 ? "" : "s"} totaling $${(owed / 100).toFixed(2)}.` : "Your invoices are all settled.",
    "For anything else, I will pass your question to the studio.",
  ];
  return parts.join(" ");
}

/** Public: ask the concierge a question, answered only from this artist's data. */
export const ask = action({
  args: { token: v.string(), question: v.string() },
  handler: async (ctx, { token, question }): Promise<{ answer: string; source: string }> => {
    const c = await ctx.runQuery(internal.portal._context, { token });
    if (!c) return { answer: "This portal link is no longer valid. Please ask the studio for a fresh link.", source: "error" };

    await ctx.runMutation(internal.grants.markUsed, { grantId: c.grantId });

    // Rate-limit the LLM per portal token (bounds paid AI cost / abuse).
    const allowed = await ctx.runMutation(internal.grants.checkAskRate, { grantId: c.grantId });
    if (!allowed) {
      return {
        answer: `You've asked a lot in a short window. Please give it a few minutes, or reach out to ${c.studioName} directly.`,
        source: "rate_limited",
      };
    }

    // This surface is public + takes free text, so it is the prime injection
    // target. Tenant data isolation already prevents any cross-studio leak
    // (only this artist's facts are ever in context); on top of that, refuse
    // obvious injection / jailbreak attempts outright and log them.
    if (detectInjection(question)) {
      console.warn(`[portal.ask] injection attempt blocked studio="${c.studioName}" artist="${c.artistName}"`);
      return {
        answer: `I can only help with your songs, sessions, and invoices at ${c.studioName}. I'll pass anything else along to the studio.`,
        source: "blocked",
      };
    }

    const facts = [
      `Artist: ${c.artistName}`,
      `Studio: ${c.studioName}`,
      c.songs.length ? `Songs: ${c.songs.map((s) => `${s.title} (${s.stage})`).join("; ")}` : "Songs: none",
      c.upcomingSessions.length
        ? `Upcoming sessions: ${c.upcomingSessions.map((s) => `${s.title} on ${fmtDate(s.startTime)}`).join("; ")}`
        : "Upcoming sessions: none",
      c.invoices.length
        ? `Invoices: ${c.invoices.map((i) => `${i.number} $${(i.amountCents / 100).toFixed(2)} ${i.status}`).join("; ")}`
        : "Invoices: none",
    ].join("\n");

    const ai = await complete(
      `FACTS ABOUT THIS ARTIST:\n${facts}\n\n${fenceUntrusted("CLIENT QUESTION", question)}\n\nAnswer the question in 2-4 warm, concise sentences, using only the facts above.`,
      {
        system: [
          `You are the client concierge for ${c.studioName}, helping the artist ${c.artistName}.`,
          tenantGuard(c.studioName),
          "Answer ONLY from the facts provided about this artist's songs, sessions, and invoices.",
          "If the question is outside that, say you will pass it along to the studio. Never invent sessions, dates, or amounts.",
        ].join(" "),
        maxOutputTokens: 300,
      },
    );

    if (ai?.text?.trim()) return { answer: ai.text.trim(), source: ai.source };
    return { answer: fallbackAnswer(c), source: "fallback" };
  },
});
