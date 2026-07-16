import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ORG = "pulse-demo"; // the no-identity demo viewer resolves here

describe("arrival prep checklist", () => {
  let t: ReturnType<typeof convexTest>;
  let sessionId: Id<"sessions">;

  beforeEach(async () => {
    t = convexTest(schema);
    sessionId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("sessions", {
        orgId: ORG, title: "Tracking", artistId, serviceType: "recording",
        startTime: Date.now() + 3_600_000, endTime: Date.now() + 7_200_000,
        status: "confirmed", rateCents: 10_000, depositCents: 0,
        depositPaid: false, intakeCompleted: true,
      } as never);
    });
  });

  it("marks steps done, dedupes, and unmarks", async () => {
    await t.mutation(api.arrivalPrep.setStep, { sessionId, step: "parking", done: true });
    await t.mutation(api.arrivalPrep.setStep, { sessionId, step: "parking", done: true });
    await t.mutation(api.arrivalPrep.setStep, { sessionId, step: "room", done: true });
    let prep = await t.query(api.arrivalPrep.forSessions, { sessionIds: [sessionId] });
    expect(prep[sessionId]?.sort()).toEqual(["parking", "room"]);

    await t.mutation(api.arrivalPrep.setStep, { sessionId, step: "room", done: false });
    prep = await t.query(api.arrivalPrep.forSessions, { sessionIds: [sessionId] });
    expect(prep[sessionId]).toEqual(["parking"]);
  });

  it("rejects a session from another org", async () => {
    const foreign = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "other-org", name: "X", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      return ctx.db.insert("sessions", {
        orgId: "other-org", title: "Foreign", artistId, serviceType: "recording",
        startTime: Date.now(), endTime: Date.now() + 1,
        status: "confirmed", rateCents: 0, depositCents: 0,
        depositPaid: false, intakeCompleted: true,
      } as never);
    });
    await expect(
      t.mutation(api.arrivalPrep.setStep, { sessionId: foreign, step: "room", done: true }),
    ).rejects.toThrow();
    // And its prep state is invisible from this org.
    const prep = await t.query(api.arrivalPrep.forSessions, { sessionIds: [foreign] });
    expect(prep[foreign]).toBeUndefined();
  });
});
