import { v, ConvexError } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { currentOrgWithCapability } from "./lib/tenant";
import { askJev, jevEnabled } from "./lib/jevClient";
import {
  FIT_ROLES,
  MAX_FIT_CANDIDATES,
  engineerFitQuestions,
  engineerFitState,
  engineerProfile,
  hasFitSignal,
  orderFitCandidates,
  rankEngineerFit,
  serviceName,
  sessionProfile,
  unavailableReason,
  type FitBusyData,
  type FitProfile,
  type FitSession,
} from "./lib/jev/engineerFit";

/* ============================================================
   Engineer-fit suggestions (Jev, TypeSafe System One).

   When a session is booked or needs an engineer, Jev ranks the studio's
   engineers by how well each one fits it: their skills, credits, bio and
   recent work against the session's service, genres, notes and room. The
   owner picks. Nothing here assigns anyone or writes anything.

   - Asked on demand (a button), never on page load.
   - Who is free is decided in code before Jev is asked (overlapping
     sessions, approved time off, a shift in another room).
   - Gated like the rest of staff scheduling: schedule.manage, the
     capability the shifts and the engineer-confirmation override use.
   - When Jev is unavailable (no key, timeout, API error) the answer is
     empty and the UI shows nothing new.
   The questions, state and ranking live in lib/jev/engineerFit.ts.
   ============================================================ */

const CAPABILITY = "schedule.manage";
const DAY = 86_400_000;
/** Recent work describes an engineer: the newest sessions of the last 180 days. */
const HISTORY_DAYS = 180;
const HISTORY_MAX = 600;
/** At most this many clients are read for their genres. */
const HISTORY_ARTISTS_MAX = 200;
/** Statuses that count as work done (a tentative hold does not). */
const WORKED = new Set(["confirmed", "in_progress", "completed"]);

const serviceV = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
  v.literal("custom"),
);

/** A booking still being filled in (the Book a session dialog). The time is
 *  optional: the dialog asks for the engineer before the time, and without
 *  a time nobody can be ruled out as busy. */
const draftV = v.object({
  serviceType: serviceV,
  customService: v.optional(v.string()),
  artistId: v.optional(v.id("artists")),
  roomId: v.optional(v.id("rooms")),
  songId: v.optional(v.id("songs")),
  title: v.optional(v.string()),
  startTime: v.optional(v.number()),
  endTime: v.optional(v.number()),
});

const targetArgs = { sessionId: v.optional(v.id("sessions")), draft: v.optional(draftV) };

type Member = { memberId: Id<"members">; name: string };
type Excluded = Member & { reason: string };
type Prepared = {
  session: FitSession;
  candidates: (Member & { profile: FitProfile })[];
  excluded: Excluded[];
};

export type EngineerSuggestion = Member & {
  score: number;
  fit: number;
  confidence: number;
  level: number;
  label: string;
  suggested: boolean;
};

export type EngineerFitResult = {
  status: "ok" | "unavailable" | "no_candidates";
  /** Every engineer Jev scored, best fit first. */
  suggestions: EngineerSuggestion[];
  /** Engineers not asked about, and why (decided in code). */
  excluded: Excluded[];
  model: string | null;
};

/** Whether this viewer gets the "Suggest engineer" button: allowed to
 *  schedule staff, and this deployment can reach Jev. False otherwise, so
 *  the page renders exactly as it did. */
export const available = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    if (!jevEnabled()) return false;
    try {
      await currentOrgWithCapability(ctx, CAPABILITY);
      return true;
    } catch (err) {
      // No schedule.manage, or the plan or the Schedule module does not include it.
      if (err instanceof ConvexError) return false;
      throw err;
    }
  },
});

/** Everything decided before Jev is asked: the caller may schedule staff,
 *  the session (saved, or a draft) as Jev will read it, and which engineers
 *  to ask about. Runs with the caller's identity (called from `suggest`). */
