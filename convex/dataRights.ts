/* ============================================================
   GDPR data-subject rights - per-client export + erasure.

   The studio is the controller of its clients' personal data; this
   gives it the two rights it must honor for a data subject:

   - EXPORT (portability): a structured bundle of everything the studio
     holds about one client, to hand over on request.
   - ERASURE (right to be forgotten): anonymize the client's identifying
     data and scrub their identity from free text and outbound message
     records. Financial/operational records (invoices, payments) are
     RETAINED in anonymized form under the accounting legitimate-interest
     basis - a standard, defensible GDPR pattern - rather than hard-
     deleted, so the books stay intact.

   Both are strictly org-scoped (a studio can only export/erase its own
   clients) and audited. Erasure requires an owner/manager capability.
   ============================================================ */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import { currentOrgWithCapability, currentActor } from "./lib/tenant";
import { redactText, piiTerms } from "./lib/redact";

/** EXPORT: everything the studio holds about one client. Gated by
 *  `artists.read` (the PII-read capability). Org-scoped. */
export const exportArtist = query({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrgWithCapability(ctx, "artists.read");
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) return null;

    const [sessions, invoices, songs, opps, messages, waitlist] = await Promise.all([
      ctx.db.query("sessions").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect(),
      ctx.db.query("invoices").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect(),
      ctx.db.query("songs").withIndex("by_org_artist", (q) => q.eq("orgId", orgId).eq("artistId", artistId)).collect(),
      ctx.db.query("opportunities").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect(),
      ctx.db.query("clientMessages").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect(),
      ctx.db.query("waitlistEntries").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect(),
    ]);

    const sessionIds = new Set(sessions.map((s) => s._id));
    const orgPayments = await ctx.db.query("payments").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const payments = orgPayments.filter((p) => sessionIds.has(p.sessionId));

    return {
      exportedAt: Date.now(),
      subject: {
        id: artist._id,
        name: artist.name,
        type: artist.type,
        email: artist.email ?? null,
        phone: artist.phone ?? null,
        location: artist.location ?? null,
        instagram: artist.instagram ?? null,
        spotify: artist.spotify ?? null,
        genres: artist.genres,
        tags: artist.tags,
        notes: artist.notes ?? null,
        status: artist.status,
        lifetimeValueCents: artist.lifetimeValueCents,
        sessionCount: artist.sessionCount,
        source: artist.source ?? null,
        createdAt: artist._creationTime,
        erasedAt: artist.erasedAt ?? null,
      },
      sessions: sessions.map((s) => ({ id: s._id, title: s.title, serviceType: s.serviceType, startTime: s.startTime, endTime: s.endTime, status: s.status, rateCents: s.rateCents, notes: s.notes ?? null })),
      invoices: invoices.map((i) => ({ id: i._id, number: i.number, status: i.status, amountCents: i.amountCents, dueDate: i.dueDate, paidAt: i.paidAt ?? null })),
      payments: payments.map((p) => ({ id: p._id, kind: p.kind, amountCents: p.amountCents, status: p.status, paidAt: p.paidAt ?? null })),
      songs: songs.map((s) => ({ id: s._id, title: s.title, stage: s.stage })),
      opportunities: opps.map((o) => ({ id: o._id, title: o.title, stage: o.stage, valueCents: o.valueCents })),
      messages: messages.map((m) => ({ id: m._id, direction: m.direction, subject: m.subject, body: m.body, channel: m.channel, sentBy: m.sentBy ?? null, at: m._creationTime })),
      waitlist: waitlist.map((w) => ({ id: w._id })),
    };
  },
});

/** ERASURE: anonymize the client and scrub their identity from free text +
 *  outbound records. Destructive, so gated by `members.remove` (owner/manager).
 *  Returns a count of records scrubbed; writes an audit event. */
export const eraseArtist = mutation({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrgWithCapability(ctx, "members.remove");
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) throw new Error("Not found");
    if (artist.erasedAt) return { alreadyErased: true, scrubbed: 0 };

    const terms = piiTerms(artist);
    const oldEmail = artist.email?.trim().toLowerCase();
    const shortId = artistId.slice(-6);
    const placeholder = `Erased client ${shortId}`;
    let scrubbed = 0;

    // 1. Anonymize the client record itself.
    await ctx.db.patch(artistId, {
      name: placeholder,
      email: undefined,
      phone: undefined,
      location: undefined,
      instagram: undefined,
      spotify: undefined,
      notes: undefined,
      tags: [],
      erasedAt: Date.now(),
    });

    // 2. Scrub identity from session titles + notes (records retained).
    const sessions = await ctx.db.query("sessions").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
    for (const s of sessions) {
      await ctx.db.patch(s._id, {
        title: redactText(s.title, terms) ?? s.title,
        notes: redactText(s.notes, terms),
      });
      scrubbed++;
    }

    // 3. Redact the client message history (their communications).
    const messages = await ctx.db.query("clientMessages").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
    for (const m of messages) {
      await ctx.db.patch(m._id, {
        subject: redactText(m.subject, terms) ?? m.subject,
        body: redactText(m.body, terms) ?? m.body,
      });
      scrubbed++;
    }

    // 4. Redact opportunity titles.
    const opps = await ctx.db.query("opportunities").withIndex("by_artist", (q) => q.eq("artistId", artistId)).collect();
    for (const o of opps) {
      await ctx.db.patch(o._id, { title: redactText(o.title, terms) ?? o.title });
      scrubbed++;
    }

    // 5. Outbound notifications addressed to the client's email.
    if (oldEmail) {
      const notifs = await ctx.db.query("notifications").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
      for (const n of notifs) {
        if (n.recipient?.trim().toLowerCase() !== oldEmail) continue;
        await ctx.db.patch(n._id, {
          recipient: "[erased]",
          subject: redactText(n.subject, terms) ?? n.subject,
          body: redactText(n.body, terms) ?? n.body,
        });
        scrubbed++;
      }
      // 6. AI artifact email drafts addressed to the client.
      const artifacts = await ctx.db.query("aiArtifacts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
      for (const a of artifacts) {
        if (a.emailDraft?.to?.trim().toLowerCase() !== oldEmail) continue;
        await ctx.db.patch(a._id, {
          emailDraft: {
            to: "[erased]",
            subject: redactText(a.emailDraft.subject, terms) ?? a.emailDraft.subject,
            body: redactText(a.emailDraft.body, terms) ?? a.emailDraft.body,
          },
        });
        scrubbed++;
      }
    }

    // 7. Knowledge-graph node label for this client.
    const node = await ctx.db.query("studioGraphNodes").withIndex("by_org_ref", (q) => q.eq("orgId", orgId).eq("refId", artistId)).first();
    if (node) {
      await ctx.db.patch(node._id, { label: placeholder, summary: undefined, attrs: undefined });
      scrubbed++;
    }

    // 8. Audit the erasure.
    await ctx.db.insert("auditEvents", {
      orgId,
      viewerType: "studio_member",
      viewerId: await currentActor(ctx),
      action: "data.erase.artist",
      resource: artistId,
      result: "allow",
      reason: "gdpr_erasure",
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "client.erased",
      summary: `Client data erased (GDPR) - ${scrubbed} record(s) scrubbed`,
      entityType: "artist",
      entityId: artistId,
      accent: "critical",
    });

    return { scrubbed };
  },
});
