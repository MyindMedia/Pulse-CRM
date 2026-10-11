import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/* The feed sync action is public and takes an id, so the lookup it starts
   from must only hand back the caller's own studio's feed (pentest
   2026-10-11): another studio's id starts nothing. */

describe("external calendar feed lookup", () => {
  it("returns a feed to its own studio and nothing to another", async () => {
    const t = convexTest(schema);
    const id = await t.run(async (ctx) => {
      for (const orgId of ["org_a", "org_b"]) {
        await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "growth", status: "active" });
        await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", clerkUserId: `u_${orgId}`, skills: [] });
      }
      const roomId = await ctx.db.insert("rooms", { orgId: "org_a", name: "Studio A", status: "available" });
      return ctx.db.insert("externalCalendars", {
        orgId: "org_a", roomId, label: "Google Calendar", source: "google", active: true,
        icalUrl: "https://calendar.google.com/calendar/ical/secret/basic.ics",
      });
    });
    const own = await t.withIdentity({ subject: "u_org_a", orgId: "org_a" }).query(internal.externalCalendars.getForCaller, { id });
    expect(own?._id).toBe(id);
    const other = await t.withIdentity({ subject: "u_org_b", orgId: "org_b" }).query(internal.externalCalendars.getForCaller, { id });
    expect(other).toBeNull();
    // Signed out resolves to no studio of its own (or throws): never this feed.
    expect(await t.query(internal.externalCalendars.getForCaller, { id }).catch(() => null)).toBeNull();
  });
});
