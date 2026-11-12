import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { recordSmsContact } from "./lib/smsContacts";

/* client-messages-has-been-notified-acks: "{studio} has been notified" was
   texted even when nobody was told (no manager phone on file), the low-rating
   reply promised the owner would "personally make it right", and LATE picked
   the first client with that phone across every studio. */
const HOUR = 3_600_000;
const CLIENT = "+14045550188";

type T = ReturnType<typeof convexTest>;

async function studio(t: T, orgId: string, name: string, opts: { managerPhone?: string; ownerEmail?: string } = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name, slug: orgId, tier: "growth", status: "active",
      ...(opts.ownerEmail ? { ownerEmail: opts.ownerEmail } : {}),
    } as never);
    await ctx.db.insert("members", {
      orgId, name: "Mgr", role: "manager", skills: [], ...(opts.managerPhone ? { phone: opts.managerPhone } : {}),
    } as never);
    return await ctx.db.insert("artists", {
      orgId, name: "Nova", type: "artist", phone: CLIENT,
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    });
  });
}

async function texts(t: T) {
  const rows = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return rows
    .map((r) => r.args[0] as { to?: string; body?: string })
    .filter((a) => a?.to && a?.body) as { to: string; body: string }[];
}

describe("'has been notified' acks", () => {
  it("LATE with nobody reachable does not claim the studio was notified", async () => {
    const t = convexTest(schema);
    await studio(t, "org_a", "Alpha");
    await t.mutation(internal.sms._handleInbound, { from: CLIENT, body: "LATE" });
    const toClient = (await texts(t)).filter((x) => x.to === CLIENT);
    expect(toClient).toHaveLength(1);
    expect(toClient[0].body).not.toContain("has been notified");
    expect(toClient[0].body).toContain("could not reach Alpha");
  });

  it("LATE with a manager phone texts the manager and acks", async () => {
    const t = convexTest(schema);
    await studio(t, "org_a", "Alpha", { managerPhone: "+14045550100" });
    await t.mutation(internal.sms._handleInbound, { from: CLIENT, body: "LATE" });
    const all = await texts(t);
    expect(all.some((x) => x.to === "+14045550100" && /running LATE/.test(x.body))).toBe(true);
    expect(all.find((x) => x.to === CLIENT)?.body).toContain("Alpha has been notified you are running late");
  });

  it("LATE with no manager phone emails the owner, and then the ack is true", async () => {
    const t = convexTest(schema);
    await studio(t, "org_a", "Alpha", { ownerEmail: "owner@a.test" });
    await t.mutation(internal.sms._handleInbound, { from: CLIENT, body: "LATE" });
    const mail = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").collect()).find((n) => n.kind === "sms.manager_alert"),
    );
    expect(mail?.recipient).toBe("owner@a.test");
    expect((await texts(t)).find((x) => x.to === CLIENT)?.body).toContain("has been notified");
  });

  it("LATE from a client of two studios goes to the studio that texted them last", async () => {
    const t = convexTest(schema);
    await studio(t, "org_a", "Alpha", { managerPhone: "+14045550100" });
    await studio(t, "org_b", "Bravo", { managerPhone: "+14045550200" });
    await t.run(async (ctx) => {
      await recordSmsContact(ctx, "org_b", CLIENT);
    });
    await t.mutation(internal.sms._handleInbound, { from: CLIENT, body: "LATE" });
    const all = await texts(t);
    expect(all.some((x) => x.to === "+14045550200")).toBe(true);
    expect(all.some((x) => x.to === "+14045550100")).toBe(false);
    expect(all.find((x) => x.to === CLIENT)?.body).toContain("Bravo has been notified");
  });

  it("a low rating does not promise the owner will personally make it right", async () => {
    const t = convexTest(schema);
    const artistId = await studio(t, "org_a", "Alpha", { managerPhone: "+14045550100" });
    await t.run(async (ctx) => {
      await ctx.db.insert("smsPrompts", {
        orgId: "org_a", phone: CLIENT, kind: "review_rating", artistId,
        status: "open", sentAt: Date.now(), expiresAt: Date.now() + HOUR,
      });
    });
    await t.mutation(internal.sms._handleInbound, { from: CLIENT, body: "2" });
    const ack = (await texts(t)).find((x) => x.to === CLIENT)?.body ?? "";
    expect(ack).toContain("Sorry the session missed the mark.");
    expect(ack).toContain("We have passed this to the studio owner.");
    expect(ack).not.toMatch(/personally|make it right/);
  });
});
