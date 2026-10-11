/* ============================================================
   Engineer fit: which engineer suits a session (Jev, TypeSafe System One).
   Pure: no SDK, no I/O, so the exact state, questions and ranking are
   unit-testable and the same objects go to Jev from every caller.
   Docs: https://docs.typesafe.ai/primitives/score.md

   One Score question per candidate engineer, all in ONE request: they are
   independent questions over the same state, so Jev answers them together
   (https://docs.typesafe.ai/patterns/fan-out.md). Code ranks by the expected
   score. Jev never decides who is free: availability is settled in code
   before anyone is asked about (lib/gearRental's overlap rule, approved time
   off, a shift in another room). Nothing is assigned; the owner picks.

   Privacy: the state carries work facts only (service, genres, room, title,
   notes, skills, credits, bio). Fields are copied by name, so contact
   details and pay on a member or client record can never ride along, and
   emails, phone numbers, handles and links typed into free text are removed.
   ============================================================ */
import type { ScoreQuestion } from "@typesafe-ai/sdk";
import { engineerAvailable, overlaps, type SessionWindow } from "../gearRental";

/** Most engineers one request ranks. Ten keeps the state small: Jev loses
 *  accuracy as unrelated detail grows. */
export const MAX_FIT_CANDIDATES = 10;

/** Staff who can run a session: the roles a client may request on the
 *  public booking page (convex/booking.ts). */
export const FIT_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "engineer",
  "assistant_engineer",
  "producer",
]);

/** The levels, low to high. Each one describes a situation on its own: Jev
 *  sees every level separately, never its number or its neighbours. */
export const ENGINEER_FIT_LEVELS = [
  "Wrong fit: none of the session's work or genre matches this engineer's skills or experience",
  "Can do it, but this kind of session or genre is outside the engineer's usual work",
  "Good fit: the engineer does this kind of session regularly",
  "Ideal fit: this exact service and genre is the engineer's specialty",
] as const;

/** Short names for the levels, for the UI. */
export const FIT_LABELS = ["Wrong fit", "Outside usual work", "Good fit", "Ideal fit"] as const;

const TOP_LEVEL = ENGINEER_FIT_LEVELS.length - 1;

/** At most this many engineers get the "Suggested" chip. */
export const MAX_SUGGESTED = 2;
/** The expected score a suggestion needs: leaning "Good fit" or better. */
export const SUGGEST_MIN_SCORE = 1.5;
/** Below this Jev is split between distant levels (say "Wrong fit" and
 *  "Ideal fit"), so its score says little and no chip goes on. */
export const SUGGEST_MIN_CONFIDENCE = 0.25;

/* ---------- state ---------- */

/** What Jev reads about the session. */
export type FitSession = {
  service: string;
  client_type?: string;
  client_genres: string[];
  song_genre?: string;
  title?: string;
  notes?: string;
  room?: { name: string; type?: string };
};

