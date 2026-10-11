import { describe, it, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  ENGINEER_FIT_LEVELS,
  MAX_FIT_CANDIDATES,
  engineerFitQuestions,
  engineerFitState,
  engineerProfile,
  fitQuestionId,
  rankEngineerFit,
  scrubContact,
  sessionProfile,
  unavailableReason,
} from "./lib/jev/engineerFit";

/* Engineer-fit suggestions (Jev). The promises these tests hold: one request
   with one Score question per engineer; the ranking follows the expected
   score; who is busy is decided in code, never by Jev; only staff who may
   schedule can ask; contact details and pay never reach the state; and
   when Jev is unavailable there is simply nothing to show. Nothing is ever
   assigned. */

const systemOne = vi.fn();
vi.mock("@typesafe-ai/sdk", () => {
  class APIError extends Error {}
  class TypeSafeClient {
    systemOne = systemOne;
  }
  return { TypeSafeClient, APIError };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ORG = "studio_fit";

type Req = {
  state: { session: Record<string, unknown>; candidates: { name: string }[] };
  questions: Record<string, { type: string; instructions: string; criteria: readonly string[] }>;
};

/** A Score answer the way Jev returns one. */
const scoreAnswer = (score: number, confidence: number) => ({
  type: "score",
  score,
  confidence,
  legend: Object.fromEntries(ENGINEER_FIT_LEVELS.map((l, i) => [String(i), l])),
  probabilities: { "0": 0, "1": 0, "2": 0, "3": 0 },
});

/** Answer every question in the request from a score per engineer name. */
function answerByName(byName: Record<string, [number, number]>) {
  systemOne.mockImplementation(async (req: Req) => ({
    model: "jev-1.13.0",
    answers: Object.fromEntries(
      Object.keys(req.questions).map((id) => {
        const i = Number(id.split("_")[1]);
        const [score, confidence] = byName[req.state.candidates[i].name] ?? [1, 0.5];
        return [id, scoreAnswer(score, confidence)];
      }),
    ),
    usage: { input_tokens: 900, output_tokens: 40 },
  }));
}

const lastRequest = (): Req => systemOne.mock.calls[systemOne.mock.calls.length - 1][0] as Req;

/* ---------- a studio ---------- */

async function seed(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const start = now + 2 * DAY;
  const end = start + 4 * HOUR;
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: ORG, name: "Fit Studio", slug: "fit", tier: "growth", status: "active" });
    await ctx.db.insert("members", { orgId: ORG, name: "Mo Manager", role: "manager", clerkUserId: "u_mgr", skills: [] });
    const roomA = await ctx.db.insert("rooms", { orgId: ORG, name: "Studio A", roomType: "Live room", status: "available" });
    const roomB = await ctx.db.insert("rooms", { orgId: ORG, name: "Studio B", status: "available" });

    const member = (name: string, role: "engineer" | "assistant_engineer" | "producer" | "accountant" | "intern", extra: Record<string, unknown> = {}) =>
      ctx.db.insert("members", { orgId: ORG, name, role, skills: [], ...extra });
    const maya = await member("Maya Mixwell", "engineer", {
      clerkUserId: "u_maya",
      skills: ["Pro Tools", "Neve 1073"],
      bio: "Hip hop and R&B vocal tracking and mixing. Book me at maya@example.com or 404-555-0199.",
      credits: ["Midnight Drive (mix)"],
      email: "maya@example.com",
      phone: "+14045550199",
      notes: "Asked for a raise in March",
      payType: "hourly",
      payRateCents: 987654,
      commissionPct: 37,
    });
    const theo = await member("Theo Tracker", "engineer", { skills: ["Ableton", "drum tracking"], bio: "Rock and metal tracking engineer." });
    await member("Ana Assist", "assistant_engineer", { skills: ["Pro Tools"] });
    const ben = await member("Ben Busy", "engineer", { skills: ["SSL"], bio: "Pop mixing." });
    const olga = await member("Olga Off", "engineer", { skills: ["Mastering"], bio: "Mastering engineer." });
    const ray = await member("Ray Roomb", "producer", { skills: ["Beats"], bio: "Hip hop producer." });
    const sam = await member("Sam Sameroom", "engineer", { skills: ["Neve"], bio: "Tracking." });
    await member("Eve Empty", "engineer");
    await member("Al Accounts", "accountant", { skills: ["QuickBooks"] });
    await member("Ian Intern", "intern", { skills: ["Pro Tools"] });

    const artist = (name: string, genres: string[], extra: Record<string, unknown> = {}) =>
      ctx.db.insert("artists", {
        orgId: ORG, name, type: "artist", genres, tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid", ...extra,
      });
    const nova = await artist("Nova", ["hip hop", "r&b"], { email: "nova@client.com", phone: "(404) 555-0140" });
    const band = await artist("The Rocks", ["rock"], { type: "band" });

    const session = (fields: Record<string, unknown>) =>
      ctx.db.insert("sessions", {
        orgId: ORG, title: "Session", artistId: nova, serviceType: "recording",
        startTime: start, endTime: end, status: "confirmed",
        rateCents: 40000, depositCents: 12000, depositPaid: false, intakeCompleted: false,
        ...fields,
      } as never);
    const target = await session({
      title: "Nova vocals",
      roomId: roomA,
      status: "tentative",
      notes: "Client cell 404-555-0140, email nova@client.com, IG @nova.music. Wants the Neve and a warm vocal chain.",
    });

    // Busy: Ben engineers an overlapping live session.
    await session({ title: "Other client", artistId: band, roomId: roomB, engineerId: ben, startTime: start + HOUR, endTime: start + 3 * HOUR });
    // Not busy: Theo's overlapping session was cancelled, and his time off is only requested.
    await session({ title: "Called off", artistId: band, engineerId: theo, status: "cancelled", startTime: start, endTime: end });
    await ctx.db.insert("timeOff", { orgId: ORG, memberId: theo, startTime: start - HOUR, endTime: end, status: "pending" });
    // Busy: Olga has approved time off.
    await ctx.db.insert("timeOff", { orgId: ORG, memberId: olga, startTime: start - HOUR, endTime: start + 10 * HOUR, status: "approved" });
    // Busy: Ray is on shift in another room. Not busy: Sam is on shift in this room.
    await ctx.db.insert("shifts", { orgId: ORG, memberId: ray, roomId: roomB, kind: "scheduled", status: "scheduled", startTime: start, endTime: start + 8 * HOUR });
    await ctx.db.insert("shifts", { orgId: ORG, memberId: sam, roomId: roomA, kind: "scheduled", status: "scheduled", startTime: start, endTime: start + 8 * HOUR });

    // Recent work: Maya mixes hip hop, Theo tracks a rock band.
    await session({ title: "Past mix", engineerId: maya, serviceType: "mixing", status: "completed", startTime: now - 10 * DAY, endTime: now - 10 * DAY + 3 * HOUR });
    await session({ title: "Past band", artistId: band, engineerId: theo, status: "completed", startTime: now - 5 * DAY, endTime: now - 5 * DAY + 3 * HOUR });

    return { target, nova, roomA, roomB, maya, theo, ben, olga, ray, sam };
  });
}

