import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

const DAY = 86_400_000;

async function seedSubscriber(
  t: ReturnType<typeof convexTest>,
  email: string,
  createdAt: number,
) {
  return await t.run((ctx) =>
    ctx.db.insert("subscribers", {
      email,
      source: "test",
      status: "subscribed" as const,
      createdAt,
      nurtureSent: [],
    }),
  );
}

describe("waitlist nurture sweep", () => {
  it("sends Day 0 immediately, then Day 2 and Day 5 as they come due, idempotently", async () => {
    const t = convexTest(schema);
    const t0 = Date.now();
    const id = await seedSubscriber(t, "a@studio.test", t0);

    // Day 0 fires at signup time; only one step per sweep.
    const s0 = await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 });
    expect(s0.scheduled).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(id)))!.nurtureSent).toEqual(["day0"]);

    // A second sweep at the same time sends nothing (deduped).
    expect((await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 })).scheduled).toBe(0);

    // Day 1: still nothing new (Day 2 not due yet).
    expect(
      (await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 + 1 * DAY })).scheduled,
    ).toBe(0);

    // Day 2: the second email becomes due.
    expect(
      (await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 + 2 * DAY })).scheduled,
    ).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(id)))!.nurtureSent).toEqual(["day0", "day2"]);

    // Day 5: the third email becomes due, then the sequence is exhausted.
    expect(
      (await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 + 5 * DAY })).scheduled,
    ).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(id)))!.nurtureSent).toEqual(["day0", "day2", "day5"]);
    expect(
      (await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 + 30 * DAY })).scheduled,
    ).toBe(0);
  });

  it("only advances one step per sweep even when several are overdue", async () => {
    const t = convexTest(schema);
    const t0 = Date.now();
    const id = await seedSubscriber(t, "dormant@studio.test", t0 - 10 * DAY);

    // All three are overdue, but a single sweep advances exactly one step.
    expect((await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 })).scheduled).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(id)))!.nurtureSent).toEqual(["day0"]);
    expect((await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 })).scheduled).toBe(1);
    expect((await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 })).scheduled).toBe(1);
    expect((await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 })).scheduled).toBe(0);
    expect((await t.run((ctx) => ctx.db.get(id)))!.nurtureSent).toEqual(["day0", "day2", "day5"]);
  });

  it("skips unsubscribed addresses", async () => {
    const t = convexTest(schema);
    const t0 = Date.now();
    const id = await seedSubscriber(t, "gone@studio.test", t0);
    await t.mutation(internal.subscribers.unsubscribeByEmail, { email: "GONE@studio.test", nowMs: t0 });

    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.status).toBe("unsubscribed");
    expect(row!.unsubscribedAt).toBe(t0);
    expect((await t.mutation(internal.subscribers.nurtureSweep, { nowMs: t0 })).scheduled).toBe(0);
  });
});

describe("waitlist capture (record upsert)", () => {
  it("inserts a new subscriber and reports isNew", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    const first = await t.mutation(internal.subscribers.record, {
      email: "new@studio.test",
      source: "footer",
      nowMs: now,
    });
    expect(first.isNew).toBe(true);

    const rows = await t.run((ctx) => ctx.db.query("subscribers").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("new@studio.test");
    expect(rows[0].status).toBe("subscribed");
    expect(rows[0].nurtureSent).toEqual([]);
  });

  it("is idempotent for a repeat signup (no duplicate row)", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.subscribers.record, { email: "dup@studio.test" });
    const second = await t.mutation(internal.subscribers.record, { email: "dup@studio.test" });
    expect(second.isNew).toBe(false);
    const rows = await t.run((ctx) => ctx.db.query("subscribers").collect());
    expect(rows).toHaveLength(1);
  });

  it("re-subscribes a previously unsubscribed address without resetting history", async () => {
    const t = convexTest(schema);
    const t0 = Date.now();
    const id = await seedSubscriber(t, "back@studio.test", t0);
    await t.run((ctx) => ctx.db.patch(id, { nurtureSent: ["day0"] }));
    await t.mutation(internal.subscribers.unsubscribeByEmail, { email: "back@studio.test", nowMs: t0 });

    const res = await t.mutation(internal.subscribers.record, { email: "back@studio.test" });
    expect(res.isNew).toBe(false);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.status).toBe("subscribed");
    expect(row!.unsubscribedAt).toBeUndefined();
    // History preserved: Day 0 is not re-sent.
    expect(row!.nurtureSent).toEqual(["day0"]);
  });
});