/** What Jev reads about one engineer. */
export type FitProfile = {
  name: string;
  role: string;
  skills: string[];
  /** The services they engineered most in recent months, most frequent first. */
  recent_services: string[];
  /** Their recent clients' genres, most frequent first. */
  recent_genres: string[];
  credits: string[];
  bio?: string;
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const HANDLE = /(^|[\s(,;])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])/g;
const PHONE_LONG = /\+?\(?\d[\d\s().-]{8,}\d/g;
const PHONE_LOCAL = /\b\d{3}[-.\s]\d{4}\b/g;
const REMOVED = "[contact removed]";

/** Remove contact details from free text: emails, links, @handles, phone
 *  numbers, and any exact `extra` value (the client's stored email/phone). */
export function scrubContact(text: string | undefined | null, extra: (string | undefined | null)[] = []): string {
  if (!text) return "";
  let out = text;
  for (const term of extra) {
    const t = term?.trim();
    if (t && t.length >= 5) out = out.split(t).join(REMOVED);
  }
  return out
    .replace(EMAIL, REMOVED)
    .replace(LINK, REMOVED)
    .replace(HANDLE, (_m, lead: string) => `${lead}${REMOVED}`)
    .replace(PHONE_LONG, (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= 10 && digits <= 15 ? REMOVED : m;
    })
    .replace(PHONE_LOCAL, REMOVED);
}

/** Scrubbed, whitespace-collapsed, cut to `max` characters at a word break. */
function clean(raw: string | undefined | null, max: number, extra: (string | undefined | null)[] = []): string | undefined {
  const t = scrubContact(raw, extra).replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Cleaned, de-duplicated (case-insensitive) list of at most `maxItems`. */
function cleanList(items: readonly (string | undefined | null)[] | undefined, maxItems: number, maxLen: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items ?? []) {
    const item = clean(raw, maxLen);
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** The `limit` most frequent values (case-insensitive), most frequent first;
 *  ties keep the order they were first seen in. */
export function topByCount(values: readonly string[], limit: number): string[] {
  const counts = new Map<string, { label: string; n: number; first: number }>();
  values.forEach((raw, i) => {
    const label = raw?.trim();
    if (!label) return;
    const key = label.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { label, n: 1, first: i });
  });
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, limit)
    .map((c) => c.label);
}

/** The words a session's service goes by: the studio's own label for a
 *  custom booking, otherwise the service type. */
export function serviceName(serviceType: string, customService?: string | null): string {
  if (serviceType === "custom") return clean(customService, 40) ?? "custom booking";
  return serviceType;
}

/** The session as Jev sees it. Only the named fields are read. */
export function sessionProfile(
  session: { serviceType: string; customService?: string | null; title?: string | null; notes?: string | null },
  related: {
    artist?: { type?: string | null; genres?: readonly string[] | null; email?: string | null; phone?: string | null } | null;
    room?: { name: string; roomType?: string | null } | null;
    songGenre?: string | null;
  } = {},
): FitSession {
  const contact = [related.artist?.email, related.artist?.phone];
  const out: FitSession = {
    service: serviceName(session.serviceType, session.customService),
    client_genres: cleanList(related.artist?.genres ?? [], 6, 40),
  };
  if (related.artist?.type) out.client_type = related.artist.type;
  const songGenre = clean(related.songGenre, 40);
  if (songGenre) out.song_genre = songGenre;
  const title = clean(session.title, 120, contact);
  if (title) out.title = title;
  const notes = clean(session.notes, 300, contact);
  if (notes) out.notes = notes;
  if (related.room) {
    const room: { name: string; type?: string } = { name: clean(related.room.name, 60) ?? "Room" };
    const type = clean(related.room.roomType, 40);
    if (type) room.type = type;
    out.room = room;
  }
  return out;
}

/** One engineer as Jev sees it. Only the named fields are read, so passing a
 *  whole member row cannot leak its email, phone or pay. */
export function engineerProfile(
  member: { name: string; role: string; skills?: readonly string[] | null; credits?: readonly string[] | null; bio?: string | null },
  history: { services: readonly string[]; genres: readonly string[] } = { services: [], genres: [] },
): FitProfile {
  const out: FitProfile = {
    name: clean(member.name, 60) ?? "Engineer",
    role: member.role.replace(/_/g, " "),
    skills: cleanList(member.skills ?? [], 12, 60),
    recent_services: cleanList(topByCount(history.services, 3), 3, 40),
    recent_genres: cleanList(topByCount(history.genres, 5), 5, 40),
    credits: cleanList(member.credits ?? [], 5, 100),
  };
  const bio = clean(member.bio, 400);
  if (bio) out.bio = bio;
  return out;
}

/** True when the profile gives Jev anything to judge. An engineer with no
 *  skills, credits, bio or recent work is not asked about: any score would
 *  be noise. */
export function hasFitSignal(p: FitProfile): boolean {
  return Boolean(
    p.skills.length || p.credits.length || p.bio || p.recent_services.length || p.recent_genres.length,
  );
}

/** The state for one request: the session and the candidates, named. Built
 *  field by field in a fixed, readable order (a Convex round trip sorts keys
 *  alphabetically), which is also the last whitelist before anything leaves:
 *  a field not named here never reaches Jev. */
export function engineerFitState(session: FitSession, candidates: readonly FitProfile[]) {
  return {
    session: {
      service: session.service,
      ...(session.client_type ? { client_type: session.client_type } : {}),
      client_genres: [...session.client_genres],
      ...(session.song_genre ? { song_genre: session.song_genre } : {}),
      ...(session.title ? { title: session.title } : {}),
      ...(session.notes ? { notes: session.notes } : {}),
      ...(session.room
        ? { room: { name: session.room.name, ...(session.room.type ? { type: session.room.type } : {}) } }
        : {}),
    },
    candidates: candidates.map((p) => ({
      name: p.name,
      role: p.role,
      skills: [...p.skills],
      recent_services: [...p.recent_services],
      recent_genres: [...p.recent_genres],
      credits: [...p.credits],
      ...(p.bio ? { bio: p.bio } : {}),
    })),
  };
}

const ROLE_ORDER: Record<string, number> = { engineer: 0, producer: 1, assistant_engineer: 2, owner: 3 };

/** The order engineers are asked about in, which decides who is left out
 *  when more than MAX_FIT_CANDIDATES are free: first anyone who recently ran
 *  this service or worked these genres, then the fuller profile, then staff
 *  engineers before the owner, then by name. Jev scores each one on its own,
 *  so the order does not change anyone's answer. */
export function orderFitCandidates<T extends { name: string; role: string; profile: FitProfile }>(
  session: FitSession,
  candidates: readonly T[],
): T[] {
  const genres = new Set([...session.client_genres, session.song_genre ?? ""].map((g) => g.toLowerCase()).filter(Boolean));
  const service = session.service.toLowerCase();
  const relevance = (p: FitProfile) =>
    Number(p.recent_services.some((s) => s.toLowerCase() === service)) +
    Number(p.recent_genres.some((g) => genres.has(g.toLowerCase())));
  const evidence = (p: FitProfile) =>
    [p.skills.length, p.credits.length, p.bio ? 1 : 0, p.recent_services.length, p.recent_genres.length].filter(Boolean).length;
  return [...candidates].sort(
    (a, b) =>
      relevance(b.profile) - relevance(a.profile) ||
      evidence(b.profile) - evidence(a.profile) ||
      (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
      a.name.localeCompare(b.name),
  );
}

/* ---------- questions ---------- */

/** The answer id for `candidates[i]`. */
export const fitQuestionId = (i: number) => `fit_${i}`;

export type EngineerFitQuestion = ScoreQuestion<typeof ENGINEER_FIT_LEVELS>;

/** One Score question per candidate, each pointing at its engineer by state
 *  path. Sent together in one request. */
export function engineerFitQuestions(count: number): Record<string, EngineerFitQuestion> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_FIT_CANDIDATES) {
    throw new Error(`engineer fit asks about 1 to ${MAX_FIT_CANDIDATES} engineers, not ${count}`);
  }
  const questions: Record<string, EngineerFitQuestion> = {};
  for (let i = 0; i < count; i++) {
    questions[fitQuestionId(i)] = {
      type: "score",
      instructions:
        `How well does the engineer in \`candidates[${i}]\` fit the studio session in \`session\`? ` +
        "Judge their skills, recent services, recent genres, credits and bio against the session's service, genres, title, notes and room.",
      criteria: ENGINEER_FIT_LEVELS,
    };
  }
  return questions;
}