const initT = () => convexTest(schema);
const asManager = (t: ReturnType<typeof initT>) => t.withIdentity({ subject: "u_mgr", orgId: ORG });

/* ---------- pure ---------- */

describe("engineer fit questions (pure)", () => {
  it("asks one Score question per candidate, pointing at its engineer by state path, on four described levels", () => {
    const qs = engineerFitQuestions(3);
    expect(Object.keys(qs)).toEqual(["fit_0", "fit_1", "fit_2"]);
    Object.values(qs).forEach((q, i) => {
      expect(q.type).toBe("score");
      expect(q.criteria).toBe(ENGINEER_FIT_LEVELS);
      expect(q.instructions).toContain(`\`candidates[${i}]\``);
      expect(q.instructions).toContain("`session`");
    });
    // Each level stands on its own: a described situation, no numbers, no "previous level".
    expect(ENGINEER_FIT_LEVELS).toHaveLength(4);
    expect(new Set(ENGINEER_FIT_LEVELS).size).toBe(4);
    for (const level of ENGINEER_FIT_LEVELS) {
      expect(level.length).toBeGreaterThan(40);
      expect(level).not.toMatch(/\d|previous|above|below/i);
    }
    expect(() => engineerFitQuestions(0)).toThrow();
    expect(() => engineerFitQuestions(MAX_FIT_CANDIDATES + 1)).toThrow();
  });

  it("ranks by expected score, breaks ties on confidence, and suggests at most two good fits Jev is not split on", () => {
    const people = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const answers = {
      [fitQuestionId(0)]: { score: 1.2, confidence: 0.9 },
      [fitQuestionId(1)]: { score: 2.8, confidence: 0.95 },
      [fitQuestionId(2)]: { score: 2.1, confidence: 0.6 },
      [fitQuestionId(3)]: { score: 2.1, confidence: 0.8 },
      [fitQuestionId(4)]: { score: 1.8, confidence: 0.1 },
    };
    const ranked = rankEngineerFit(people, answers);
    expect(ranked.map((r) => r.id)).toEqual(["b", "d", "c", "e", "a"]);
    expect(ranked.filter((r) => r.suggested).map((r) => r.id)).toEqual(["b", "d"]);
    expect(ranked[0]).toMatchObject({ label: "Ideal fit", level: 3 });
    expect(ranked[1]).toMatchObject({ label: "Good fit", level: 2 });
    expect(ranked[0].fit).toBeCloseTo(2.8 / 3);

    // A top score Jev is split on gets no chip; the next good fit does.
    const split = rankEngineerFit(people.slice(0, 2), {
      [fitQuestionId(0)]: { score: 2.0, confidence: 0.1 },
      [fitQuestionId(1)]: { score: 1.6, confidence: 0.7 },
    });
    expect(split.map((r) => [r.id, r.suggested])).toEqual([["a", false], ["b", true]]);

    // Nobody leaning good: no chip at all. A missing answer is left out.
    const weak = rankEngineerFit(people.slice(0, 3), {
      [fitQuestionId(0)]: { score: 1.4, confidence: 0.9 },
      [fitQuestionId(2)]: { score: 0.2, confidence: 0.9 },
    });
    expect(weak.map((r) => r.id)).toEqual(["a", "c"]);
    expect(weak.some((r) => r.suggested)).toBe(false);
  });

  it("puts work facts in the state and never contact details or pay", () => {
    const fullMemberRow = {
      name: "Maya", role: "assistant_engineer", skills: ["Neve 1073"], credits: ["Midnight Drive (mix)"],
      bio: "Vocals and mixing. Email maya@example.com, call (404) 555-0199, see https://maya.example.com or @mayamix",
      email: "maya@example.com", phone: "+14045550199", payRateCents: 987654, commissionPct: 37, notes: "Asked for a raise",
    };
    const profile = engineerProfile(fullMemberRow, { services: ["mixing", "recording", "mixing"], genres: ["hip hop", "Hip Hop", "r&b"] });
    expect(profile).toEqual({
      name: "Maya",
      role: "assistant engineer",
      skills: ["Neve 1073"],
      recent_services: ["mixing", "recording"],
      recent_genres: ["hip hop", "r&b"],
      credits: ["Midnight Drive (mix)"],
      bio: "Vocals and mixing. Email [contact removed], call [contact removed], see [contact removed] or [contact removed]",
    });
    const json = JSON.stringify(profile);
    for (const secret of ["maya@example.com", "555-0199", "4045550199", "987654", "raise", "mayamix"]) {
      expect(json).not.toContain(secret);
    }

    const session = sessionProfile(
      { serviceType: "custom", customService: "Podcast", title: "Ep 4 (call 310.555.0123)", notes: "Text me on 07700 900123 or 555-0140" },
      { artist: { type: "band", genres: ["indie"], email: "x@y.co", phone: "07700 900123" }, room: { name: "Booth", roomType: "Vocal booth" }, songGenre: "dream pop" },
    );
    expect(session).toEqual({
      service: "Podcast",
      client_type: "band",
      client_genres: ["indie"],
      song_genre: "dream pop",
      title: "Ep 4 (call [contact removed])",
      notes: "Text me on [contact removed] or [contact removed]",
      room: { name: "Booth", type: "Vocal booth" },
    });

    // The state is rebuilt field by field: a fixed readable order, and nothing
    // that is not named there (even a field smuggled onto a profile) leaves.
    const smuggled = { ...profile, email: "maya@example.com", payRateCents: 987654 } as typeof profile;
    const state = engineerFitState(session, [smuggled]);
    expect(Object.keys(state)).toEqual(["session", "candidates"]);
    expect(Object.keys(state.session)).toEqual(["service", "client_type", "client_genres", "song_genre", "title", "notes", "room"]);
    expect(Object.keys(state.candidates[0])).toEqual(["name", "role", "skills", "recent_services", "recent_genres", "credits", "bio"]);
    expect(JSON.stringify(state)).not.toMatch(/maya@example\.com|987654/);

    // Studio shorthand that only looks numeric survives.
    expect(scrubContact("Neve 1073 into an LA-2A, 10:00-14:00, 24-bit/96k, the 2024-2025 album")).toBe(
      "Neve 1073 into an LA-2A, 10:00-14:00, 24-bit/96k, the 2024-2025 album",
    );
  });

  it("decides who is busy in code: a live overlapping session, approved time off, a shift in another room", () => {
    const window = { start: 1000, end: 2000, sessionId: "s_this", roomId: "room_a" };
    const empty = { sessions: [], timeOff: [], shifts: [] };
    const live = { _id: "s_other", engineerId: "m1", startTime: 1500, endTime: 2500, status: "confirmed" };
    expect(unavailableReason("m1", window, { ...empty, sessions: [live] })).toBe("Engineering another session then");
    expect(unavailableReason("m1", window, { ...empty, sessions: [{ ...live, status: "cancelled" }] })).toBeNull();
    expect(unavailableReason("m1", window, { ...empty, sessions: [{ ...live, _id: "s_this" }] })).toBeNull();
    expect(unavailableReason("m1", window, { ...empty, sessions: [{ ...live, startTime: 2000 }] })).toBeNull();

    const off = { memberId: "m1", startTime: 0, endTime: 1200, status: "approved" };
    expect(unavailableReason("m1", window, { ...empty, timeOff: [off] })).toBe("Approved time off");
    expect(unavailableReason("m1", window, { ...empty, timeOff: [{ ...off, status: "pending" }] })).toBeNull();
    expect(unavailableReason("m2", window, { ...empty, timeOff: [off] })).toBeNull();

    const shift = { memberId: "m1", startTime: 0, endTime: 5000, status: "scheduled", kind: "scheduled", roomId: "room_b" };
    const names = (id: string) => (id === "room_b" ? "Studio B" : undefined);
    expect(unavailableReason("m1", window, { ...empty, shifts: [shift] }, names)).toBe("On shift in Studio B");
    expect(unavailableReason("m1", window, { ...empty, shifts: [{ ...shift, roomId: "room_a" }] })).toBeNull();
    expect(unavailableReason("m1", window, { ...empty, shifts: [{ ...shift, roomId: undefined }] })).toBeNull();
    expect(unavailableReason("m1", window, { ...empty, shifts: [{ ...shift, status: "cancelled" }] })).toBeNull();
    expect(unavailableReason("m1", { ...window, roomId: undefined }, { ...empty, shifts: [shift] })).toBeNull();
  });
});

