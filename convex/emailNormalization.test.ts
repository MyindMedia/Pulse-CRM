import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/* Every write path normalizes now, but the rows written before that still
   hold whatever was typed - and an indexed lookup matches bytes. */

describe("normalizing stored addresses", () => {
  async function legacyRows(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "o1", name: "Playback", slug: "playback", plan: "studio", status: "active",
        ownerEmail: "Info@Playbackrecording.com",
      } as never);
      await ctx.db.insert("members", {
        orgId: "o1", name: "OT", email: " OT@Playback.com ", role: "owner", skills: [],
      } as never);
      await ctx.db.insert("members", {
        orgId: "o1", name: "Engineer", email: "engineer@playback.com", role: "engineer", skills: [],
      } as never);
      await ctx.db.insert("members", {
        orgId: "o1", name: "No email", role: "intern", skills: [],
      } as never);
    });
  }

  it("counts without changing anything on a dry run", async () => {
    const t = convexTest(schema);
    await legacyRows(t);

    const dry = await t.mutation(internal.emailNormalization._normalizeStoredEmails, {});
    expect(dry.applied).toBe(false);
    expect(dry.total).toBe(2);              // the org owner and the mixed-case seat
    expect(dry.changed.orgs).toBe(1);
    expect(dry.changed.members).toBe(1);

    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.ownerEmail).toBe("Info@Playbackrecording.com");
  });

  it("lowercases what is stored, and leaves clean rows alone", async () => {
    const t = convexTest(schema);
    await legacyRows(t);
    await t.mutation(internal.emailNormalization._normalizeStoredEmails, { apply: true });

    const org = (await t.run((ctx) => ctx.db.query("orgs").collect()))[0];
    expect(org.ownerEmail).toBe("info@playbackrecording.com");

    const members = await t.run((ctx) => ctx.db.query("members").collect());
    expect(members.find((m) => m.name === "OT")?.email).toBe("ot@playback.com");
    expect(members.find((m) => m.name === "Engineer")?.email).toBe("engineer@playback.com");
    expect(members.find((m) => m.name === "No email")?.email).toBeUndefined();
  });

  it("is idempotent - a second pass finds nothing", async () => {
    const t = convexTest(schema);
    await legacyRows(t);
    await t.mutation(internal.emailNormalization._normalizeStoredEmails, { apply: true });
    const again = await t.mutation(internal.emailNormalization._normalizeStoredEmails, {});
    expect(again.total).toBe(0);
  });
});