export const _prepare = internalQuery({
  args: targetArgs,
  handler: async (ctx, { sessionId, draft }): Promise<Prepared> => {
    const orgId = await currentOrgWithCapability(ctx, CAPABILITY);

    let target: {
      serviceType: string;
      customService?: string;
      title?: string;
      notes?: string;
      artistId?: Id<"artists">;
      roomId?: Id<"rooms">;
      songId?: Id<"songs">;
      startTime?: number;
      endTime?: number;
    };
    if (sessionId && !draft) {
      const saved = await ctx.db.get(sessionId);
      if (!saved || saved.orgId !== orgId) throw new ConvexError("Session not found");
      target = saved;
    } else if (draft && !sessionId) {
      target = draft;
    } else {
      throw new ConvexError("Ask about one session: a saved session or a draft booking.");
    }

    const [artist, room, song] = await Promise.all([
      target.artistId ? ctx.db.get(target.artistId) : null,
      target.roomId ? ctx.db.get(target.roomId) : null,
      target.songId ? ctx.db.get(target.songId) : null,
    ]);
    // Another studio's records are never read into the state.
    const ours = <T extends { orgId: string }>(doc: T | null) => (doc && doc.orgId === orgId ? doc : null);
    const session = sessionProfile(target, {
      artist: ours(artist),
      room: ours(room),
      songGenre: ours(song)?.genre,
    });

    const members = (
      await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).filter((m) => FIT_ROLES.has(m.role));

    // Who is busy then. Only possible once the session has a time.
    const { startTime, endTime } = target;
    const window =
      startTime !== undefined && endTime !== undefined && endTime > startTime
        ? { start: startTime, end: endTime, sessionId, roomId: ours(room) ? target.roomId : undefined }
        : null;
    let busy: FitBusyData | null = null;
    const roomNames = new Map<string, string>();
    if (window) {
      const [around, timeOff, shifts, rooms] = await Promise.all([
        ctx.db
          .query("sessions")
          .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", window.start - DAY).lt("startTime", window.end))
          .collect(),
        ctx.db
          .query("timeOff")
          .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "approved"))
          .collect(),
        ctx.db
          .query("shifts")
          .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", window.start - DAY).lt("startTime", window.end))
          .collect(),
        ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ]);
      busy = { sessions: around, timeOff, shifts };
      for (const r of rooms) roomNames.set(r._id, r.name);
    }

    // Recent work: which services each engineer ran and their clients' genres.
    const now = Date.now();
    const memberIds = new Set<string>(members.map((m) => m._id));
    const recent = (
      await ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now - HISTORY_DAYS * DAY).lte("startTime", now))
        .order("desc")
        .take(HISTORY_MAX)
    ).filter((s) => s.engineerId && memberIds.has(s.engineerId) && s._id !== sessionId && WORKED.has(s.status));
    const artistIds = [...new Set(recent.map((s) => s.artistId))].slice(0, HISTORY_ARTISTS_MAX);
    const genresOf = new Map<string, string[]>();
    for (const a of await Promise.all(artistIds.map((id) => ctx.db.get(id)))) {
      if (a && a.orgId === orgId) genresOf.set(a._id, a.genres);
    }
    const history = new Map<string, { services: string[]; genres: string[] }>();
    for (const s of recent) {
      const engineerId = s.engineerId;
      if (!engineerId) continue;
      const h = history.get(engineerId) ?? { services: [], genres: [] };
      h.services.push(serviceName(s.serviceType, s.customService));
      h.genres.push(...(genresOf.get(s.artistId) ?? []));
      history.set(engineerId, h);
    }

    const excluded: Excluded[] = [];
    const eligible: (Prepared["candidates"][number] & { role: string })[] = [];
    for (const m of members) {
      const reason = window && busy ? unavailableReason(m._id, window, busy, (id) => roomNames.get(id)) : null;
      if (reason) {
        excluded.push({ memberId: m._id, name: m.name, reason });
        continue;
      }
      const profile = engineerProfile(m, history.get(m._id));
      if (!hasFitSignal(profile)) {
        excluded.push({ memberId: m._id, name: m.name, reason: "No skills, credits, bio or recent sessions to judge" });
        continue;
      }
      eligible.push({ memberId: m._id, name: m.name, role: m.role, profile });
    }
    const ordered = orderFitCandidates(session, eligible);
    for (const over of ordered.slice(MAX_FIT_CANDIDATES)) {
      excluded.push({ memberId: over.memberId, name: over.name, reason: `Over the ${MAX_FIT_CANDIDATES}-engineer limit` });
    }
    const candidates = ordered
      .slice(0, MAX_FIT_CANDIDATES)
      .map(({ memberId, name, profile }) => ({ memberId, name, profile }));
    return { session, candidates, excluded };
  },
});

/** Rank the free engineers for one session, best fit first. `sessionId` for
 *  a saved session, `draft` for a booking being filled in. One Jev request
 *  holds one Score question per engineer. Never assigns anyone. */
export const suggest = action({
  args: targetArgs,
  handler: async (ctx, args): Promise<EngineerFitResult> => {
    // Throws for a viewer without schedule.manage, before Jev is asked.
    const prep: Prepared = await ctx.runQuery(internal.jevEngineerFit._prepare, args);
    const none = { suggestions: [], excluded: prep.excluded, model: null };
    if (prep.candidates.length === 0) return { status: "no_candidates", ...none };

    const asked = await askJev(
      engineerFitState(prep.session, prep.candidates.map((c) => c.profile)),
      engineerFitQuestions(prep.candidates.length),
    );
    if (!asked) return { status: "unavailable", ...none };

    const ranked = rankEngineerFit(
      prep.candidates.map(({ memberId, name }) => ({ memberId, name })),
      asked.result.answers,
    );
    return { status: "ok", suggestions: ranked, excluded: prep.excluded, model: asked.result.model };
  },
});
