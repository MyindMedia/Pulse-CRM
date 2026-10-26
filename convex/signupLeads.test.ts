import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { leadConsent, needsOptIn, nextNudgeAt } from "./lib/signupLeads";
import { signupNudgeHtml, signupNudgeSubject } from "./lib/emailTemplates/signupNudge";

/* Signup leads (openspec trial-signup-recovery). The person is saved before
   Stripe opens, reminders follow consent and the live switch, stop on
   conversion or unsubscribe, and only the Pulse team sees the list. */

const created: Record<string, unknown>[] = [];

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      coupons: { create: async () => ({ id: "co_early" }) },
      checkout: {
        sessions: {
          create: async (params: Record<string, unknown>) => {
            created.push(params);
            return { id: `cs_${created.length}`, url: `https://checkout.stripe.test/${created.length}` };
          },
        },
      },
    }),
  };
});

const sent: { to: string; subject: string; headers?: Record<string, string> }[] = [];
vi.mock("./lib/email", () => ({
  sendEmail: async (a: { to: string; subject: string; headers?: Record<string, string> }) => {
    sent.push({ to: a.to, subject: a.subject, headers: a.headers });
    return "sent";
  },
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  created.length = 0;
  sent.length = 0;
  for (const tier of ["CORE", "GROWTH", "MAX"])
    for (const i of ["MONTHLY", "ANNUAL"]) vi.stubEnv(`STRIPE_PRICE_${tier}_${i}`, `price_${tier}_${i}`);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://studiopulse.tech");
  vi.stubEnv("CONVEX_SITE_URL", "https://pulse.convex.site");
  vi.stubEnv("TRIAL_NUDGES_LIVE", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const leads = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.query("signupLeads").collect());

async function start(
  t: ReturnType<typeof convexTest>,
  over: Partial<{ email: string; studioName: string; tier: "core" | "growth" | "max"; optedIn: boolean; country: string }> = {},
) {
  return t.action(api.billing.beginPublicCheckout, {
    tier: over.tier ?? "growth",
    interval: "month",
    email: over.email ?? "Ana@Studio.com",
    studioName: over.studioName ?? "Blue Room",
    optedIn: over.optedIn ?? false,
    country: over.country ?? "US",
  });
}

/** Push every lead's clock back so its reminders are due. */
async function age(t: ReturnType<typeof convexTest>, ms: number) {
  await t.run(async (ctx) => {
    for (const l of await ctx.db.query("signupLeads").collect()) {
      await ctx.db.patch(l._id, {
        startedAt: l.startedAt - ms,
        createdAt: l.createdAt - ms,
        ...(l.nextNudgeAt !== undefined ? { nextNudgeAt: nextNudgeAt(l.startedAt - ms, l.nudgesSent) } : {}),
      });
    }
  });
}

describe("rules", () => {
  it("asks EU, UK, Swiss and unknown visitors to opt in, and nobody else", () => {
    expect(needsOptIn("DE")).toBe(true);
    expect(needsOptIn("gb")).toBe(true);
    expect(needsOptIn("CH")).toBe(true);
    expect(needsOptIn(undefined)).toBe(true);
    expect(needsOptIn("??")).toBe(true);
    expect(needsOptIn("US")).toBe(false);
    expect(needsOptIn("CA")).toBe(false);
    expect(leadConsent("DE", false)).toBe("none");
    expect(leadConsent("DE", true)).toBe("opt_in");
    expect(leadConsent("US", false)).toBe("notice");
  });

  it("schedules 1 hour, 1 day, 4 days, then nothing", () => {
    expect(nextNudgeAt(0, 0)).toBe(HOUR);
    expect(nextNudgeAt(0, 1)).toBe(DAY);
    expect(nextNudgeAt(0, 2)).toBe(4 * DAY);
    expect(nextNudgeAt(0, 3)).toBeUndefined();
  });

  it("templates escape the studio name, carry the links, and use no em dashes", () => {
    for (const step of [0, 1, 2]) {
      const html = signupNudgeHtml({
        step, studioName: "<b>Evil</b>", tierName: "Growth", trialDays: 14,
        resumeUrl: "https://studiopulse.tech/start/abc", unsubscribeUrl: "https://studiopulse.tech/unsubscribe/abc",
        demoUrl: "https://studiopulse.tech/demo",
      });
      expect(html).not.toContain("<b>Evil</b>");
      expect(html).toContain("/start/abc");
      expect(html).toContain("/unsubscribe/abc");
      expect(html + signupNudgeSubject(step, "Blue Room")).not.toMatch(/—/);
    }
  });
});

describe("capture", () => {
  it("saves the lead before checkout and prefills Stripe", async () => {
    const t = convexTest(schema);
    const out = await start(t);
    expect(out.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const [lead] = await leads(t);
    expect(lead).toMatchObject({
      email: "ana@studio.com", studioName: "Blue Room", tier: "growth", interval: "month",
      consent: "notice", country: "US", status: "open", nudgesSent: 0, lastSessionId: "cs_1",
    });
    expect(lead.token).toMatch(/^[a-f0-9]{32}$/);
    expect(lead.nextNudgeAt! - lead.startedAt).toBe(HOUR);
    const params = created[0] as {
      customer_email: string; metadata: Record<string, string>;
      custom_fields: { text?: { default_value?: string } }[];
    };
    expect(params.customer_email).toBe("ana@studio.com");
    expect(params.metadata).toMatchObject({ kind: "platform_signup", leadId: lead._id });
    expect(params.custom_fields[0].text?.default_value).toBe("Blue Room");
  });

  it("reuses one open lead per email and restarts its schedule", async () => {
    const t = convexTest(schema);
    await start(t);
    await age(t, 2 * HOUR);
    await t.action(internal.signupLeads.sweep, {}); // switch off: nothing
    await start(t, { email: "ana@studio.com", tier: "core" });
    const rows = await leads(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: "core", startCount: 2, nudgesSent: 0 });
    expect(rows[0].nextNudgeAt! - rows[0].startedAt).toBe(HOUR);
  });

  it("starting again never resets the reminder count (no mailing someone every hour)", async () => {
    vi.stubEnv("TRIAL_NUDGES_LIVE", "true");
    const t = convexTest(schema);
    for (let i = 0; i < 6; i++) {
      await start(t);
      await age(t, 5 * DAY);
      await t.action(internal.signupLeads.sweep, {});
    }
    expect(sent).toHaveLength(3);
    expect((await leads(t))[0]).toMatchObject({ nudgesSent: 3, startCount: 6 });
  });

  it("rejects a bad email and opens no checkout", async () => {
    const t = convexTest(schema);
    await expect(start(t, { email: "not-an-email" })).rejects.toThrow(/valid email/);
    expect(await leads(t)).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it("still works without an email (a page that has not reloaded)", async () => {
    const t = convexTest(schema);
    await t.action(api.billing.beginPublicCheckout, { tier: "core", interval: "month" });
    expect(await leads(t)).toHaveLength(0);
    expect(created).toHaveLength(1);
  });
});

describe("reminders", () => {
  it("sends nothing while the switch is off, and leaves the lead due", async () => {
    const t = convexTest(schema);
    await start(t);
    await age(t, 2 * HOUR);
    expect(await t.action(internal.signupLeads.sweep, {})).toMatchObject({ live: false, sent: 0 });
    expect(sent).toHaveLength(0);
    expect((await leads(t))[0].nudgesSent).toBe(0);
  });

  it("sends each reminder once, on schedule, with one-click unsubscribe", async () => {
    vi.stubEnv("TRIAL_NUDGES_LIVE", "true");
    const t = convexTest(schema);
    await start(t);
    expect(await t.action(internal.signupLeads.sweep, {})).toMatchObject({ sent: 0 }); // not due yet

    await age(t, 2 * HOUR);
    await t.action(internal.signupLeads.sweep, {});
    await t.action(internal.signupLeads.sweep, {}); // a retry sends nothing new
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ana@studio.com");
    expect(sent[0].subject).toBe("Blue Room is one step from Pulse");
    const token = (await leads(t))[0].token;
    expect(sent[0].headers).toEqual({
      "List-Unsubscribe": `<https://pulse.convex.site/signup/unsubscribe?t=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });

    await age(t, DAY);
    await t.action(internal.signupLeads.sweep, {});
    await age(t, 3 * DAY);
    await t.action(internal.signupLeads.sweep, {});
    await age(t, 2 * DAY);
    await t.action(internal.signupLeads.sweep, {});
    expect(sent.map((s) => s.subject)).toEqual([
      "Blue Room is one step from Pulse",
      "What Pulse runs for your studio",
      "Last reminder about your Pulse trial",
    ]);
    expect((await leads(t))[0]).toMatchObject({ nudgesSent: 3 });
    expect((await leads(t))[0].nextNudgeAt).toBeUndefined();
  });

  it("never emails an EU visitor who left the box unticked, but does when ticked", async () => {
    vi.stubEnv("TRIAL_NUDGES_LIVE", "true");
    const t = convexTest(schema);
    await start(t, { email: "jonas@studio.de", country: "DE" });
    await start(t, { email: "marie@studio.fr", country: "FR", optedIn: true });
    await age(t, 2 * HOUR);
    await t.action(internal.signupLeads.sweep, {});
    expect(sent.map((s) => s.to)).toEqual(["marie@studio.fr"]);
    const jonas = (await leads(t)).find((l) => l.email === "jonas@studio.de")!;
    expect(jonas.consent).toBe("none");
    expect(jonas.nextNudgeAt).toBeUndefined();
  });

  it("does not mail a lead older than a week when the switch goes on late", async () => {
    const t = convexTest(schema);
    await start(t);
    await age(t, 10 * DAY);
    vi.stubEnv("TRIAL_NUDGES_LIVE", "true");
    await t.action(internal.signupLeads.sweep, {});
    expect(sent).toHaveLength(0);
    expect((await leads(t))[0].status).toBe("stale");
  });

  it("stops once the checkout completes", async () => {
    vi.stubEnv("TRIAL_NUDGES_LIVE", "true");
    const t = convexTest(schema);
    await start(t);
    await age(t, 2 * HOUR);
    await t.action(internal.signupLeads.sweep, {});
    const [lead] = await leads(t);
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_cs_lead",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1", mode: "subscription", customer: "cus_a", subscription: "sub_a",
            customer_details: { email: "ana@studio.com" },
            metadata: { kind: "platform_signup", intendedTier: "growth", intendedInterval: "month", leadId: lead._id },
          },
        },
      },
    });
    expect((await leads(t))[0].status).toBe("converted");
    expect((await leads(t))[0].nextNudgeAt).toBeUndefined();
    await age(t, 5 * DAY);
    await t.action(internal.signupLeads.sweep, {});
    expect(sent).toHaveLength(1);
  });
});

describe("links", () => {
  it("unsubscribe stops every reminder for the address, even after a new start", async () => {
    vi.stubEnv("TRIAL_NUDGES_LIVE", "true");
    const t = convexTest(schema);
    await start(t);
    const [lead] = await leads(t);
    expect(await t.mutation(api.signupLeads.unsubscribe, { token: lead.token })).toEqual({ ok: true });
    expect(await t.mutation(api.signupLeads.unsubscribe, { token: "f".repeat(32) })).toEqual({ ok: false });
    expect(await t.mutation(api.signupLeads.unsubscribe, { token: "nope" })).toEqual({ ok: false });

    const again = await start(t);
    expect(again.checkoutUrl).toBeTruthy(); // can still buy
    await age(t, 2 * HOUR);
    await t.action(internal.signupLeads.sweep, {});
    expect(sent).toHaveLength(0);
    expect((await leads(t))[0].status).toBe("unsubscribed");
  });

  it("one-click POST unsubscribes through the HTTP route", async () => {
    const t = convexTest(schema);
    await start(t);
    const [lead] = await leads(t);
    const res = await t.fetch(`/signup/unsubscribe?t=${lead.token}`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await leads(t))[0].status).toBe("unsubscribed");
    expect((await t.fetch("/signup/unsubscribe?t=bad", { method: "POST" })).status).toBe(200);
  });

  it("resume opens a fresh prefilled checkout, and refuses a converted lead", async () => {
    const t = convexTest(schema);
    await start(t);
    const [lead] = await leads(t);
    const out = await t.action(api.signupLeads.resume, { token: lead.token });
    expect(out).toEqual({ ok: true, checkoutUrl: "https://checkout.stripe.test/2" });
    expect((created[1] as { customer_email: string }).customer_email).toBe("ana@studio.com");
    expect((await leads(t))[0].lastSessionId).toBe("cs_2");
    expect(await t.action(api.signupLeads.resume, { token: "0".repeat(32) })).toEqual({ ok: false, reason: "not_found" });

    await t.run((ctx) => ctx.db.patch(lead._id, { status: "converted" }));
    expect(await t.action(api.signupLeads.resume, { token: lead.token })).toEqual({ ok: false, reason: "converted" });
  });
});

describe("list", () => {
  it("shows the Pulse team the leads, without tokens, and nobody else anything", async () => {
    vi.stubEnv("PULSE_AGENCY_ID", "ag1");
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "ag1", name: "Pulse", slug: "pulse", plan: "max",
        status: "active", ownerClerkUserId: "u_ag", ownerEmail: "ag@example.com",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "ag1", clerkUserId: "u_ag", name: "Lawrence",
        email: "ag@example.com", role: "owner", status: "active", invitedAt: Date.now(),
      } as never);
      await ctx.db.insert("orgs", { orgId: "o1", name: "Studio", slug: "o1", tier: "max", status: "active" } as never);
      await ctx.db.insert("members", { orgId: "o1", name: "Owner", role: "owner", skills: [], clerkUserId: "u_studio" } as never);
    });
    await start(t);
    const mine = await t.withIdentity({ subject: "u_ag" }).query(api.signupLeads.list, {});
    expect(mine.items).toHaveLength(1);
    expect(mine.counts).toMatchObject({ total: 1, open: 1, emailable: 1 });
    expect(JSON.stringify(mine)).not.toContain((await leads(t))[0].token);

    const studio = await t.withIdentity({ subject: "u_studio", orgId: "o1" }).query(api.signupLeads.list, {});
    expect(studio.items).toHaveLength(0);
    expect((await t.query(api.signupLeads.list, {})).items).toHaveLength(0);
  });
});
