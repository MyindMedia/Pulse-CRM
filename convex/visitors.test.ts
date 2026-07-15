import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const ORG = "pulse-demo"; // demo viewer resolves to this org with owner caps
const SLUG = "demo-studio";

function seedOrg(t: ReturnType<typeof convexTest>, orgId = ORG, slug = SLUG) {
  return t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: "Demo Studio", slug, plan: "studio" });
  });
}

describe("visitors - public QR check-in", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await seedOrg(t);
  });

  it("register creates the visit, an activity entry and a new client lead", async () => {
    const { visitId } = await t.mutation(api.visitors.register, {
      slug: SLUG,
      termsAccepted: true,
      name: "  Ray Vaughn ",
      email: "Ray@Example.com",
      phone: "555-0101",
      purpose: "Studio tour",
      hostName: "Mike",
    });

    const { visit, artists, activity } = await t.run(async (ctx) => ({
      visit: await ctx.db.get(visitId),
      artists: (await ctx.db.query("artists").collect()).filter((a) => a.orgId === ORG),
      activity: (await ctx.db.query("activity").collect()).filter((a) => a.orgId === ORG),
    }));

    expect(visit).toMatchObject({
      orgId: ORG,
      name: "Ray Vaughn",
      email: "ray@example.com", // trimmed + lowercased
      purpose: "Studio tour",
      hostName: "Mike",
      source: "qr",
    });
    expect(visit!.checkInAt).toBeGreaterThan(0);
    expect(visit!.checkOutAt).toBeUndefined();

    // The walk-in landed in the client database as an outreach-ready lead.
    expect(artists).toHaveLength(1);
    expect(artists[0]).toMatchObject({
      name: "Ray Vaughn",
      email: "ray@example.com",
      status: "lead",
      source: "visitor_qr",
    });
    expect(artists[0].tags).toContain("Visitor");
    expect(visit!.artistId).toEqual(artists[0]._id);

    expect(activity.some((a) => a.kind === "visitor.checked_in")).toBe(true);
  });

  it("register dedups into an existing client by email instead of duplicating", async () => {
    const existingId = await t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: ORG, name: "Ray Vaughn", type: "artist", email: "ray@example.com",
        genres: [], tags: [], status: "active", lifetimeValueCents: 50_000,
        sessionCount: 3, reliability: "solid", source: "web_booking",
      }),
    );

    const { visitId } = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "RAY@example.com", phone: "555-0101",
    });

    const { visit, artists } = await t.run(async (ctx) => ({
      visit: await ctx.db.get(visitId),
      artists: (await ctx.db.query("artists").collect()).filter((a) => a.orgId === ORG),
    }));

    expect(artists).toHaveLength(1); // no duplicate row
    expect(visit!.artistId).toEqual(existingId);
    expect(artists[0].source).toBe("web_booking"); // first-touch attribution wins
    expect(artists[0].phone).toBe("555-0101"); // missing contact detail filled in
    expect(artists[0].tags).toContain("Visitor");
    expect(artists[0].lastContactAt).toBeGreaterThan(0);
  });

  it("register rejects an unknown slug", async () => {
    await expect(
      t.mutation(api.visitors.register, { slug: "nope", termsAccepted: true, name: "X", email: "x@y.co" }),
    ).rejects.toThrow(/isn't active/);
  });

  it("register rejects a malformed email", async () => {
    await expect(
      t.mutation(api.visitors.register, { slug: SLUG, termsAccepted: true, name: "X", email: "not-an-email" }),
    ).rejects.toThrow(/valid email/);
  });

  it("register rate-limits at 60 check-ins per org per hour", async () => {
    const hourBucket = new Date().toISOString().slice(0, 13);
    await t.run(async (ctx) => {
      await ctx.db.insert("usageCounters", {
        orgId: ORG, period: hourBucket, metric: "visitor_checkins", value: 60, updatedAt: Date.now(),
      });
    });
    await expect(
      t.mutation(api.visitors.register, { slug: SLUG, termsAccepted: true, name: "X", email: "x@y.co" }),
    ).rejects.toThrow(/paused/);
  });
});

