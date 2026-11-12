import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { HEALTH_READ_CAP, studioHealthFor } from "./agentHealth";

/* The health score sits on the home screen tray and the fleet view runs it
   once per studio, so it must read only the rows the score uses, each read
   capped, and never a whole table (R13). */

const ORG = "org_health";
const DAY = 86_400_000;

/** Wraps ctx.db so every query read is counted per table, and any whole-range
 *  collect() is recorded. */
function counting(ctx: QueryCtx) {
  const read: Record<string, number> = {};
  const collected: string[] = [];
  const wrap = (table: string, builder: object): object =>
    new Proxy(builder, {
      get(target, prop, recv) {
        const value = Reflect.get(target, prop, recv);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const out = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (prop === "collect") collected.push(table);
          if (prop === "take" || prop === "collect") {
            return (out as Promise<unknown[]>).then((rows) => {
              read[table] = (read[table] ?? 0) + rows.length;
              return rows;
            });
          }
          if (prop === "first" || prop === "unique") {
            return (out as Promise<unknown>).then((row) => {
              read[table] = (read[table] ?? 0) + (row ? 1 : 0);
              return row;
            });
          }
          return out && typeof out === "object" ? wrap(table, out) : out;
        };
      },
    });
  const db = new Proxy(ctx.db, {
    get(target, prop, recv) {
      if (prop === "query") return (table: string) => wrap(table, target.query(table as never));
      const value = Reflect.get(target, prop, recv);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ctx: { ...ctx, db } as QueryCtx, read, collected };
}

describe("studio health reads", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Health", slug: "health", tier: "core", status: "active" });
      const artistId = await ctx.db.insert("artists", { orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 2, reliability: "solid" });
      await ctx.db.insert("rooms", { orgId: ORG, name: "A", status: "available" });
      // What the score uses: one unpaid overdue bill, one session this week,
      // one open lead, one song in production.
      await ctx.db.insert("invoices", { orgId: ORG, artistId, number: "1", status: "sent", amountCents: 1000, dueDate: now - DAY, lineItems: [] });
      await ctx.db.insert("sessions", { orgId: ORG, title: "Mix", artistId, serviceType: "mixing", startTime: now + DAY, endTime: now + DAY + 4 * 3_600_000, status: "confirmed", rateCents: 0, depositCents: 0, depositPaid: true, intakeCompleted: true });
      await ctx.db.insert("opportunities", { orgId: ORG, title: "Lead", artistId, stage: "inquiry", serviceType: "mixing", valueCents: 0, probability: 0.5, updatedAt: now });
      await ctx.db.insert("songs", { orgId: ORG, title: "Live", artistId, kind: "single", stage: "mixing", moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0 });
    });
  });

  async function seedHistory(n: number) {
    const now = Date.now();
    await t.run(async (ctx) => {
      const artistId = (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", ORG)).first())!._id;
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("invoices", { orgId: ORG, artistId, number: `p${i}`, status: i % 2 ? "paid" : "void", amountCents: 1000, dueDate: now - 400 * DAY, lineItems: [] });
        await ctx.db.insert("sessions", { orgId: ORG, title: "Old", artistId, serviceType: "mixing", startTime: now - (i + 2) * DAY, endTime: now - (i + 2) * DAY + 3_600_000, status: "completed", rateCents: 0, depositCents: 0, depositPaid: true, intakeCompleted: true });
        await ctx.db.insert("opportunities", { orgId: ORG, title: "Old", artistId, stage: i % 2 ? "won" : "lost", serviceType: "mixing", valueCents: 0, probability: 0, updatedAt: now });
        await ctx.db.insert("songs", { orgId: ORG, title: "Old", artistId, kind: "single", stage: i % 2 ? "delivered" : "released", moodTags: [], referenceTracks: [], revisionsIncluded: 2, revisionsUsed: 0 });
      }
    });
  }

  it("the query works and returns six parts", async () => {
    const h = await t.query(internal.agentHealth._healthFor, { orgId: ORG });
    expect(h.components).toHaveLength(6);
    expect(h.components.find((c) => c.key === "leads")?.signal).toBe("1 open leads, 0 stale");
    expect(h.components.find((c) => c.key === "projects")?.signal).toBe("1 active songs, 0 stalled");
    expect(h.components.find((c) => c.key === "revenue")?.signal).toMatch(/^1 overdue invoice/);
  });

  it("reads no paid bills, past sessions, closed leads or finished songs, and never collect()s", async () => {
    const before = await t.query(internal.agentHealth._healthFor, { orgId: ORG });
    await seedHistory(60);
    const after = await t.query(internal.agentHealth._healthFor, { orgId: ORG });
    expect(after).toEqual(before);

    await t.run(async (raw) => {
      const { ctx, read, collected } = counting(raw);
      await studioHealthFor(ctx, ORG);
      expect(collected).toEqual([]);
      expect(read.invoices).toBe(1);
      expect(read.sessions).toBe(1);
      expect(read.opportunities).toBe(1);
      expect(read.songs).toBe(1);
    });
  });

  it("caps each read even when the rows it wants pile up", async () => {
    const n = HEALTH_READ_CAP + 20;
    await t.run(async (ctx) => {
      const artistId = (await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", ORG)).first())!._id;
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("opportunities", { orgId: ORG, title: `L${i}`, artistId, stage: "qualified", serviceType: "mixing", valueCents: 0, probability: 0.5, updatedAt: 0 });
      }
    });
    await t.run(async (raw) => {
      const { ctx, read } = counting(raw);
      await studioHealthFor(ctx, ORG);
      // One inquiry plus the capped run of qualified leads.
      expect(read.opportunities).toBe(1 + HEALTH_READ_CAP);
    });
  });
});
