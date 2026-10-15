/* ============================================================
   Match an event from the studio's Google calendar to the studio's
   own rooms, clients and team (docs/plans/hardcover-booking.md, D).

   Pure on purpose: the pull, the review list and the import all ask
   the same question, and the answer has to be unit-tested without a
   database or the network.

   Rooms, in priority order:
   1. a Google room resource on the guest list ("Studio A" booked as a
      Workspace resource): exact, or strong when only the distinctive
      part of the name matches;
   2. the event's location: exact when it IS the room's name, strong
      when the full name or one named part of a compound name
      ("Studio A" of "Studio A - Live Room") appears in it, weak on a
      partial name;
   3. the event's title: strong on the full name, weak on a partial.
   Two rooms matching one source equally is ambiguous, so that source
   gives no answer; a later source can still decide, at weak at most.
   ============================================================ */

export type MatchConfidence = "exact" | "strong" | "weak" | "none";

export type RoomLike = { _id: string; name: string; status?: string };
export type PersonLike = { _id: string; name?: string; email?: string | null; role?: string };

export type GoogleAttendee = {
  email?: string;
  name?: string;
  responseStatus?: string;
  resource?: boolean;
  organizer?: boolean;
  self?: boolean;
};

export type EventForMatch = {
  title?: string;
  location?: string;
  attendees?: GoogleAttendee[];
  organizerEmail?: string;
};

export type RoomMatch = { roomId: string | null; confidence: MatchConfidence; reason: string };

/** Words that say "this is a room" without naming one. */
const ROOM_WORDS = new Set(["studio", "studios", "room", "rm", "suite", "booth", "the"]);

const RANK: Record<MatchConfidence, number> = { exact: 3, strong: 2, weak: 1, none: 0 };

