import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Services are what a studio sells; rooms are what those services consume.
   Two services can share one room, and booking one has to take the other off
   the market - that is the whole reason a service is not a room. */

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("booking by service", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  let podcast: Id<"bookableServices">;
  let greenScreen: Id<"bookableServices">;
  let photoshoot: Id<"bookableServices">;
  let edit: Id<"feeTemplates">;
  let start: number;

  beforeEach(async () => {
    t = convexTest(schema);
    start = Date.now() + 7 * DAY;
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Slang City", slug: "slang-city", plan: "studio",
        status: "active", bookingCatalog: "services",
      } as never);
      const r = await ctx.db.insert("rooms", {
        orgId: "org1", name: "Live Room", status: "available", bookable: true,
        hourlyRateCents: 5000, minimumHours: 2, depositPct: 25,
      } as never);
      const fee = await ctx.db.insert("feeTemplates", {
        orgId: "org1", label: "Basic Polish Edit", amountCents: 7500,
        description: "Per episode.", active: true, createdAt: 0,
      } as never);
      const mk = (
        name: string,
        over: Record<string, unknown>,
      ) =>
        ctx.db.insert("bookableServices", {
          orgId: "org1", name, pricingMode: "hourly", priceCents: 15000,
          minimumHours: 2, roomId: r, order: 0, active: true, createdAt: 0,
          ...over,
        } as never);
      return {
        r,
        fee,
        podcast: await mk("Podcast", { addOnFeeIds: [fee], order: 0 }),
        green: await mk("Green Screen", { priceCents: 10000, minimumHours: 1, order: 1 }),
        photo: await mk("Photoshoot", {
          pricingMode: "flat", priceCents: 15000, blockHours: 2, order: 2,
        }),
      };
    });
    room = ids.r;
    edit = ids.fee;
    podcast = ids.podcast;
    greenScreen = ids.green;
    photoshoot = ids.photo;
  });

  const client = { clientName: "Nova", clientEmail: "nova@x.com" };

  it("shows the catalogue instead of rooms, and never names the room", async () => {
    const front = await t.query(api.booking.studioFront, { slug: "slang-city" });
    expect(front?.catalog).toBe("services");
    expect(front?.services.map((s) => s.name)).toEqual([
      "Podcast", "Green Screen", "Photoshoot",
    ]);
    expect(JSON.stringify(front?.services)).not.toContain("Live Room");
  });

  it("charges the service's rate, not the room's", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      serviceId: podcast, ...client, startTime: start, durationHours: 2,
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.rateCents).toBe(30000);   // 2 x $150, not 2 x $50
    expect(session?.roomId).toBe(room);        // and it books the room behind it
  });

  it("files the booking under the service's own name", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      serviceId: podcast, ...client, startTime: start, durationHours: 2,
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.serviceType).toBe("custom");
    expect(session?.customService).toBe("Podcast");
    expect(session?.title).toContain("Podcast");
  });

  it("blocks the other services in that room for the same hour", async () => {
    await t.mutation(api.booking.createBooking, {
      serviceId: podcast, ...client, startTime: start, durationHours: 2,
    });
    await expect(
      t.mutation(api.booking.createBooking, {
        serviceId: greenScreen, ...client, startTime: start + HOUR, durationHours: 1,
      }),
    ).rejects.toThrow(/just taken/i);
  });

  it("enforces the service's minimum, in the service's words", async () => {
    await expect(
      t.mutation(api.booking.createBooking, {
        serviceId: podcast, ...client, startTime: start, durationHours: 1,
      }),
    ).rejects.toThrow(/Podcast has a 2-hour minimum/);
  });

  it("sells a flat service as one block at one price", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      serviceId: photoshoot, ...client, startTime: start, durationHours: 2,
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.rateCents).toBe(15000);   // $150 for the session, not per hour
  });

  it("prices add-ons from the studio's own fee templates", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      serviceId: podcast, ...client, startTime: start, durationHours: 2,
      addOnFeeIds: [edit],
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.rateCents).toBe(30000 + 7500);
    expect(session?.serviceAddOns?.[0]).toMatchObject({
      label: "Basic Polish Edit", amountCents: 7500,
    });
  });

  it("refuses an add-on this service does not offer", async () => {
    await expect(
      t.mutation(api.booking.createBooking, {
        serviceId: greenScreen, ...client, startTime: start, durationHours: 1,
        addOnFeeIds: [edit],
      }),
    ).rejects.toThrow(/not offered with this service/i);
  });

  it("refuses a service that has been switched off", async () => {
    await t.run((ctx) => ctx.db.patch(podcast, { active: false }));
    await expect(
      t.mutation(api.booking.createBooking, {
        serviceId: podcast, ...client, startTime: start, durationHours: 2,
      }),
    ).rejects.toThrow(/no longer offered/i);
  });

  it("still books the old way when a room is passed", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, ...client, startTime: start, durationHours: 2,
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.rateCents).toBe(10000);   // 2 x the room's $50
    expect(session?.customService).toBeUndefined();
  });
});

