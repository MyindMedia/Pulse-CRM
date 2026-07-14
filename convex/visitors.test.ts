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
      slug: SLUG, name: "Ray Vaughn", email: "RAY@example.com", phone: "555-0101",
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
      t.mutation(api.visitors.register, { slug: "nope", name: "X", email: "x@y.co" }),
    ).rejects.toThrow(/isn't active/);
  });

  it("register rejects a malformed email", async () => {
    await expect(
      t.mutation(api.visitors.register, { slug: SLUG, name: "X", email: "not-an-email" }),
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
      t.mutation(api.visitors.register, { slug: SLUG, name: "X", email: "x@y.co" }),
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
      slug: SLUG, name: "Ray V", email: "ray@example.com",
    });
    await t.mutation(api.visitors.register, {
      slug: SLUG, name: "Ray Vaughn", email: "RAY@example.com", phone: "555-0101",
    });
    await t.mutation(api.visitors.register, {
      slug: SLUG, name: "Nova", email: "nova@example.com",
    });

    const contacts = await t.query(api.visitors.directory, {});
    expect(contacts).toHaveLength(2);
    const ray = contacts.find((c) => c.email === "ray@example.com")!;
    expect(ray.visitCount).toBe(2);
    expect(ray.name).toBe("Ray Vaughn"); // freshest visit's details win
    expect(ray.phone).toBe("555-0101");
  });
});
