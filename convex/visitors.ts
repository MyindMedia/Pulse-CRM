import { query, mutation, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { recomputeRoomStatus } from "./lib/roomStatus";
import { scheduleGoogleCalendarPush } from "./googleCalendar";
import { sameEmail } from "./lib/emailKey";

/* ============================================================
   Visitors - the front-desk guest log.
   `register` is PUBLIC (the /visit/<slug> QR page): the org is
   derived from the slug, never from the caller, mirroring the
   public booking backend. Everything else requires a signed-in
   studio viewer via currentOrg.
   Every visit also upserts the contact into `artists` (deduped
   by lowercased email) so walk-ins land in the Clients directory
   as leads - the outreach database - without a parallel CRM.
   A check-in whose email (or unambiguous name) matches a session
   booked around now e-checks that session in automatically, so
   the kiosk calendar reflects the arrival with no staff tap.
   ============================================================ */

const HOURLY_CHECKIN_CAP = 60;

// How far around "now" a booking counts as the visit the guest is arriving
// for. Wide on the late side (a 9pm session's client can sign in at noon for
// a tour, but their evening booking is still "today"); bounded on the early
// side so yesterday's session never re-activates. Timestamps keep this
// timezone-free - no server-vs-studio midnight math.
const MATCH_LOOKBACK_MS = 6 * 60 * 60 * 1000; // session started up to 6h ago
const MATCH_LOOKAHEAD_MS = 16 * 60 * 60 * 1000; // session starts within 16h

/** Lowercase, trim and collapse whitespace so "Ray  Vaughn " == "ray vaughn". */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * E-check-in: find the session this visitor is arriving for and advance it.
 * Email is the primary key (visitor email == the booking artist's email);
 * when emails don't line up, an exact normalized-name match is accepted only
 * if it is unambiguous (exactly one candidate session). Matched sessions
 * advance one step along the existing status machine - tentative -> confirmed
 * (they showed up; staff still collects the deposit before starting),
 * confirmed -> in_progress (the same transition the kiosk's Check-in button
 * runs, so the room flips in-use and the Google mirror updates). The kiosk's
 * reactive queries pick the change up instantly.
 */
async function matchAndCheckInSession(
  ctx: MutationCtx,
  orgId: string,
  visitor: { name: string; email: string },
): Promise<{ session: Doc<"sessions">; matchedBy: "email" | "name" } | null> {
  const now = Date.now();
  const candidates = (
    await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q
          .eq("orgId", orgId)
          .gte("startTime", now - MATCH_LOOKBACK_MS)
          .lte("startTime", now + MATCH_LOOKAHEAD_MS),
      )
      .collect()
  ).filter(
    (s) => s.status === "tentative" || s.status === "confirmed" || s.status === "in_progress",
  );
  if (candidates.length === 0) return null;

  // One artist read per unique artistId in the window - no N+1 over sessions.
  const artistIds = [...new Set(candidates.map((s) => s.artistId))];
  const artists = new Map(
    (await Promise.all(artistIds.map((id) => ctx.db.get(id)))).flatMap((a) =>
      a ? [[a._id, a] as const] : [],
    ),
  );

  const visitorName = normalizeName(visitor.name);
  const emailMatches = candidates.filter(
    (s) => sameEmail(artists.get(s.artistId)?.email, visitor.email),
  );
  const nameMatches = candidates.filter(
    (s) => normalizeName(artists.get(s.artistId)?.name ?? "") === visitorName,
  );

  let matched: Doc<"sessions"> | undefined;
  let matchedBy: "email" | "name";
  if (emailMatches.length > 0) {
    // Email is decisive. Cross-compare the name only to pick between several
    // bookings under one email (a manager booking for multiple artists).
    matched =
      emailMatches.find((s) => normalizeName(artists.get(s.artistId)?.name ?? "") === visitorName) ??
      emailMatches.sort((a, b) => Math.abs(a.startTime - now) - Math.abs(b.startTime - now))[0];
    matchedBy = "email";
  } else if (nameMatches.length === 1) {
    // Name alone only counts when it points at exactly one booking.
    matched = nameMatches[0];
    matchedBy = "name";
  } else {
    return null;
  }

  if (matched.status === "tentative" || matched.status === "confirmed") {
    const nextStatus = matched.status === "tentative" ? "confirmed" : "in_progress";
    await ctx.db.patch(matched._id, { status: nextStatus });
    if (matched.roomId) await recomputeRoomStatus(ctx, matched.roomId);
    await scheduleGoogleCalendarPush(ctx, matched._id);
    await ctx.db.insert("activity", {
      orgId,
      kind: "session.checked_in",
      summary:
        nextStatus === "in_progress"
          ? `${visitor.name} e-checked in - ${matched.title} is now running`
          : `${visitor.name} arrived - ${matched.title} auto-confirmed (deposit still due)`,
      entityType: "session",
      entityId: matched._id,
      accent: "gold",
    });
    matched = { ...matched, status: nextStatus };
  }

  return { session: matched, matchedBy };
}

const registerFields = {
  name: v.string(),
  email: v.string(),
  phone: v.optional(v.string()),
  purpose: v.optional(v.string()),
  hostName: v.optional(v.string()),
};

type RegisterArgs = {
  name: string;
  email: string;
  phone?: string;
  purpose?: string;
  hostName?: string;
};

type RecordVisitResult = {
  visitId: Id<"visitors">;
  // Echoed to the QR success screen so the guest sees their booking was found.
  session: { title: string; startTime: number; status: string } | null;
};

/** Upsert the visitor into `artists` (dedup by lowercased email), match the
    visit against a booked session (e-check-in), then insert the visit row +
    an activity-feed entry. Shared by the public QR path and the staff
    manual-entry path. */
async function recordVisit(
  ctx: MutationCtx,
  orgId: string,
  args: RegisterArgs,
  source: "qr" | "front_desk",
  termsAcceptedAt?: number,
): Promise<RecordVisitResult> {
  const name = args.name.trim();
  const email = args.email.trim().toLowerCase();
  if (!name) throw new Error("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Please enter a valid email address.");
  }
  const phone = args.phone?.trim() || undefined;
  const purpose = args.purpose?.trim() || undefined;
  const hostName = args.hostName?.trim() || undefined;

  // Dedup into the client database - same convention as public booking:
  // first-touch source wins, contact details fill in when missing.
  const existing = (
    await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
  ).find((a) => sameEmail(a.email, email));
  let artistId: Id<"artists">;
  if (existing) {
    artistId = existing._id;
    await ctx.db.patch(existing._id, {
      phone: phone ?? existing.phone,
      lastContactAt: Date.now(),
      source: existing.source ?? "visitor_qr",
      ...(existing.tags.includes("Visitor") ? {} : { tags: [...existing.tags, "Visitor"] }),
    });
  } else {
    artistId = await ctx.db.insert("artists", {
      orgId,
      name,
      type: "other",
      email,
      phone,
      genres: [],
      tags: ["Visitor"],
      status: "lead",
      lifetimeValueCents: 0,
      sessionCount: 0,
      reliability: "solid",
      lastContactAt: Date.now(),
      source: "visitor_qr",
    });
  }

  // E-check-in: link the visit to the session this guest is arriving for and
  // advance its status so the kiosk shows the arrival without a staff tap.
  const match = await matchAndCheckInSession(ctx, orgId, { name, email });

  const visitId = await ctx.db.insert("visitors", {
    orgId,
    name,
    email,
    phone,
    purpose,
    hostName,
    artistId,
    sessionId: match?.session._id,
    sessionMatchedBy: match?.matchedBy,
    termsAcceptedAt,
    checkInAt: Date.now(),
    source,
  });

  await ctx.db.insert("activity", {
    orgId,
    kind: "visitor.checked_in",
    summary: `${name} checked in at the front desk${
      match ? ` for ${match.session.title}` : purpose ? ` - ${purpose}` : ""
    }`,
    entityType: "visitor",
    entityId: visitId,
    accent: "info",
  });

  return {
    visitId,
    session: match
      ? {
          title: match.session.title,
          startTime: match.session.startTime,
          status: match.session.status,
        }
      : null,
  };
}

