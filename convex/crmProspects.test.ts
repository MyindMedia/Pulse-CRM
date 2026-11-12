import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { STATUS_TAGS, batchSize, isOptedOut, leadBody, outreachStageKey, primaryEmail, statusTag } from "./crmProspects";

/* Outreach prospects into Zuops (eval U-17). convex-test with a mocked fetch;
   invented studios only. */

const PULSE = "org_pulse";
const OTHER = "org_other";
const STUDIO = "org_studio";

const NORTHLINE = {
  name: "Northline Sound",
  handle: "northlinesound",
  websiteUrl: "https://northline.example",
  email: "hello@northline.example",
  owner: "maya@northline.example",
  number: "+12135550142",
};

type Ident = { subject: string; name: string; orgId: string; orgType: string };
const agencyIdent = (subject: string, orgId: string): Ident => ({ subject, name: subject, orgId, orgType: "agency" });
const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data, error: null }), { status });
const fail = (status: number, error: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ success: false, data: null, ...error }), { status, headers });

type Call = { url: string; method: string; body: unknown; idem?: string };

describe("crmProspects", () => {
  let t: ReturnType<typeof convexTest>;
  let calls: Call[];
  let respond: (c: Call) => Response;
  let stages: Array<{ key: string; label: string }>;
  let leadSeq: number;

  /** A Zuops stand-in: stages list and create, lead create, tag patch, do-not-contact. */
  const zuops = (c: Call): Response => {
    const path = new URL(c.url).pathname;
    if (path === "/v1/stages" && c.method === "GET") return ok({ stages });
    if (path === "/v1/stages" && c.method === "POST") {
      const s = { key: "outreach_1", label: (c.body as { label: string }).label };
      stages.push(s);
      return ok({ stage: s }, 201);
    }
    if (path === "/v1/leads" && c.method === "POST") return ok({ lead: { id: `lead_${++leadSeq}` } }, 201);
    return ok({});
  };

  beforeEach(async () => {
    t = convexTest(schema);
    calls = [];
    stages = [{ key: "new", label: "New" }, { key: "contacted", label: "Contacted" }];
    leadSeq = 0;
    respond = zuops;
    vi.stubEnv("PULSE_AGENCY_ID", PULSE);
    vi.stubEnv("ZUOPS_CRM_API_KEY", "zu-rw-test");
    vi.stubEnv("ZUOPS_CRM_WRITES", "on");
    vi.stubEnv("ZUOPS_CRM_MOCK_URL", "");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      const c: Call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, idem: headers["Idempotency-Key"] };
      calls.push(c);
      return respond(c);
    }));
    await t.run(async (ctx) => {
      for (const [agency, owner] of [[PULSE, "u_owner"], [OTHER, "u_other"]] as const) {
        await ctx.db.insert("agencies", { agencyId: agency, name: agency, slug: agency, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x.example` });
        await ctx.db.insert("agencyMembers", { agencyId: agency, clerkUserId: owner, email: `${owner}@x.example`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      }
      await ctx.db.insert("agencyMembers", { agencyId: PULSE, clerkUserId: "u_staff", email: "s@x.example", name: "staff", role: "staff", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: STUDIO, name: "Studio", slug: "studio", tier: "growth", status: "active" });
      await ctx.db.insert("members", { orgId: STUDIO, name: "Owen Owner", role: "owner", skills: [], clerkUserId: "u_studio", email: "owen@x.example" });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const owner = () => t.withIdentity(agencyIdent("u_owner", PULSE) as never);

  let seq = 0;
  /** A prospect with published emails AND published numbers (the numbers must never reach Zuops). */
  const addProspect = (over: Record<string, unknown> = {}, emails: Array<{ address: string; generic: boolean }> = [
    { address: NORTHLINE.email, generic: true },
    { address: NORTHLINE.owner, generic: false },
  ]) =>
    t.run(async (ctx) => {
      seq++;
      return await ctx.db.insert("outreachProspects", {
        agencyId: PULSE, dedupeKey: `site:northline${seq}.example`, handle: NORTHLINE.handle, name: NORTHLINE.name, websiteUrl: NORTHLINE.websiteUrl,
        source: "paste", status: "scraped", createdAt: 1000 + seq, updatedAt: 1000 + seq,
        contacts: {
          emails: emails.map((e, i) => ({ ...e, rank: i, sourceUrl: NORTHLINE.websiteUrl })),
          phones: [{ number: NORTHLINE.number, sourceUrl: NORTHLINE.websiteUrl }],
          socials: [], booking: [], pages: [], scrapedAt: 1,
        },
        ...over,
      } as never);
    });

  const links = () => t.run(async (ctx) => await ctx.db.query("crmProspectLinks").collect());
  const leadCreates = () => calls.filter((c) => c.method === "POST" && new URL(c.url).pathname === "/v1/leads");

  /* ------------------------------ pure ------------------------------ */

  describe("statusTag maps every prospect status to one tag", () => {
    const notEmailed = ["needs_website", "ready_to_scrape", "scraping", "scraped", "no_contact", "blocked", "unreachable", "queued"] as const;
    for (const status of notEmailed) {
      it(`${status}: not emailed, or email sent once a sequence exists`, () => {
        expect(statusTag({ status }, false)).toBe("Outreach: not emailed");
        expect(statusTag({ status }, true)).toBe("Outreach: email sent");
      });
    }
    it("replied (status or repliedAt) beats email sent", () => {
      expect(statusTag({ status: "replied" }, true)).toBe("Outreach: replied");
      expect(statusTag({ status: "queued", repliedAt: 5 }, true)).toBe("Outreach: replied");
    });
    it("booked (bookedAt) beats replied", () => {
      expect(statusTag({ status: "replied", repliedAt: 5, bookedAt: 9 }, true)).toBe("Outreach: booked");
      expect(statusTag({ status: "scraped", bookedAt: 9 }, false)).toBe("Outreach: booked");
    });
    it("suppressed is the opted-out state, and so is a reply read as an opt-out or a suppressed address", () => {
      expect(isOptedOut({ status: "suppressed" }, false)).toBe(true);
      expect(isOptedOut({ status: "replied", replyIntent: { optedOut: true } as never }, false)).toBe(true);
      expect(isOptedOut({ status: "scraped" }, true)).toBe(true);
      expect(isOptedOut({ status: "scraped" }, false)).toBe(false);
      expect(STATUS_TAGS).toHaveLength(4);
    });
  });

  it("primaryEmail: first non-generic, else first; leadBody is a whitelist", () => {
    const contacts = (list: Array<[string, boolean]>) => ({ contacts: { emails: list.map(([address, generic], rank) => ({ address, generic, rank, sourceUrl: "" })), phones: [], socials: [], booking: [], pages: [], scrapedAt: 0 } });
    expect(primaryEmail(contacts([["info@a.example", true], ["jo@a.example", false]]))).toBe("jo@a.example");
    expect(primaryEmail(contacts([["info@a.example", true]]))).toBe("info@a.example");
    expect(primaryEmail({})).toBeNull();
    const body = leadBody({ name: NORTHLINE.name, handle: NORTHLINE.handle, websiteUrl: NORTHLINE.websiteUrl }, NORTHLINE.owner, "outreach_1", "Outreach: not emailed");
    expect(Object.keys(body).sort()).toEqual(["email", "full_name", "inquiry", "notes", "source", "stage_key", "tags"]);
    expect(body.notes).toBe("Website: https://northline.example\nInstagram: @northlinesound");
    expect(leadBody({ handle: "northlinesound" }, "x@y.example", "k", "Outreach: replied").full_name).toBe("@northlinesound");
    expect(batchSize(undefined)).toBe(25);
    expect(batchSize(500)).toBe(50);
    expect(batchSize(0)).toBe(1);
    expect(outreachStageKey({ stages: [{ key: "o", label: " outreach " }] })).toBe("o");
    expect(outreachStageKey({ stages: [{ key: "n", label: "New" }] })).toBeNull();
  });

  /* ------------------------------ access ------------------------------ */

  const outsiders: Array<[string, () => ReturnType<typeof t.withIdentity> | typeof t]> = [
    ["signed out", () => t],
    ["studio member", () => t.withIdentity({ subject: "u_studio", name: "Owen", orgId: STUDIO, orgType: "studio" } as never)],
    ["agency staff", () => t.withIdentity(agencyIdent("u_staff", PULSE) as never)],
    ["owner of another agency", () => t.withIdentity(agencyIdent("u_other", OTHER) as never)],
  ];
  for (const [title, who] of outsiders) {
    it(`access: ${title} gets null from plan and FORBIDDEN from push, with no request`, async () => {
      await addProspect();
      expect(await who().query(api.crmProspects.plan, {})).toBeNull();
      await expect(who().action(api.crmProspects.push, { confirm: true })).rejects.toThrow(/FORBIDDEN|owner or admin/);
      expect(calls).toHaveLength(0);
      expect(await links()).toHaveLength(0);
    });
  }

  it("access: the owner gets the plan", async () => {
    await addProspect();
    await addProspect({}, []);
    await addProspect({ status: "suppressed" });
    expect(await owner().query(api.crmProspects.plan, {})).toEqual({
      total: 3, eligible: 1, linked: 0, toPush: 1, skippedNoEmail: 1, skippedOptedOut: 1, keyConfigured: true, writesOn: true, stageReady: false,
    });
  });

  it("refusal order: key, then writes, then confirm; never a request", async () => {
    await addProspect();
    vi.stubEnv("ZUOPS_CRM_API_KEY", "");
    vi.stubEnv("ZUOPS_CRM_WRITES", "");
    expect((await owner().action(api.crmProspects.push, {})).code).toBe("not_connected");
    vi.stubEnv("ZUOPS_CRM_API_KEY", "zu-rw-test");
    expect((await owner().action(api.crmProspects.push, {})).code).toBe("read_only");
    for (const almost of ["true", "On", "1", "yes"]) {
      vi.stubEnv("ZUOPS_CRM_WRITES", almost);
      expect((await owner().action(api.crmProspects.push, { confirm: true })).code).toBe("read_only");
    }
    vi.stubEnv("ZUOPS_CRM_WRITES", "on");
    expect((await owner().action(api.crmProspects.push, {})).code).toBe("needs_confirm");
    expect((await owner().action(api.crmProspects.push, { confirm: false })).code).toBe("needs_confirm");
    expect(calls).toHaveLength(0);
    expect(await links()).toHaveLength(0);
  });

  it("no phone and no run_intake in any request, even when the prospect publishes numbers", async () => {
    const id = await addProspect();
    const r = await owner().action(api.crmProspects.push, { confirm: true });
    expect(r).toMatchObject({ ok: true, pushed: 1, matched: 0, failed: 0, remaining: 0 });
    for (const c of calls) {
      const raw = JSON.stringify(c.body ?? {});
      expect(raw).not.toMatch(/phone/i);
      expect(raw).not.toContain(NORTHLINE.number);
      expect(raw).not.toContain("2135550142");
      expect(raw).not.toContain("run_intake");
    }
    const create = leadCreates()[0];
    expect(create.body).toEqual({
      full_name: NORTHLINE.name, email: NORTHLINE.owner, source: "other", stage_key: "outreach_1",
      tags: ["Outreach", "Outreach: not emailed"], inquiry: "Pulse outreach prospect",
      notes: "Website: https://northline.example\nInstagram: @northlinesound",
    });
    expect(create.idem).toBe(`prospect-${id}`);
  });

  it("opted-out and suppressed prospects are never pushed", async () => {
    await addProspect({ status: "suppressed" });
    const messageId = await t.run(async (ctx) => {
      const threadId = await ctx.db.insert("mailThreads", {
        agencyId: PULSE, subject: "Re: hi", normalizedSubject: "hi", participants: ["x@quiet.example"], lastMessageAt: 1, lastSnippet: "stop",
        lastFrom: "x@quiet.example", messageCount: 1, unreadCount: 1, status: "open", createdAt: 1,
      });
      return await ctx.db.insert("mailMessages", {
        agencyId: PULSE, threadId, direction: "in", from: "x@quiet.example", fromAddress: "x@quiet.example", to: [], cc: [], subject: "Re: hi",
        text: "stop", snippet: "stop", references: [], receivedAt: 1, createdAt: 1, read: false, bodyStatus: "ok", attachments: [],
      });
    });
    await addProspect({ status: "replied", replyIntent: { label: "unsubscribe", probabilities: { unsubscribe: 0.95 }, confidence: 0.95, model: "m", messageId, receivedAt: 1, at: 1, optedOut: true } });
    await addProspect({}, [{ address: "studio@quietroom.example", generic: true }, { address: "dee@quietroom.example", generic: false }]);
    await t.run(async (ctx) => { await ctx.db.insert("outreachSuppressions", { agencyId: PULSE, email: "studio@quietroom.example", reason: "unsubscribe", at: 1 }); });
    const r = await owner().action(api.crmProspects.push, { confirm: true });
    expect(r).toMatchObject({ ok: true, pushed: 0, remaining: 0 });
    expect(calls).toHaveLength(0);
    expect((await owner().query(api.crmProspects.plan, {}))?.skippedOptedOut).toBe(3);
  });

  it("the Outreach stage is created once and reused", async () => {
    await addProspect();
    await addProspect();
    await owner().action(api.crmProspects.push, { confirm: true, limit: 1 });
    await owner().action(api.crmProspects.push, { confirm: true, limit: 1 });
    const stagePosts = calls.filter((c) => c.method === "POST" && new URL(c.url).pathname === "/v1/stages");
    expect(stagePosts).toHaveLength(1);
    expect(stagePosts[0].body).toEqual({ label: "Outreach", behavior: "new", color: "slate", manual_only: true });
    expect(leadCreates().map((c) => (c.body as { stage_key: string }).stage_key)).toEqual(["outreach_1", "outreach_1"]);
    expect((await owner().query(api.crmProspects.plan, {}))?.stageReady).toBe(true);
  });

  it("an existing stage labeled Outreach in any case is used without creating one", async () => {
    stages.push({ key: "stage_out", label: "OUTREACH" });
    await addProspect();
    await owner().action(api.crmProspects.push, { confirm: true });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/v1/stages"))).toBe(false);
    expect((leadCreates()[0].body as { stage_key: string }).stage_key).toBe("stage_out");
  });

  it("a 409 duplicate links the existing lead, adds tags only, never moves its stage", async () => {
    await addProspect();
    respond = (c) => (c.method === "POST" && c.url.endsWith("/v1/leads")
      ? fail(409, { error: "duplicate", details: { lead_id: "lead_existing" } })
      : zuops(c));
    const r = await owner().action(api.crmProspects.push, { confirm: true });
    expect(r).toMatchObject({ ok: true, pushed: 0, matched: 1, failed: 0, remaining: 0 });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(new URL(patch.url).pathname).toBe("/v1/leads/lead_existing");
    expect(patch.body).toEqual({ add_tags: ["Outreach", "Outreach: not emailed"] });
    const l = await links();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ zuLeadId: "lead_existing", matched: true, lastStatus: "Outreach: not emailed" });
  });

  it("batch limit and remaining; a second push skips linked prospects", async () => {
    for (let i = 0; i < 5; i++) await addProspect();
    const first = await owner().action(api.crmProspects.push, { confirm: true, limit: 2 });
    expect(first).toMatchObject({ ok: true, pushed: 2, remaining: 3 });
    const second = await owner().action(api.crmProspects.push, { confirm: true, limit: 50 });
    expect(second).toMatchObject({ ok: true, pushed: 3, remaining: 0 });
    expect(new Set(leadCreates().map((c) => c.idem)).size).toBe(5);
    expect((await owner().query(api.crmProspects.plan, {}))).toMatchObject({ linked: 5, toPush: 0 });
  });

  it("a 429 stops the batch and returns retryAfter", async () => {
    for (let i = 0; i < 4; i++) await addProspect();
    let n = 0;
    respond = (c) => {
      if (c.method === "POST" && c.url.endsWith("/v1/leads") && ++n === 2) return fail(429, { error: "rate_limited" }, { "retry-after": "30" });
      return zuops(c);
    };
    const r = await owner().action(api.crmProspects.push, { confirm: true });
    expect(r).toMatchObject({ ok: false, pushed: 1, failed: 1, remaining: 3, retryAfter: 30, code: "rate_limited" });
    expect(leadCreates()).toHaveLength(2);
  });

  it("three failures in a row stop the batch", async () => {
    for (let i = 0; i < 6; i++) await addProspect();
    respond = (c) => (c.method === "POST" && c.url.endsWith("/v1/leads") ? fail(500, { error: "boom" }) : zuops(c));
    const r = await owner().action(api.crmProspects.push, { confirm: true });
    expect(r).toMatchObject({ ok: false, pushed: 0, failed: 3, remaining: 6 });
    expect(leadCreates()).toHaveLength(3);
  });

  /* ------------------------------ sync ------------------------------ */

  it("status sync swaps the tag when the prospect moves on, and is a no-op with writes off", async () => {
    const id = await addProspect();
    await owner().action(api.crmProspects.push, { confirm: true });
    await t.run(async (ctx) => { await ctx.db.patch(id as Id<"outreachProspects">, { status: "replied", repliedAt: 5 }); });
    calls = [];
    vi.stubEnv("ZUOPS_CRM_WRITES", "");
    expect(await t.action(internal.crmProspects.syncStatuses, {})).toBeNull();
    expect(calls).toHaveLength(0);
    vi.stubEnv("ZUOPS_CRM_WRITES", "on");
    expect(await t.action(internal.crmProspects.syncStatuses, {})).toEqual({ tagged: 1, dnc: 0, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(new URL(calls[0].url).pathname).toBe("/v1/leads/lead_1");
    expect(calls[0].body).toEqual({ add_tags: ["Outreach: replied"], remove_tags: ["Outreach: not emailed"] });
    expect((await links())[0].lastStatus).toBe("Outreach: replied");
    calls = [];
    expect(await t.action(internal.crmProspects.syncStatuses, {})).toEqual({ tagged: 0, dnc: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("opt-out after linking marks the lead do-not-contact once, and never creates or moves anything", async () => {
    await addProspect();
    await owner().action(api.crmProspects.push, { confirm: true });
    await t.run(async (ctx) => { await ctx.db.insert("outreachSuppressions", { agencyId: PULSE, email: NORTHLINE.owner, reason: "unsubscribe", at: 1 }); });
    calls = [];
    expect(await t.action(internal.crmProspects.syncStatuses, {})).toEqual({ tagged: 0, dnc: 1, failed: 0 });
    expect(await t.action(internal.crmProspects.syncStatuses, {})).toEqual({ tagged: 0, dnc: 0, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(new URL(calls[0].url).pathname).toBe("/v1/leads/lead_1/do-not-contact");
    expect((await links())[0].dnc).toBe(true);
    // A later push does not re-add it either.
    calls = [];
    await owner().action(api.crmProspects.push, { confirm: true });
    expect(calls).toHaveLength(0);
  });

  it("nothing personal in crmProspectLinks or the audit rows", async () => {
    await addProspect();
    await owner().action(api.crmProspects.push, { confirm: true });
    await t.run(async (ctx) => { await ctx.db.insert("outreachSuppressions", { agencyId: PULSE, email: "other@elsewhere.example", reason: "x", at: 1 }); });
    const rows = await t.run(async (ctx) => ({
      links: await ctx.db.query("crmProspectLinks").collect(),
      events: (await ctx.db.query("outreachEvents").collect()).filter((e) => e.action.startsWith("crm.prospects")),
    }));
    expect(rows.links).toHaveLength(1);
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0]).toMatchObject({ action: "crm.prospects.push", result: "ok", detail: "1 pushed, 0 matched, 0 failed, 0 remaining" });
    const raw = JSON.stringify(rows);
    for (const needle of [NORTHLINE.email, NORTHLINE.owner, NORTHLINE.name, NORTHLINE.handle, "northline.example", NORTHLINE.number]) {
      expect(raw, needle).not.toContain(needle);
    }
  });

  it("source guard: crmProspects.ts has no sending path, no intake flag and never says phone", () => {
    const src = readFileSync("convex/crmProspects.ts", "utf8");
    for (const needle of ["/v1/messages", "/send", "/enroll", "run_intake", "phone"]) expect(src, needle).not.toContain(needle);
    expect(src).not.toMatch(/\.collect\(\)/);
  });
});