describe("visitors - staff surface", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await seedOrg(t);
  });

  it("registerManual logs a front-desk visit against the viewer's org", async () => {
    const { visitId } = await t.mutation(api.visitors.registerManual, {
      name: "Walk In", email: "walkin@example.com",
    });
    const visit = await t.run(async (ctx) => ctx.db.get(visitId));
    expect(visit).toMatchObject({ orgId: ORG, source: "front_desk" });
  });

  it("checkOut stamps the departure once and is idempotent", async () => {
    const { visitId } = await t.mutation(api.visitors.registerManual, {
      name: "Walk In", email: "walkin@example.com",
    });
    await t.mutation(api.visitors.checkOut, { id: visitId });
    const first = await t.run(async (ctx) => ctx.db.get(visitId));
    expect(first!.checkOutAt).toBeGreaterThan(0);

    await t.mutation(api.visitors.checkOut, { id: visitId });
    const second = await t.run(async (ctx) => ctx.db.get(visitId));
    expect(second!.checkOutAt).toEqual(first!.checkOutAt); // first stamp kept
  });

  it("list and directory never leak another org's visits", async () => {
    await t.mutation(api.visitors.registerManual, { name: "Ours", email: "ours@example.com" });
    await t.run(async (ctx) => {
      await ctx.db.insert("visitors", {
        orgId: "org_other", name: "Theirs", email: "theirs@example.com",
        checkInAt: Date.now(), source: "qr",
      });
    });

    const log = await t.query(api.visitors.list, {});
    expect(log).toHaveLength(1);
    expect(log[0].email).toBe("ours@example.com");

    const contacts = await t.query(api.visitors.directory, {});
    expect(contacts).toHaveLength(1);
    expect(contacts[0].email).toBe("ours@example.com");
  });

  it("directory groups repeat visits by email with counts and freshest details", async () => {
    await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray V", email: "ray@example.com",
    });
    await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "RAY@example.com", phone: "555-0101",
    });
    await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Nova", email: "nova@example.com",
    });

    const contacts = await t.query(api.visitors.directory, {});
    expect(contacts).toHaveLength(2);
    const ray = contacts.find((c) => c.email === "ray@example.com")!;
    expect(ray.visitCount).toBe(2);
    expect(ray.name).toBe("Ray Vaughn"); // freshest visit's details win
    expect(ray.phone).toBe("555-0101");
  });

  it("directory carries the client's lifetime bookings and spend", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", {
        orgId: ORG, name: "Ray Vaughn", type: "artist", email: "ray@example.com",
        genres: [], tags: [], status: "active", lifetimeValueCents: 125_000,
        sessionCount: 4, reliability: "solid",
      });
    });
    await t.mutation(api.visitors.registerManual, {
      name: "Ray Vaughn", email: "ray@example.com",
    });

    const contacts = await t.query(api.visitors.directory, {});
    const ray = contacts.find((c) => c.email === "ray@example.com")!;
    expect(ray.lifetimeBookings).toBe(4);
    expect(ray.lifetimeSpendCents).toBe(125_000);
  });
});

describe("visitors - required terms of service", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await seedOrg(t);
  });

  it("public register rejects a check-in without accepted terms", async () => {
    await expect(
      t.mutation(api.visitors.register, { slug: SLUG, name: "X", email: "x@y.co" }),
    ).rejects.toThrow(/visitor terms/);
    await expect(
      t.mutation(api.visitors.register, {
        slug: SLUG, termsAccepted: false, name: "X", email: "x@y.co",
      }),
    ).rejects.toThrow(/visitor terms/);
  });

  it("public register stamps the acceptance time", async () => {
    const { visitId } = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray", email: "ray@example.com",
    });
    const visit = await t.run(async (ctx) => ctx.db.get(visitId));
    expect(visit!.termsAcceptedAt).toBeGreaterThan(0);
  });

  it("staff manual entry needs no terms stamp", async () => {
    const { visitId } = await t.mutation(api.visitors.registerManual, {
      name: "Walk In", email: "walkin@example.com",
    });
    const visit = await t.run(async (ctx) => ctx.db.get(visitId));
    expect(visit!.termsAcceptedAt).toBeUndefined();
  });
});