/** Lowercase, strip accents, "&" to "and", every other symbol to a space. */
export function normalizeText(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokens(s: string | undefined | null): string[] {
  const n = normalizeText(s);
  return n ? n.split(" ") : [];
}

/** The distinctive part of a room name: "Studio A" -> ["a"], "Live Room" -> ["live"]. */
export function coreTokens(name: string): string[] {
  return tokens(name).filter((t) => !ROOM_WORDS.has(t));
}

/** A one-token phrase of one or two characters ("a", "1", "b2") means
 *  nothing on its own in free text ("a session"), so it only counts next
 *  to a room word ("studio a", "room 1", "a room"). */
function isFragile(phrase: string[]): boolean {
  return phrase.length === 1 && phrase[0].length <= 2;
}

/** Every start index where `phrase` appears in `text` as whole tokens. */
function phraseHits(text: string[], phrase: string[]): number[] {
  const out: number[] = [];
  if (phrase.length === 0 || phrase.length > text.length) return out;
  outer: for (let i = 0; i + phrase.length <= text.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (text[i + j] !== phrase[j]) continue outer;
    out.push(i);
  }
  return out;
}

type Level = "equal" | "full" | "partEqual" | "part" | "core";
type Hit = { roomId: string; roomName: string; level: Level; start: number; end: number };

/** The named parts of a compound room name: "Studio A - Live Room" is also
 *  called "Studio A" and "Live Room". */
export function nameParts(name: string): string[][] {
  const parts = name
    .split(/\s[-\u2013\u2014|/:]\s|[()[\],]/)
    .map((p) => tokens(p))
    .filter((t) => t.length > 0);
  const full = tokens(name).join(" ");
  return parts.length > 1 ? parts.filter((t) => t.join(" ") !== full && t.some((w) => !ROOM_WORDS.has(w))) : [];
}

/** How one room's name shows up in one piece of text, at its best. */
function roomHit(room: RoomLike, text: string[]): Hit | null {
  const full = tokens(room.name);
  const core = coreTokens(room.name);
  if (full.length === 0) return null;
  const joined = text.join(" ");
  if (joined === full.join(" ")) return { roomId: room._id, roomName: room.name, level: "equal", start: 0, end: text.length };
  if (core.length > 0 && joined === core.join(" ")) {
    return { roomId: room._id, roomName: room.name, level: "equal", start: 0, end: text.length };
  }
  const next = (i: number, len: number) => text[i + len];
  const prev = (i: number) => text[i - 1];
  const nearRoomWord = (i: number, len: number) =>
    (i > 0 && ROOM_WORDS.has(prev(i))) || (i + len < text.length && ROOM_WORDS.has(next(i, len)));

  // The whole name, e.g. "studio a" inside "tracking in studio a tonight".
  for (const i of phraseHits(text, full)) {
    if (isFragile(full) && !nearRoomWord(i, full.length)) continue;
    return { roomId: room._id, roomName: room.name, level: "full", start: i, end: i + full.length };
  }
  // One named part of a compound name, e.g. "studio a" for "Studio A - Live Room".
  for (const part of nameParts(room.name)) {
    if (joined === part.join(" ")) return { roomId: room._id, roomName: room.name, level: "partEqual", start: 0, end: text.length };
  }
  for (const part of nameParts(room.name)) {
    for (const i of phraseHits(text, part)) {
      if (isFragile(part) && !nearRoomWord(i, part.length)) continue;
      return { roomId: room._id, roomName: room.name, level: "part", start: i, end: i + part.length };
    }
  }
  // The distinctive part only, e.g. "live" for "Live Room", "a" next to "studio".
  if (core.length > 0 && core.length < full.length) {
    for (const i of phraseHits(text, core)) {
      if (isFragile(core) && !nearRoomWord(i, core.length)) continue;
      // Widen the span over an adjacent room word so "studio a" covers both tokens.
      const start = i > 0 && ROOM_WORDS.has(prev(i)) ? i - 1 : i;
      const end = i + core.length < text.length && ROOM_WORDS.has(next(i, core.length)) ? i + core.length + 1 : i + core.length;
      return { roomId: room._id, roomName: room.name, level: "core", start, end };
    }
  }
  return null;
}

const LEVEL_RANK: Record<Level, number> = { equal: 5, full: 4, partEqual: 3, part: 2, core: 1 };

/** The single best room for one piece of text, or why there is none. Hits
 *  inside a longer hit are dropped ("Studio A" inside "Studio A Live Room"
 *  when both are rooms), then the best level must be unique. */
function bestRoomIn(
  rooms: RoomLike[],
  text: string[],
): { hit: Hit | null; ambiguous: string[] } {
  if (text.length === 0) return { hit: null, ambiguous: [] };
  let hits = rooms.map((r) => roomHit(r, text)).filter((h): h is Hit => h !== null);
  if (hits.length === 0) return { hit: null, ambiguous: [] };
  hits = hits.filter(
    (h) =>
      !hits.some(
        (o) =>
          o !== h &&
          o.start <= h.start &&
          o.end >= h.end &&
          (o.end - o.start > h.end - h.start || LEVEL_RANK[o.level] > LEVEL_RANK[h.level]),
      ),
  );
  const top = Math.max(...hits.map((h) => LEVEL_RANK[h.level]));
  const best = hits.filter((h) => LEVEL_RANK[h.level] === top);
  // Equal levels: the longer phrase is the more specific name.
  const longest = Math.max(...best.map((h) => h.end - h.start));
  const winners = best.filter((h) => h.end - h.start === longest);
  if (winners.length === 1) return { hit: winners[0], ambiguous: [] };
  return { hit: null, ambiguous: winners.map((w) => w.roomName) };
}

function cap(c: MatchConfidence, max: MatchConfidence): MatchConfidence {
  return RANK[c] > RANK[max] ? max : c;
}

/** The room an event is for. */
export function matchRoom(event: EventForMatch, allRooms: RoomLike[]): RoomMatch {
  const rooms = allRooms.filter((r) => r.status !== "retired");
  if (rooms.length === 0) return { roomId: null, confidence: "none", reason: "The studio has no rooms yet." };
  let ambiguity: string | null = null;

  // 1. Room resources on the guest list.
  const resources = (event.attendees ?? []).filter((a) => a.resource);
  for (const res of resources) {
    const label = res.name || res.email?.split("@")[0] || "";
    const { hit, ambiguous } = bestRoomIn(rooms, tokens(label));
    if (hit) {
      const confidence: MatchConfidence = hit.level === "core" || hit.level === "part" ? "strong" : "exact";
      return { roomId: hit.roomId, confidence, reason: `Google room resource "${label}"` };
    }
    if (ambiguous.length > 1 && !ambiguity) ambiguity = `Room resource "${label}" fits ${ambiguous.join(" and ")}`;
  }

  // 2. Location.
  if (event.location?.trim()) {
    const { hit, ambiguous } = bestRoomIn(rooms, tokens(event.location));
    if (hit) {
      const base: MatchConfidence = hit.level === "equal" ? "exact" : hit.level === "core" ? "weak" : "strong";
      return {
        roomId: hit.roomId,
        confidence: ambiguity ? cap(base, "weak") : base,
        reason: `Location "${event.location.trim().slice(0, 80)}"`,
      };
    }
    if (ambiguous.length > 1 && !ambiguity) ambiguity = `Location names ${ambiguous.join(" and ")}`;
  }

  // 3. Title.
  if (event.title?.trim()) {
    const { hit, ambiguous } = bestRoomIn(rooms, tokens(event.title));
    if (hit) {
      const base: MatchConfidence = hit.level === "core" ? "weak" : "strong";
      return {
        roomId: hit.roomId,
        confidence: ambiguity ? cap(base, "weak") : base,
        reason: `Title mentions ${hit.roomName}`,
      };
    }
    if (ambiguous.length > 1 && !ambiguity) ambiguity = `Title names ${ambiguous.join(" and ")}`;
  }

  if (ambiguity) return { roomId: null, confidence: "none", reason: `${ambiguity}. Pick the room.` };
  return { roomId: null, confidence: "none", reason: "No room name in the resource, location or title." };
}

/** A confident match, safe to import without a person looking at it. */
export function isConfident(c: MatchConfidence): boolean {
  return c === "exact" || c === "strong";
}

/* ---------- people ---------- */

export function normEmail(e: string | undefined | null): string {
  return (e ?? "").trim().toLowerCase();
}

/** Guests who are people outside the studio: not a room, not the studio's
 *  own Google account, not a team member. */
export function externalGuests(
  event: EventForMatch,
  opts: { studioEmails: string[]; memberEmails: string[] },
): GoogleAttendee[] {
  const own = new Set([...opts.studioEmails, ...opts.memberEmails].map(normEmail).filter(Boolean));
  return (event.attendees ?? []).filter((a) => {
    if (a.resource || a.self) return false;
    const e = normEmail(a.email);
    if (!e || own.has(e)) return false;
    if (e.endsWith("resource.calendar.google.com") || e.endsWith("group.calendar.google.com")) return false;
    return true;
  });
}

export type ClientMatch =
  | { kind: "existing"; artistId: string; name: string; via: "email" | "name" }
  | { kind: "new"; name: string; email?: string }
  | { kind: "none" };

/** Who the booking is for: an existing client by guest email, then by a
 *  name in the title, else a new client from the first outside guest. */
export function matchClient(
  event: EventForMatch,
  artists: PersonLike[],
  opts: { studioEmails: string[]; memberEmails: string[] },
): ClientMatch {
  const guests = externalGuests(event, opts);
  const organizer = normEmail(event.organizerEmail);
  // An outside organizer (the client sent the invite) counts as a guest too.
  const emails = [...guests.map((g) => normEmail(g.email))];
  const own = new Set([...opts.studioEmails, ...opts.memberEmails].map(normEmail));
  if (organizer && !own.has(organizer) && !emails.includes(organizer)) emails.push(organizer);

  for (const e of emails) {
    const found = artists.filter((a) => normEmail(a.email) === e);
    if (found.length === 1) return { kind: "existing", artistId: found[0]._id, name: found[0].name ?? "", via: "email" };
  }

  const title = tokens(event.title);
  if (title.length > 0) {
    const named = artists.filter((a) => {
      const n = tokens(a.name);
      if (n.length === 0) return false;
      // One short word ("Al", "DJ") is too common to trust inside a title.
      if (n.length === 1 && n[0].length < 4) return false;
      return phraseHits(title, n).length > 0;
    });
    if (named.length === 1) return { kind: "existing", artistId: named[0]._id, name: named[0].name ?? "", via: "name" };
  }

  const first = guests[0];
  if (first) {
    const email = normEmail(first.email) || undefined;
    const name = first.name?.trim() || (email ? email.split("@")[0] : "");
    if (name) return { kind: "new", name, email };
  }
  return { kind: "none" };
}

const ENGINEER_ROLES = new Set(["engineer", "assistant_engineer", "producer"]);

/** The engineer: a team member in an engineering role who is on the guest
 *  list or organized the event. */
export function matchEngineer(event: EventForMatch, members: PersonLike[]): { memberId: string; name: string } | null {
  const emails = [
    ...(event.attendees ?? []).filter((a) => !a.resource && a.responseStatus !== "declined").map((a) => normEmail(a.email)),
    normEmail(event.organizerEmail),
  ].filter(Boolean);
  for (const e of emails) {
    const m = members.find((x) => normEmail(x.email) === e && ENGINEER_ROLES.has(x.role ?? ""));
    if (m) return { memberId: m._id, name: m.name ?? "" };
  }
  return null;
}