/* ---------- ranking ---------- */

export type FitAnswer = { score: number; confidence: number };

export type RankedFit<T> = T & {
  /** Expected level: 0 (wrong fit) to 3 (ideal). */
  score: number;
  /** score / 3, for display. */
  fit: number;
  /** Jev's confidence in the answer, 0 to 1. */
  confidence: number;
  /** The nearest level, and its short name. */
  level: number;
  label: string;
  /** Gets the "Suggested" chip. */
  suggested: boolean;
};

/** Rank candidates by Jev's expected score (ties: higher confidence, then
 *  the order asked). The first MAX_SUGGESTED that lean "Good fit" or better,
 *  with Jev not split, are marked suggested. A candidate whose answer is
 *  missing is left out. */
export function rankEngineerFit<T>(
  candidates: readonly T[],
  answers: Readonly<Record<string, FitAnswer | undefined>>,
): RankedFit<T>[] {
  const scored: { i: number; row: RankedFit<T> }[] = [];
  candidates.forEach((candidate, i) => {
    const answer = answers[fitQuestionId(i)];
    if (!answer || !Number.isFinite(answer.score)) return;
    const score = Math.min(TOP_LEVEL, Math.max(0, answer.score));
    const level = Math.round(score);
    scored.push({
      i,
      row: {
        ...candidate,
        score,
        fit: score / TOP_LEVEL,
        confidence: Number.isFinite(answer.confidence) ? answer.confidence : 0,
        level,
        label: FIT_LABELS[level],
        suggested: false,
      },
    });
  });
  scored.sort((a, b) => b.row.score - a.row.score || b.row.confidence - a.row.confidence || a.i - b.i);
  let picked = 0;
  for (const { row } of scored) {
    if (picked >= MAX_SUGGESTED) break;
    if (row.score >= SUGGEST_MIN_SCORE && row.confidence >= SUGGEST_MIN_CONFIDENCE) {
      row.suggested = true;
      picked += 1;
    }
  }
  return scored.map(({ row }) => row);
}

/* ---------- availability (decided in code, never by Jev) ---------- */

export type FitBusyData = {
  /** Sessions near the window, with ids, so the session itself is skipped. */
  sessions: readonly (SessionWindow & { _id: string })[];
  timeOff: readonly { memberId: string; startTime: number; endTime: number; status: string }[];
  shifts: readonly {
    memberId: string;
    startTime: number;
    endTime: number;
    status: string;
    kind: string;
    roomId?: string;
  }[];
};

/** Why an engineer cannot take [start,end), or null when nothing in the data
 *  says so: engineering another live session then, approved time off, or a
 *  scheduled shift pinned to a different room. A shift with no room, or in
 *  this session's room, means they are working then, which is no conflict. */
export function unavailableReason(
  memberId: string,
  window: { start: number; end: number; sessionId?: string; roomId?: string },
  data: FitBusyData,
  roomName: (roomId: string) => string | undefined = () => undefined,
): string | null {
  if (!engineerAvailable(memberId, window.start, window.end, [...data.sessions], window.sessionId)) {
    return "Engineering another session then";
  }
  if (
    data.timeOff.some(
      (t) => t.memberId === memberId && t.status === "approved" && overlaps(t.startTime, t.endTime, window.start, window.end),
    )
  ) {
    return "Approved time off";
  }
  const elsewhere = data.shifts.find(
    (s) =>
      s.memberId === memberId &&
      s.kind === "scheduled" &&
      s.status !== "cancelled" &&
      s.roomId !== undefined &&
      window.roomId !== undefined &&
      s.roomId !== window.roomId &&
      overlaps(s.startTime, s.endTime, window.start, window.end),
  );
  if (elsewhere?.roomId) return `On shift in ${roomName(elsewhere.roomId) ?? "another room"}`;
  return null;
}