/* ---------- the action ---------- */

describe("jevEngineerFit.suggest", () => {
  beforeEach(() => {
    systemOne.mockReset();
    vi.stubEnv("TYPESAFE_API_KEY", "ts-test");
  });

  it("asks Jev once, one Score question per free engineer, and returns them ranked by expected score", async () => {
    const t = initT();
    const { target } = await seed(t);
    answerByName({
      "Maya Mixwell": [2.8, 0.9],
      "Sam Sameroom": [1.9, 0.6],
      "Ana Assist": [1.2, 0.7],
      "Theo Tracker": [0.4, 0.9],
    });

    const res = await asManager(t).action(api.jevEngineerFit.suggest, { sessionId: target });

    expect(systemOne).toHaveBeenCalledTimes(1);
    const req = lastRequest();
    const names = req.state.candidates.map((c) => c.name);
    // Recent relevant work first (Maya: hip hop, Theo: recording), then fuller profiles.
    expect(names).toEqual(["Maya Mixwell", "Theo Tracker", "Sam Sameroom", "Ana Assist"]);
    expect(Object.keys(req.questions)).toHaveLength(names.length);
    Object.entries(req.questions).forEach(([id, q]) => {
      expect(q.type).toBe("score");
      expect(q.criteria).toEqual([...ENGINEER_FIT_LEVELS]);
      expect(q.instructions).toContain(`\`candidates[${id.split("_")[1]}]\``);
    });
    expect(req.state.session).toMatchObject({ service: "recording", client_genres: ["hip hop", "r&b"], room: { name: "Studio A", type: "Live room" } });

    expect(res.status).toBe("ok");
    expect(res.suggestions.map((s) => [s.name, s.suggested])).toEqual([
      ["Maya Mixwell", true],
      ["Sam Sameroom", true],
      ["Ana Assist", false],
      ["Theo Tracker", false],
    ]);
    expect(res.suggestions[0]).toMatchObject({ score: 2.8, confidence: 0.9, label: "Ideal fit" });

    // Recent work describes the engineer; the session itself does not count.
    const maya = req.state.candidates[0] as unknown as { recent_services: string[]; recent_genres: string[] };
    expect(maya.recent_services).toEqual(["mixing"]);
    expect(maya.recent_genres).toEqual(["hip hop", "r&b"]);

    // A suggestion is never an assignment.
    const after = await t.run((ctx) => ctx.db.get(target));
    expect(after?.engineerId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("shifts").collect())).toHaveLength(2);
  });

  it("rules busy engineers out in code: another session, approved time off, a shift in another room", async () => {
    const t = initT();
    const { target, ben, olga, ray } = await seed(t);
    answerByName({});

    const res = await asManager(t).action(api.jevEngineerFit.suggest, { sessionId: target });

    const asked = lastRequest().state.candidates.map((c) => c.name);
    for (const busy of ["Ben Busy", "Olga Off", "Ray Roomb"]) expect(asked).not.toContain(busy);
    // A cancelled session, a pending time-off request and a shift in this room do not rule anyone out.
    expect(asked).toEqual(expect.arrayContaining(["Theo Tracker", "Sam Sameroom"]));
    // Not engineers, or nothing to judge: not asked either.
    for (const other of ["Al Accounts", "Ian Intern", "Mo Manager", "Eve Empty"]) expect(asked).not.toContain(other);

    expect(res.excluded).toEqual(
      expect.arrayContaining([
        { memberId: ben, name: "Ben Busy", reason: "Engineering another session then" },
        { memberId: olga, name: "Olga Off", reason: "Approved time off" },
        { memberId: ray, name: "Ray Roomb", reason: "On shift in Studio B" },
        expect.objectContaining({ name: "Eve Empty", reason: "No skills, credits, bio or recent sessions to judge" }),
      ]),
    );
    expect(res.suggestions.map((s) => s.name)).not.toContain("Ben Busy");
  });

  it("keeps contact details and pay out of the state", async () => {
    const t = initT();
    const { target } = await seed(t);
    answerByName({});
    await asManager(t).action(api.jevEngineerFit.suggest, { sessionId: target });

    const json = JSON.stringify(lastRequest().state);
    for (const secret of [
      "maya@example.com", "4045550199", "404-555-0199", "987654", "raise",
      "nova@client.com", "555-0140", "@nova.music",
    ]) {
      expect(json).not.toContain(secret);
    }
    // The work facts are there.
    expect(json).toContain("warm vocal chain");
    expect(json).toContain("Neve 1073");
  });

  it("only viewers who may schedule staff can ask, and only about their own studio", async () => {
    const t = initT();
    const { target } = await seed(t);
    answerByName({});
    const asEngineer = t.withIdentity({ subject: "u_maya", orgId: ORG });

    await expect(asEngineer.action(api.jevEngineerFit.suggest, { sessionId: target })).rejects.toThrow(/schedule\.manage/);
    expect(await asEngineer.query(api.jevEngineerFit.available, {})).toBe(false);
    expect(await asManager(t).query(api.jevEngineerFit.available, {})).toBe(true);
    expect(systemOne).not.toHaveBeenCalled();

    // A manager cannot ask about another studio's session.
    const foreign = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "other_org", name: "Other", slug: "other", tier: "growth", status: "active" });
      const a = await ctx.db.insert("artists", {
        orgId: "other_org", name: "X", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("sessions", {
        orgId: "other_org", title: "Theirs", artistId: a, serviceType: "recording", startTime: 1, endTime: 2,
        status: "confirmed", rateCents: 0, depositCents: 0, depositPaid: false, intakeCompleted: false,
      });
    });
    await expect(asManager(t).action(api.jevEngineerFit.suggest, { sessionId: foreign })).rejects.toThrow(/not found/i);
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("returns no suggestions, without an error, when Jev is unavailable", async () => {
    const t = initT();
    const { target } = await seed(t);

    systemOne.mockRejectedValue(new Error("network down"));
    const down = await asManager(t).action(api.jevEngineerFit.suggest, { sessionId: target });
    expect(down).toMatchObject({ status: "unavailable", suggestions: [], model: null });
    expect(systemOne).toHaveBeenCalledTimes(1);

    systemOne.mockReset();
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const noKey = await asManager(t).action(api.jevEngineerFit.suggest, { sessionId: target });
    expect(noKey).toMatchObject({ status: "unavailable", suggestions: [] });
    expect(systemOne).not.toHaveBeenCalled();
    // No key: the button is not offered at all, so the page is as it was.
    expect(await asManager(t).query(api.jevEngineerFit.available, {})).toBe(false);
  });

  it("ranks a booking being filled in, ruling out busy engineers only once it has a time", async () => {
    const t = initT();
    const { nova, roomA } = await seed(t);
    answerByName({});
    const draft = { serviceType: "mixing" as const, artistId: nova, roomId: roomA };

    await asManager(t).action(api.jevEngineerFit.suggest, { draft });
    const untimed = lastRequest();
    expect(untimed.state.session).toMatchObject({ service: "mixing", client_genres: ["hip hop", "r&b"] });
    expect(untimed.state.candidates.map((c) => c.name)).toEqual(expect.arrayContaining(["Ben Busy", "Olga Off", "Ray Roomb"]));

    const start = await t.run(async (ctx) => (await ctx.db.query("timeOff").collect()).find((x) => x.status === "approved")!.startTime + HOUR);
    await asManager(t).action(api.jevEngineerFit.suggest, { draft: { ...draft, startTime: start, endTime: start + 2 * HOUR } });
    expect(lastRequest().state.candidates.map((c) => c.name)).not.toContain("Olga Off");
  });

  it("asks about at most ten engineers in one request", async () => {
    const t = initT();
    const { target } = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        await ctx.db.insert("members", { orgId: ORG, name: `Extra ${String(i).padStart(2, "0")}`, role: "engineer", skills: ["Pro Tools"] });
      }
    });
    answerByName({});
    const res = await asManager(t).action(api.jevEngineerFit.suggest, { sessionId: target });
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(Object.keys(lastRequest().questions)).toHaveLength(MAX_FIT_CANDIDATES);
    expect(lastRequest().state.candidates).toHaveLength(MAX_FIT_CANDIDATES);
    // Recent relevant work is asked about first; the overflow is named, not silently dropped.
    expect(lastRequest().state.candidates.map((c) => c.name)).toEqual(expect.arrayContaining(["Maya Mixwell", "Theo Tracker"]));
    expect(res.excluded.filter((e) => /limit/.test(e.reason))).toHaveLength(6);
  });
});