/** PUBLIC - QR self check-in from /visit/<slug>. Org comes from the slug. */
export const register = mutation({
  args: { slug: v.string(), termsAccepted: v.optional(v.boolean()), ...registerFields },
  handler: async (ctx, { slug, termsAccepted, ...args }) => {
    // The visitor terms are a hard gate on self check-in - the client enforces
    // the checkbox, the server enforces the truth of it.
    if (termsAccepted !== true) {
      throw new Error("Please accept the visitor terms to check in.");
    }
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!org) throw new Error("This check-in link isn't active. Ask the front desk for help.");
    const orgId = org.orgId;

    // Abuse guard: an unauthenticated endpoint that writes CRM rows needs a
    // ceiling. 60 check-ins/org/hour is far above any real lobby's traffic.
    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_org_period_metric", (q) =>
        q.eq("orgId", orgId).eq("period", hourBucket).eq("metric", "visitor_checkins"),
      )
      .first();
    if ((counter?.value ?? 0) >= HOURLY_CHECKIN_CAP) {
      throw new Error("Check-in is briefly paused - please ask the front desk to sign you in.");
    }

    const result = await recordVisit(ctx, orgId, args, "qr", Date.now());

    if (counter) {
      await ctx.db.patch(counter._id, { value: counter.value + 1, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("usageCounters", {
        orgId,
        period: hourBucket,
        metric: "visitor_checkins",
        value: 1,
        updatedAt: Date.now(),
      });
    }

    return result;
  },
});