describe("the catalogue falls back rather than showing nothing", () => {
  it("shows rooms when the studio switched to services but has none", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org2", name: "Empty", slug: "empty", plan: "studio",
        status: "active", bookingCatalog: "services",
      } as never);
      await ctx.db.insert("rooms", {
        orgId: "org2", name: "Studio A", status: "available", bookable: true,
        hourlyRateCents: 5000, minimumHours: 2, depositPct: 25,
      } as never);
    });
    const front = await t.query(api.booking.studioFront, { slug: "empty" });
    expect(front?.catalog).toBe("rooms");
    expect(front?.rooms).toHaveLength(1);
  });

  it("hides a service whose room was retired", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org3", name: "Retired", slug: "retired", plan: "studio",
        status: "active", bookingCatalog: "services",
      } as never);
      const r = await ctx.db.insert("rooms", {
        orgId: "org3", name: "Gone", status: "retired", bookable: true,
        hourlyRateCents: 5000, minimumHours: 2, depositPct: 25,
      } as never);
      await ctx.db.insert("bookableServices", {
        orgId: "org3", name: "Podcast", pricingMode: "hourly", priceCents: 15000,
        minimumHours: 2, roomId: r, order: 0, active: true, createdAt: 0,
      } as never);
    });
    const front = await t.query(api.booking.studioFront, { slug: "retired" });
    expect(front?.services).toHaveLength(0);
    expect(front?.catalog).toBe("rooms");
  });
});

describe("importing a catalogue from a brochure", () => {
  async function studio(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Slang City", slug: "slang-city", plan: "studio", status: "active",
      } as never);
      await ctx.db.insert("rooms", {
        orgId: "org1", name: "Studio A", status: "available", bookable: true,
        hourlyRateCents: 5000, minimumHours: 2, depositPct: 25,
      } as never);
      await ctx.db.insert("feeTemplates", {
        orgId: "org1", label: "Mix/Master", amountCents: 10000, active: true, createdAt: 0,
      } as never);
    });
  }

  const payload = {
    orgId: "org1",
    catalog: "services" as const,
    services: [
      {
        name: "Recording", pricingMode: "hourly" as const, priceCents: 5000,
        minimumHours: 2, roomName: "Studio A", sessionServiceType: "recording" as const,
        addOnLabels: ["Mix/Master"],
      },
    ],
  };

  it("counts without writing on a dry run", async () => {
    const t = convexTest(schema);
    await studio(t);
    const dry = await t.mutation(internal.bookableServices._importForOrg, payload);
    expect(dry.applied).toBe(false);
    expect(dry.created).toEqual(["Recording"]);
    const rows = await t.run((ctx) => ctx.db.query("bookableServices").collect());
    expect(rows).toHaveLength(0);
  });

  it("creates, links the add-on by label, and flips the catalogue", async () => {
    const t = convexTest(schema);
    await studio(t);
    await t.mutation(internal.bookableServices._importForOrg, { ...payload, apply: true });

    const rows = await t.run((ctx) => ctx.db.query("bookableServices").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(5000);
    expect(rows[0].addOnFeeIds).toHaveLength(1);

    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.bookingCatalog).toBe("services");
  });

  it("updates in place rather than doubling the page", async () => {
    const t = convexTest(schema);
    await studio(t);
    await t.mutation(internal.bookableServices._importForOrg, { ...payload, apply: true });
    await t.mutation(internal.bookableServices._importForOrg, {
      ...payload, apply: true,
      services: [{ ...payload.services[0], priceCents: 6000 }],
    });
    const rows = await t.run((ctx) => ctx.db.query("bookableServices").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].priceCents).toBe(6000);
  });

  it("names what it could not match instead of inventing it", async () => {
    const t = convexTest(schema);
    await studio(t);
    const res = await t.mutation(internal.bookableServices._importForOrg, {
      orgId: "org1", apply: true,
      services: [
        { name: "Podcast", pricingMode: "hourly" as const, priceCents: 15000,
          roomName: "Nonexistent Room", addOnLabels: ["No Such Fee"] },
      ],
    });
    expect(res.missingRooms).toEqual(["Podcast -> Nonexistent Room"]);
    const rows = await t.run((ctx) => ctx.db.query("bookableServices").collect());
    expect(rows).toHaveLength(0);
  });
});

/* Paid in full: the studio's choice, not the client's. A studio burned by
   no-shows sells the whole session up front - and then the checkout page must
   not offer a deposit that would not actually hold the room. */
