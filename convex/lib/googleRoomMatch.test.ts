import { describe, it, expect } from "vitest";
import { matchRoom, matchClient, matchEngineer, normalizeText, coreTokens, isConfident, externalGuests } from "./googleRoomMatch";

const rooms = [
  { _id: "rA", name: "Studio A" },
  { _id: "rB", name: "Studio B" },
  { _id: "rLive", name: "Live Room" },
];

describe("normalize", () => {
  it("lowercases, strips accents and punctuation, keeps words", () => {
    expect(normalizeText("  Studio A - Live Room!! ")).toBe("studio a live room");
    expect(normalizeText("Café & Booth")).toBe("cafe and booth");
    expect(coreTokens("Studio A")).toEqual(["a"]);
    expect(coreTokens("The Live Room")).toEqual(["live"]);
  });
});

describe("matchRoom", () => {
  it("a Google room resource is exact", () => {
    const m = matchRoom({ title: "Session", attendees: [{ email: "c_123@resource.calendar.google.com", name: "Studio B", resource: true }] }, rooms);
    expect(m).toMatchObject({ roomId: "rB", confidence: "exact" });
    expect(m.reason).toContain("resource");
  });

  it("a resource beats a location naming another room", () => {
    const m = matchRoom({ location: "Studio A", attendees: [{ name: "Live Room", resource: true }] }, rooms);
    expect(m.roomId).toBe("rLive");
  });

  it("a resource named only by its distinctive part is strong", () => {
    const m = matchRoom({ attendees: [{ name: "HQ-1 Live (8)", resource: true }] }, rooms);
    expect(m).toMatchObject({ roomId: "rLive", confidence: "strong" });
  });

  it("location equal to the room name is exact; containing it is strong", () => {
    expect(matchRoom({ location: "studio a" }, rooms)).toMatchObject({ roomId: "rA", confidence: "exact" });
    expect(matchRoom({ location: "Pulse HQ, Studio B, 12 Main St" }, rooms)).toMatchObject({ roomId: "rB", confidence: "strong" });
    expect(matchRoom({ location: "Live" }, rooms)).toMatchObject({ roomId: "rLive", confidence: "exact" });
  });

  it("title naming a room is strong; a partial name is weak", () => {
    expect(matchRoom({ title: "Jay Rock tracking - Studio A" }, rooms)).toMatchObject({ roomId: "rA", confidence: "strong" });
    expect(matchRoom({ title: "Drums in the live today" }, rooms)).toMatchObject({ roomId: "rLive", confidence: "weak" });
    expect(isConfident("weak")).toBe(false);
  });

  it("a one-letter room code needs a room word next to it", () => {
    // "a" here is an article, not Studio A.
    expect(matchRoom({ title: "A session with Kim" }, rooms).roomId).toBeNull();
    expect(matchRoom({ title: "Kim in room A" }, rooms)).toMatchObject({ roomId: "rA", confidence: "weak" });
  });

  it("the more specific room wins: 'Studio A - Live Room' vs 'Studio A' vs 'Live Room'", () => {
    const three = [...rooms, { _id: "rAL", name: "Studio A - Live Room" }];
    expect(matchRoom({ location: "Studio A - Live Room" }, three)).toMatchObject({ roomId: "rAL", confidence: "exact" });
    expect(matchRoom({ location: "Studio A" }, three)).toMatchObject({ roomId: "rA", confidence: "exact" });
    expect(matchRoom({ location: "Live Room" }, three)).toMatchObject({ roomId: "rLive", confidence: "exact" });
    expect(matchRoom({ title: "Overdubs, Studio A Live Room" }, three).roomId).toBe("rAL");
  });

  it("a named part of a compound room name matches it", () => {
    const demo = [
      { _id: "r1", name: "Studio A - Live Room" },
      { _id: "r2", name: "Studio B - Mix Suite" },
      { _id: "r3", name: "The Loft - Writing Room" },
    ];
    expect(matchRoom({ location: "Studio A" }, demo)).toMatchObject({ roomId: "r1", confidence: "strong" });
    expect(matchRoom({ title: "Kendra mix, Mix Suite" }, demo)).toMatchObject({ roomId: "r2", confidence: "strong" });
    expect(matchRoom({ attendees: [{ name: "The Loft", resource: true }] }, demo)).toMatchObject({ roomId: "r3", confidence: "exact" });
    // A room actually called "Studio A" beats the part of another room's name.
    expect(matchRoom({ location: "Studio A" }, [...demo, { _id: "r4", name: "Studio A" }])).toMatchObject({ roomId: "r4", confidence: "exact" });
  });

  it("two rooms named equally is ambiguous: no room, with the reason", () => {
    const m = matchRoom({ location: "Studio A - Live Room" }, rooms);
    expect(m.roomId).toBeNull();
    expect(m.confidence).toBe("none");
    expect(m.reason).toContain("Studio A");
    expect(m.reason).toContain("Live Room");
  });

  it("an ambiguous location can be settled by the title, but only as a weak guess", () => {
    const m = matchRoom({ location: "Studio A / Studio B", title: "Mix - Studio B" }, rooms);
    expect(m).toMatchObject({ roomId: "rB", confidence: "weak" });
  });

  it("no match, and retired rooms never match", () => {
    expect(matchRoom({ title: "Dentist", location: "123 Elm St" }, rooms)).toMatchObject({ roomId: null, confidence: "none" });
    expect(matchRoom({ location: "Studio B" }, [{ _id: "rB", name: "Studio B", status: "retired" }]).roomId).toBeNull();
  });
});

describe("matchClient + matchEngineer", () => {
  const artists = [
    { _id: "a1", name: "Kendra Mills", email: "kendra@example.com" },
    { _id: "a2", name: "Al", email: "al@example.com" },
  ];
  const members = [
    { _id: "m1", name: "Eve", email: "eve@studio.com", role: "engineer" },
    { _id: "m2", name: "Olive", email: "owner@studio.com", role: "owner" },
  ];
  const emails = { studioEmails: ["studio@studio.com"], memberEmails: ["eve@studio.com", "owner@studio.com"] };

  it("finds an existing client by guest email, ignoring the studio and the team", () => {
    const ev = {
      attendees: [
        { email: "studio@studio.com", self: true },
        { email: "eve@studio.com" },
        { email: "KENDRA@example.com", name: "K" },
      ],
    };
    expect(matchClient(ev, artists, emails)).toEqual({ kind: "existing", artistId: "a1", name: "Kendra Mills", via: "email" });
    expect(externalGuests(ev, emails).map((g) => g.email)).toEqual(["KENDRA@example.com"]);
  });

  it("falls back to a client name in the title, never a short common name", () => {
    expect(matchClient({ title: "Kendra Mills vocals" }, artists, emails)).toMatchObject({ kind: "existing", artistId: "a1", via: "name" });
    expect(matchClient({ title: "Al session" }, artists, emails)).toEqual({ kind: "none" });
  });

  it("offers a new client from the first outside guest", () => {
    expect(matchClient({ attendees: [{ email: "new@x.com", name: "New Person" }] }, artists, emails)).toEqual({ kind: "new", name: "New Person", email: "new@x.com" });
  });

  it("matches the engineer by email, engineering roles only", () => {
    expect(matchEngineer({ attendees: [{ email: "Eve@Studio.com" }] }, members)).toEqual({ memberId: "m1", name: "Eve" });
    expect(matchEngineer({ organizerEmail: "owner@studio.com" }, members)).toBeNull();
    expect(matchEngineer({ attendees: [{ email: "eve@studio.com", responseStatus: "declined" }] }, members)).toBeNull();
  });
});