/** Staff manual entry from the Visitors screen (front desk signs someone in).
    No terms gate here - staff vouches for the guest they are keying in. */
export const registerManual = mutation({
  args: registerFields,
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    return recordVisit(ctx, orgId, args, "front_desk");
  },
});

/** Staff check-out - stamps the departure time. Idempotent. */
export const checkOut = mutation({
  args: { id: v.id("visitors") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const visit = await ctx.db.get(id);
    if (!visit || visit.orgId !== orgId) throw new Error("Not found");
    if (visit.checkOutAt) return; // already checked out - keep the first stamp
    await ctx.db.patch(id, { checkOutAt: Date.now() });
  },
});

/** The visit log, newest first. Optionally bounded to [from, to] check-in times.
    Visits that e-checked a session in carry the session's title for the log. */
export const list = query({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
    const visits = await ctx.db
      .query("visitors")
      .withIndex("by_org_checkin", (idx) => {
        const scoped = idx.eq("orgId", orgId);
        if (from !== undefined && to !== undefined) return scoped.gte("checkInAt", from).lte("checkInAt", to);
        if (from !== undefined) return scoped.gte("checkInAt", from);
        if (to !== undefined) return scoped.lte("checkInAt", to);
        return scoped;
      })
      .order("desc")
      .take(500);
    // One read per unique matched session (most visits have none).
    const sessionIds = [...new Set(visits.flatMap((v) => (v.sessionId ? [v.sessionId] : [])))];
    const sessions = new Map(
      (await Promise.all(sessionIds.map((id) => ctx.db.get(id)))).flatMap((s) =>
        s ? [[s._id, s] as const] : [],
      ),
    );
    return visits.map((v) => ({
      ...v,
      sessionTitle: v.sessionId ? sessions.get(v.sessionId)?.title ?? null : null,
    }));
  },
});

/** Unique visitors grouped by email - the outreach view. Newest-visit first.
    Each contact carries the linked client's lifetime stats (total completed
    bookings + lifetime spend), maintained by the session-completion path. */
export const directory = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const visits = await ctx.db
      .query("visitors")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const byEmail = new Map<
      string,
      {
        email: string;
        name: string;
        phone?: string;
        artistId?: Id<"artists">;
        visitCount: number;
        firstVisitAt: number;
        lastVisitAt: number;
        lifetimeBookings: number;
        lifetimeSpendCents: number;
      }
    >();
    for (const visit of visits) {
      const entry = byEmail.get(visit.email);
      if (!entry) {
        byEmail.set(visit.email, {
          email: visit.email,
          name: visit.name,
          phone: visit.phone,
          artistId: visit.artistId,
          visitCount: 1,
          firstVisitAt: visit.checkInAt,
          lastVisitAt: visit.checkInAt,
          lifetimeBookings: 0,
          lifetimeSpendCents: 0,
        });
      } else {
        entry.visitCount += 1;
        entry.firstVisitAt = Math.min(entry.firstVisitAt, visit.checkInAt);
        if (visit.checkInAt >= entry.lastVisitAt) {
          // The most recent visit's details are the freshest contact record.
          entry.lastVisitAt = visit.checkInAt;
          entry.name = visit.name;
          entry.phone = visit.phone ?? entry.phone;
          entry.artistId = visit.artistId ?? entry.artistId;
        }
      }
    }
    // One read per unique contact - the artist row already carries the
    // lifetime counters (sessionCount / lifetimeValueCents), incremented by
    // the session-completion path, so no sweep over sessions is needed.
    const entries = [...byEmail.values()];
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.artistId) return;
        const artist = await ctx.db.get(entry.artistId);
        if (!artist || artist.orgId !== orgId) return;
        entry.lifetimeBookings = artist.sessionCount ?? 0;
        entry.lifetimeSpendCents = artist.lifetimeValueCents ?? 0;
      }),
    );
    return entries.sort((a, b) => b.lastVisitAt - a.lastVisitAt);
  },
});
