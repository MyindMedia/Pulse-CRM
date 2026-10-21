import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/* Studio groups in the shared Zuops sub-account: each phone a studio texts is
   tagged "Studio: <name>" on its Zuops lead, once. */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const AFTER_SWITCH = Date.parse("2026-10-21T20:00:00Z");

type Call = { url: string; method: string; body: Record<string, unknown> | null };
function stubFetch(answers: Array<() => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const a = answers[calls.length - 1];
    if (!a) throw new Error(`unexpected fetch ${url}`);
    return a();
  }));
  return calls;
}

describe("zuopsStudioTags", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    vi.stubEnv("SMS_PROVIDER", "zuops");
    vi.stubEnv("ZUOPS_SMS_API_KEY", "zu-test");
    vi.stubEnv("ZUOPS_SMS_WORKSPACE_ID", "ws");
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "Myind Sound", slug: "myind-sound", tier: "growth", status: "active" });
      await ctx.db.insert("artists", {
        orgId: "org_a", name: "Nova Reign", type: "artist", phone: "(404) 555-0134",
        genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("creates the lead in the studio's group with the client's name, then stops", async () => {
    await t.run((ctx) => ctx.db.insert("smsContacts", { phone: "+14045550134", orgId: "org_a", lastSentAt: AFTER_SWITCH }));
    const calls = stubFetch([() => json(201, { success: true, data: { lead: { id: "l1" } } })]);
    expect(await t.action(internal.zuopsStudioTags.tick, {})).toEqual({ tagged: 1, seen: 1 });
    expect(calls[0].body).toEqual({
      workspace_id: "ws", phone: "+14045550134", tags: ["pulse-sms", "Studio: Myind Sound"], run_intake: false, full_name: "Nova Reign",
    });
    expect(await t.action(internal.zuopsStudioTags.tick, {})).toEqual({ tagged: 0, seen: 0 });
  });

  it("adds the tag to an existing lead and keeps the name it already has", async () => {
    await t.run((ctx) => ctx.db.insert("smsContacts", { phone: "+14045550134", orgId: "org_a", lastSentAt: AFTER_SWITCH }));
    const calls = stubFetch([
      () => json(409, { success: false, details: { lead_id: "l9" } }),
      () => json(200, { success: true, data: { lead: { id: "l9", full_name: "Sales Lead Name" } } }),
      () => json(200, { success: true, data: {} }),
    ]);
    expect(await t.action(internal.zuopsStudioTags.tick, {})).toEqual({ tagged: 1, seen: 1 });
    expect(calls[2].method).toBe("PATCH");
    expect(calls[2].body).toEqual({ add_tags: ["pulse-sms", "Studio: Myind Sound"] });
  });

  it("leaves texts from the GHL era alone and retries a failure next run", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("smsContacts", { phone: "+14045550199", orgId: "org_a", lastSentAt: Date.parse("2026-10-01T00:00:00Z") });
      await ctx.db.insert("smsContacts", { phone: "+14045550134", orgId: "org_a", lastSentAt: AFTER_SWITCH });
    });
    stubFetch([() => json(500, { success: false })]);
    expect(await t.action(internal.zuopsStudioTags.tick, {})).toEqual({ tagged: 0, seen: 1 });
    stubFetch([() => json(201, { success: true, data: { lead: { id: "l1" } } })]);
    expect(await t.action(internal.zuopsStudioTags.tick, {})).toEqual({ tagged: 1, seen: 1 });
  });

  it("does nothing while another provider carries Pulse SMS", async () => {
    vi.stubEnv("SMS_PROVIDER", "ghl");
    const calls = stubFetch([]);
    expect(await t.action(internal.zuopsStudioTags.tick, {})).toEqual({ skipped: true });
    expect(calls).toHaveLength(0);
  });
});