describe("visitors - e-check-in against booked sessions", () => {
  let t: ReturnType<typeof convexTest>;

  function seedArtist(
    overrides: Partial<{ orgId: string; name: string; email: string }> = {},
  ) {
    return t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: overrides.orgId ?? ORG,
        name: overrides.name ?? "Ray Vaughn",
        type: "artist",
        email: overrides.email ?? "ray@example.com",
        genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      }),
    );
  }

  function seedSession(
    artistId: Awaited<ReturnType<typeof seedArtist>>,
    overrides: Partial<{
      orgId: string;
      title: string;
      status: "tentative" | "confirmed" | "in_progress" | "completed";
      startTime: number;
    }> = {},
  ) {
    const start = overrides.startTime ?? Date.now() + 2 * 60 * 60 * 1000;
    return t.run(async (ctx) =>
      ctx.db.insert("sessions", {
        orgId: overrides.orgId ?? ORG,
        title: overrides.title ?? "Vocal tracking",
        artistId,
        serviceType: "recording",
        startTime: start,
        endTime: start + 2 * 60 * 60 * 1000,
        status: overrides.status ?? "confirmed",
        rateCents: 20_000, depositCents: 6_000, depositPaid: true,
        intakeCompleted: false,
      }),
    );
  }

  beforeEach(async () => {
    t = convexTest(schema);
    await seedOrg(t);
  });

  it("an email match starts the confirmed session and links the visit", async () => {
    const artistId = await seedArtist();
    const sessionId = await seedSession(artistId);

    const result = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "RAY@example.com",
    });

    expect(result.session).toMatchObject({ title: "Vocal tracking", status: "in_progress" });
    const { visit, session, activity } = await t.run(async (ctx) => ({
      visit: await ctx.db.get(result.visitId),
      session: await ctx.db.get(sessionId),
      activity: (await ctx.db.query("activity").collect()).filter((a) => a.orgId === ORG),
    }));
    expect(visit!.sessionId).toEqual(sessionId);
    expect(visit!.sessionMatchedBy).toBe("email");
    expect(session!.status).toBe("in_progress"); // the kiosk's reactive query sees this live
    expect(activity.some((a) => a.kind === "session.checked_in")).toBe(true);
  });

  it("a tentative booking auto-confirms on arrival but does not start", async () => {
    const artistId = await seedArtist();
    const sessionId = await seedSession(artistId, { status: "tentative" });

    await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "ray@example.com",
    });

    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session!.status).toBe("confirmed"); // deposit still collectable before start
  });

  it("cross-compares by name when the email doesn't match, if unambiguous", async () => {
    const artistId = await seedArtist({ email: "manager@label.com" });
    const sessionId = await seedSession(artistId);

    const result = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "  ray  VAUGHN ", email: "ray.personal@gmail.com",
    });

    expect(result.session?.title).toBe("Vocal tracking");
    const visit = await t.run(async (ctx) => ctx.db.get(result.visitId));
    expect(visit!.sessionId).toEqual(sessionId);
    expect(visit!.sessionMatchedBy).toBe("name");
  });

  it("an ambiguous name-only match links nothing", async () => {
    const a1 = await seedArtist({ email: "a1@x.com" });
    const a2 = await seedArtist({ email: "a2@x.com" });
    await seedSession(a1, { title: "Session A" });
    await seedSession(a2, { title: "Session B" });

    const result = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "someone@else.com",
    });

    expect(result.session).toBeNull();
    const visit = await t.run(async (ctx) => ctx.db.get(result.visitId));
    expect(visit!.sessionId).toBeUndefined();
  });

  it("never touches sessions outside the arrival window", async () => {
    const artistId = await seedArtist();
    const sessionId = await seedSession(artistId, {
      startTime: Date.now() + 24 * 60 * 60 * 1000, // tomorrow
    });

    const result = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "ray@example.com",
    });

    expect(result.session).toBeNull();
    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session!.status).toBe("confirmed"); // untouched
  });

  it("never matches another org's session", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_other", name: "Other", slug: "other", plan: "studio" });
    });
    const artistId = await seedArtist({ orgId: "org_other" });
    const sessionId = await seedSession(artistId, { orgId: "org_other" });

    const result = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "ray@example.com",
    });

    expect(result.session).toBeNull();
    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session!.status).toBe("confirmed"); // the other tenant is untouched
  });

  it("an in_progress session links without a double transition", async () => {
    const artistId = await seedArtist();
    const sessionId = await seedSession(artistId, { status: "in_progress" });

    const result = await t.mutation(api.visitors.register, {
      slug: SLUG, termsAccepted: true, name: "Ray Vaughn", email: "ray@example.com",
    });

    expect(result.session?.status).toBe("in_progress");
    const { visit, activity } = await t.run(async (ctx) => ({
      visit: await ctx.db.get(result.visitId),
      activity: (await ctx.db.query("activity").collect()).filter((a) => a.orgId === ORG),
    }));
    expect(visit!.sessionId).toEqual(sessionId);
    // No status change happened, so no session.checked_in activity fires.
    expect(activity.some((a) => a.kind === "session.checked_in")).toBe(false);
  });

  it("manual front-desk entry e-checks in the same way", async () => {
    const artistId = await seedArtist();
    const sessionId = await seedSession(artistId);

    const result = await t.mutation(api.visitors.registerManual, {
      name: "Ray Vaughn", email: "ray@example.com",
    });

    expect(result.session?.status).toBe("in_progress");
    const visit = await t.run(async (ctx) => ctx.db.get(result.visitId));
    expect(visit!.sessionId).toEqual(sessionId);
  });
});