describe("a room sold paid in full", () => {
  const client = { clientName: "Nova", clientEmail: "nova@x.com" };

  async function studio(t: ReturnType<typeof convexTest>, paymentMode?: "deposit" | "full") {
    return await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "orgF", name: "Full", slug: "full", plan: "studio", status: "active",
      } as never);
      const room = await ctx.db.insert("rooms", {
        orgId: "orgF", name: "Studio A", status: "available", bookable: true,
        hourlyRateCents: 10000, minimumHours: 2, depositPct: 25,
        ...(paymentMode ? { paymentMode } : {}),
      } as never);
      const svc = await ctx.db.insert("bookableServices", {
        orgId: "orgF", name: "Podcast", pricingMode: "hourly", priceCents: 15000,
        minimumHours: 2, roomId: room, order: 0, active: true, createdAt: 0,
      } as never);
      return { room, svc };
    });
  }

  it("takes the whole amount up front, not a percentage", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, "full");
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, ...client, startTime: Date.now() + 7 * DAY, durationHours: 2,
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.rateCents).toBe(20000);
    expect(session?.depositCents).toBe(20000);   // the whole thing, not 25%
  });

  it("still takes a deposit when the studio has not switched", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t);
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, ...client, startTime: Date.now() + 7 * DAY, durationHours: 2,
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.depositCents).toBe(5000);    // 25% of $200
  });

  it("applies to a service too - how a studio takes money is not per product", async () => {
    const t = convexTest(schema);
    const { svc } = await studio(t, "full");
    const res = await t.mutation(api.booking.createBooking, {
      serviceId: svc, ...client, startTime: Date.now() + 7 * DAY, durationHours: 2,
    });
    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.rateCents).toBe(30000);      // 2 x $150
    expect(session?.depositCents).toBe(30000);
  });

  it("tells the checkout page, so it never offers a deposit it will not take", async () => {
    const t = convexTest(schema);
    const { room } = await studio(t, "full");
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, ...client, startTime: Date.now() + 7 * DAY, durationHours: 2,
    });
    const booking = await t.query(api.booking.booking, { sessionId: res.sessionId });
    expect(booking?.paymentMode).toBe("full");

    const page = await t.query(api.booking.room, { roomId: room });
    expect(page?.paymentMode).toBe("full");
  });
});

/* The engineer chooser is the room's call. A studio that assigns its own
   engineer does not want a client picking a name and being told no - and with
   it off, the roster is not sent to the booking page at all. */
describe("choosing an engineer", () => {
  async function studio(t: ReturnType<typeof convexTest>, offerEngineer?: boolean) {
    return await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "orgE", name: "Eng", slug: "eng", plan: "studio", status: "active",
      } as never);
      const room = await ctx.db.insert("rooms", {
        orgId: "orgE", name: "Studio A", status: "available", bookable: true,
        hourlyRateCents: 10000, minimumHours: 2, depositPct: 25,
        ...(offerEngineer === undefined ? {} : { offerEngineer }),
      } as never);
      await ctx.db.insert("members", {
        orgId: "orgE", name: "Dre", email: "dre@x.com", role: "engineer", skills: [],
        bio: "Twenty years on the desk.",
      } as never);
      return room;
    });
  }

  const window = { startTime: Date.now() + 7 * 86_400_000, durationHours: 2 };

  it("offers the roster by default - it always did", async () => {
    const t = convexTest(schema);
    const roomId = await studio(t, undefined);
    const options = await t.query(api.booking.addOnOptions, { roomId, ...window });
    expect(options.engineers.map((e) => e.name)).toEqual(["Dre"]);

    const page = await t.query(api.booking.room, { roomId });
    expect(page?.offerEngineer).toBe(true);
  });

  it("sends no roster at all when the studio assigns its own", async () => {
    const t = convexTest(schema);
    const roomId = await studio(t, false);
    const options = await t.query(api.booking.addOnOptions, { roomId, ...window });
    expect(options.engineers).toEqual([]);
    // Not just hidden: the names, bios and photos never leave the server.
    expect(JSON.stringify(options)).not.toContain("Dre");

    const page = await t.query(api.booking.room, { roomId });
    expect(page?.offerEngineer).toBe(false);
  });

  it("tells the service page too, since a service inherits its room", async () => {
    const t = convexTest(schema);
    const roomId = await studio(t, false);
    const svc = await t.run((ctx) =>
      ctx.db.insert("bookableServices", {
        orgId: "orgE", name: "Podcast", pricingMode: "hourly", priceCents: 15000,
        minimumHours: 2, roomId, order: 0, active: true, createdAt: 0,
      } as never),
    );
    const service = await t.query(api.booking.service, { serviceId: svc });
    expect(service?.offerEngineer).toBe(false);
  });
});
