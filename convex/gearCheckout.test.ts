import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { ALL_FEATURES, CAPABILITY_TIER, type TierKey } from "./lib/pricing";
import { hasCapability } from "./lib/entitlements";
import { generateCode, normalizeCode } from "./lib/gearCode";
import { code128Widths } from "../src/lib/code128";

async function studio(t: ReturnType<typeof convexTest>, orgId: string, tier: TierKey) {
  const user = `u_${orgId}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier, status: "active" });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", skills: [], clerkUserId: user });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

const gear = (t: ReturnType<typeof convexTest>, orgId: string, name = "U87") =>
  t.run((ctx) =>
    ctx.db.insert("equipment", { orgId, name, category: "mic", status: "available", purchaseCents: 0, currentValueCents: 0 }),
  );
const memberOf = (t: ReturnType<typeof convexTest>, orgId: string) =>
  t.run(async (ctx) => (await ctx.db.query("members").collect()).find((m) => m.orgId === orgId)!._id);

const UPGRADE = { data: { code: "UPGRADE_REQUIRED" } };

describe("tier gate", () => {
  it("config sells gear check-out at Growth and flags it built", () => {
    const f = ALL_FEATURES.find((x) => x.gate === "gearCheckout")!;
    expect(f.tier).toBe("growth");
    expect(CAPABILITY_TIER.gearCheckout).toBe("growth");
    expect(hasCapability("core", "gearCheckout")).toBe(false);
    expect(hasCapability("growth", "gearCheckout")).toBe(true);
    expect(hasCapability("max", "gearCheckout")).toBe(true);
    expect(f.built).toBe(true);
  });

  it("Core is denied, Growth and Max are allowed", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    const growth = await studio(t, "o_growth", "growth");
    const max = await studio(t, "o_max", "max");
    await expect(core.query(api.gearCheckout.listOut, {})).rejects.toMatchObject(UPGRADE);
    const id = await gear(t, "o_core");
    await expect(core.mutation(api.gearCheckout.assignCode, { equipmentId: id })).rejects.toMatchObject(UPGRADE);
    await expect(growth.query(api.gearCheckout.listOut, {})).resolves.toEqual([]);
    await expect(max.query(api.gearCheckout.listOut, {})).resolves.toEqual([]);
  });
});

describe("check-out and check-in", () => {
  it("updates gear status and writes history", async () => {
    const t = convexTest(schema);
    const s = await studio(t, "o1", "growth");
    const id = await gear(t, "o1");
    const memberId = await memberOf(t, "o1");
    const code = await s.mutation(api.gearCheckout.assignCode, { equipmentId: id });

    await s.mutation(api.gearCheckout.checkOut, { code, holder: { kind: "member", memberId }, notes: "for tracking" });
    expect((await t.run((c) => c.db.get(id)))!.status).toBe("in_use");
    const out = await s.query(api.gearCheckout.listOut, {});
    expect(out).toHaveLength(1);
    expect(out[0].holderLabel).toBe("Owner");
    expect((await s.query(api.gearCheckout.lookup, { code }))!.out).not.toBeNull();

    await s.mutation(api.gearCheckout.checkIn, { code: code.toLowerCase(), notes: "all good" });
    expect((await t.run((c) => c.db.get(id)))!.status).toBe("available");
    expect(await s.query(api.gearCheckout.listOut, {})).toHaveLength(0);
    const hist = await s.query(api.gearCheckout.history, { equipmentId: id });
    expect(hist).toHaveLength(1);
    expect(hist[0].inAt).toBeTypeOf("number");
    expect(hist[0].returnNotes).toBe("all good");
    expect(hist[0].notes).toBe("for tracking");
  });

  it("refuses a double check-out and a return of gear that is not out", async () => {
    const t = convexTest(schema);
    const s = await studio(t, "o1", "growth");
    const id = await gear(t, "o1");
    const memberId = await memberOf(t, "o1");
    const holder = { kind: "member" as const, memberId };
    await expect(s.mutation(api.gearCheckout.checkIn, { equipmentId: id })).rejects.toMatchObject({ data: { code: "NOT_OUT" } });
    await s.mutation(api.gearCheckout.checkOut, { equipmentId: id, holder });
    await expect(s.mutation(api.gearCheckout.checkOut, { equipmentId: id, holder })).rejects.toMatchObject({ data: { code: "ALREADY_OUT" } });
    expect(await s.query(api.gearCheckout.listOut, {})).toHaveLength(1);
  });

  it("supports a rental holder and rejects a blank rental name", async () => {
    const t = convexTest(schema);
    const s = await studio(t, "o1", "growth");
    const id = await gear(t, "o1");
    await expect(s.mutation(api.gearCheckout.checkOut, { equipmentId: id, holder: { kind: "rental" } })).rejects.toMatchObject({ data: { code: "BAD_HOLDER" } });
    await s.mutation(api.gearCheckout.checkOut, { equipmentId: id, holder: { kind: "rental", label: "Dana (weekend)" } });
    expect((await s.query(api.gearCheckout.listOut, {}))[0].holderKind).toBe("rental");
  });
});

describe("overdue", () => {
  it("flags only open check-outs past due, and the sweep alerts once", async () => {
    const t = convexTest(schema);
    const s = await studio(t, "o1", "growth");
    const a = await gear(t, "o1", "A");
    const b = await gear(t, "o1", "B");
    const memberId = await memberOf(t, "o1");
    const holder = { kind: "member" as const, memberId };
    await s.mutation(api.gearCheckout.checkOut, { equipmentId: a, holder, dueAt: Date.now() + 60_000 });
    await s.mutation(api.gearCheckout.checkOut, { equipmentId: b, holder }); // no due date, never overdue
    expect(await s.query(api.gearCheckout.overdue, {})).toHaveLength(0);

    // Push A's due time into the past.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("gearCheckouts").collect()).find((r) => r.equipmentName === "A")!;
      await ctx.db.patch(row._id, { dueAt: Date.now() - 1000 });
    });
    const late = await s.query(api.gearCheckout.overdue, {});
    expect(late.map((r) => r.equipmentName)).toEqual(["A"]);
    expect((await s.query(api.gearCheckout.listOut, {}))[0].equipmentName).toBe("A"); // overdue first

    // Skip scheduling the push action in the test; the dedupe stamp is what matters.
    const first = await t.mutation(internal.gearCheckout.sweepOverdue, {});
    expect(first.notified).toBe(1);
    const second = await t.mutation(internal.gearCheckout.sweepOverdue, {});
    expect(second.notified).toBe(0);
    await s.mutation(api.gearCheckout.checkIn, { equipmentId: a });
    expect(await s.query(api.gearCheckout.overdue, {})).toHaveLength(0);
  });
});

describe("studio isolation and code uniqueness", () => {
  it("another studio's code reads as not found everywhere", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const b = await studio(t, "o_b", "growth");
    const idA = await gear(t, "o_a");
    const code = await a.mutation(api.gearCheckout.assignCode, { equipmentId: idA });
    const memberB = await memberOf(t, "o_b");

    expect(await b.query(api.gearCheckout.lookup, { code })).toBeNull();
    expect(await b.query(api.gearCheckout.lookup, { code: "PX-NOSUCH99" })).toBeNull();
    const holder = { kind: "member" as const, memberId: memberB };
    const e1 = await b.mutation(api.gearCheckout.checkOut, { code, holder }).catch((e) => e);
    const e2 = await b.mutation(api.gearCheckout.checkOut, { code: "PX-NOSUCH99", holder }).catch((e) => e);
    expect(e1.data).toEqual({ code: "NOT_FOUND", message: expect.any(String) });
    expect(e1.data).toEqual(e2.data); // indistinguishable from a code that does not exist
    // By id, too: the other studio's row is not found.
    await expect(b.mutation(api.gearCheckout.checkOut, { equipmentId: idA, holder })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await expect(b.mutation(api.gearCheckout.assignCode, { equipmentId: idA })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(await b.query(api.gearCheckout.history, { equipmentId: idA })).toEqual([]);
  });

  it("codes are unique per studio but may repeat across studios", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const b = await studio(t, "o_b", "growth");
    const one = await gear(t, "o_a", "One");
    const two = await gear(t, "o_a", "Two");
    const other = await gear(t, "o_b", "Other");
    await a.mutation(api.gearCheckout.assignCode, { equipmentId: one, code: "mic-001" });
    expect((await t.run((c) => c.db.get(one)))!.barcode).toBe("MIC-001");
    await expect(a.mutation(api.gearCheckout.assignCode, { equipmentId: two, code: " Mic-001 " })).rejects.toMatchObject({ data: { code: "CODE_TAKEN" } });
    await expect(a.mutation(api.gearCheckout.assignCode, { equipmentId: two, code: "!!" })).rejects.toMatchObject({ data: { code: "BAD_CODE" } });
    await expect(b.mutation(api.gearCheckout.assignCode, { equipmentId: other, code: "MIC-001" })).resolves.toBe("MIC-001");
  });

  it("generates distinct codes when none is given, and keeps an existing one", async () => {
    const t = convexTest(schema);
    const a = await studio(t, "o_a", "growth");
    const ids = [await gear(t, "o_a", "1"), await gear(t, "o_a", "2"), await gear(t, "o_a", "3")];
    const first = await a.mutation(api.gearCheckout.assignCode, { equipmentId: ids[0] });
    expect(first).toMatch(/^PX-[A-Z2-9]{8}$/);
    expect(await a.mutation(api.gearCheckout.assignCode, { equipmentId: ids[0] })).toBe(first);
    const res = await a.mutation(api.gearCheckout.assignMissingCodes, {});
    expect(res.assigned).toBe(2);
    const codes = (await a.query(api.gearCheckout.labels, {})).map((l) => l.barcode);
    expect(new Set(codes).size).toBe(3);
  });
});

describe("pure helpers", () => {
  it("normalizes and generates codes", () => {
    expect(normalizeCode("  px- ab c ")).toBe("PX-ABC");
    expect(generateCode(() => 0)).toBe("PX-AAAAAAAA");
  });
  it("Code 128 symbols are 11 modules wide, stop is 13", () => {
    const w = code128Widths("PX-7K3M9Q2T");
    expect(w.reduce((a, b) => a + b, 0) % 11).toBe(2); // n*11 + 13 total
    expect(w.length).toBe((1 + 11 + 1) * 6 + 7);
  });
});
