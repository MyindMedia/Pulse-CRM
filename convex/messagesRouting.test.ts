import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Messages: which studio a text reaches when every studio texts from one shared
   number, the agency's Unrouted list, Mark handled, the portal thread, and
   erasure. No SMS provider in tests, so sends are simulated. */

const DAY = 86_400_000;
const PHONE = "+14045550123";
type T = ReturnType<typeof convexTest>;

async function twoStudios(opts: { agencyId?: string } = {}) {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (const [orgId, name, subject] of [["studio-a", "Skyline", "user_a"], ["studio-b", "Basement", "user_b"]] as const) {
      await ctx.db.insert("orgs", {
        orgId, name, slug: orgId, plan: "studio", status: "active",
        ...(opts.agencyId ? { agencyId: opts.agencyId } : {}),
      });
      await ctx.db.insert("members", {
        orgId, name: "Owner", role: "owner", email: `${subject}@x.com`, skills: [], clerkUserId: subject,
      });
    }
  });
  return {
    t,
    ownerA: t.withIdentity({ subject: "user_a", name: "Olu" }),
    ownerB: t.withIdentity({ subject: "user_b", name: "Bo" }),
  };
}

function addClient(t: T, orgId: string, extra: { phone?: string; email?: string; name?: string; lastContactAt?: number } = {}) {
  const phone = "phone" in extra ? extra.phone : "(404) 555-0123";
  return t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId, name: extra.name ?? "Nova", type: "artist",
      ...(phone ? { phone } : {}),
      ...(extra.email ? { email: extra.email } : {}),
      ...(extra.lastContactAt ? { lastContactAt: extra.lastContactAt } : {}),
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    }),
  );
}

function messagesFor(t: T, artistId: Id<"artists">) {
  return t.run(async (ctx) => (await ctx.db.query("clientMessages").collect()).filter((m) => m.artistId === artistId));
}

async function agencyLead(t: T) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "ag_1", name: "Myind", slug: "myind", plan: "agency", status: "active",
      ownerClerkUserId: "u_ag", ownerEmail: "ag@x.com",
    });
    await ctx.db.insert("agencyMembers", {
      agencyId: "ag_1", clerkUserId: "u_ag", email: "ag@x.com", name: "Lead", role: "owner", status: "active", invitedAt: 0,
    });
  });
  return t.withIdentity({ subject: "u_ag", name: "Lead", orgId: "ag_1", orgType: "agency" } as {
    subject: string; name: string; orgId: string; orgType: string;
  });
}

async function portalGrant(t: T, artistId: Id<"artists">, token = "tok-portal") {
  await t.run((ctx) =>
    ctx.db.insert("collaboratorGrants", {
      orgId: "studio-a", email: "nova@x.com", name: "Nova", scope: "artist_portal", entityId: artistId,
      capabilities: ["songs.read"], token, expiresAt: Date.now() + 30 * DAY, invitedBy: "owner", useCount: 0,
    }),
  );
  return token;
}

describe("routing a text on the shared number", () => {
  it("a client of one studio reaches that studio", async () => {
    const { t } = await twoStudios();
    const artistId = await addClient(t, "studio-a");
    await t.mutation(internal.sms._handleInbound, { from: "404-555-0123", body: "See you at 7" });
    const [m] = await messagesFor(t, artistId);
    expect(m.body).toBe("See you at 7");
    expect(m.routedBy).toBe("only_match");
  });

  it("a client of two studios reaches the one that texted them last", async () => {
    const { t } = await twoStudios();
    const a = await addClient(t, "studio-a");
    const b = await addClient(t, "studio-b");
    await t.run(async (ctx) => {
      await ctx.db.insert("smsContacts", { phone: PHONE, orgId: "studio-a", lastSentAt: Date.now() - 5 * DAY });
      await ctx.db.insert("smsContacts", { phone: PHONE, orgId: "studio-b", lastSentAt: Date.now() - 3_600_000 });
    });
    await t.mutation(internal.sms._handleInbound, { from: PHONE, body: "Got it" });
    expect(await messagesFor(t, a)).toHaveLength(0);
    const [m] = await messagesFor(t, b);
    expect(m.routedBy).toBe("last_texted");
  });

  it("with no recent text and no shared agency, it takes the studio last in touch and says it guessed", async () => {
    const { t } = await twoStudios();
    const a = await addClient(t, "studio-a");
    const b = await addClient(t, "studio-b", { lastContactAt: Date.now() + DAY });
    // Older than 30 days: not evidence.
    await t.run((ctx) => ctx.db.insert("smsContacts", { phone: PHONE, orgId: "studio-a", lastSentAt: Date.now() - 40 * DAY }));
    await t.mutation(internal.sms._handleInbound, { from: PHONE, body: "hello?" });
    expect(await messagesFor(t, a)).toHaveLength(0);
    const [m] = await messagesFor(t, b);
    expect(m.routedBy).toBe("best_guess");
  });

  it("a same-agency tie is held for the agency, and only its lead can send it on", async () => {
    const { t, ownerA } = await twoStudios({ agencyId: "ag_1" });
    await addClient(t, "studio-a");
    const b = await addClient(t, "studio-b", { name: "Nova Reign" });
    await t.mutation(internal.sms._handleInbound, { from: PHONE, body: "Is my session still on?" });
    expect(await t.run(async (ctx) => (await ctx.db.query("clientMessages").collect()).length)).toBe(0);

    expect(await ownerA.query(api.messages.listUnrouted, {})).toEqual([]);

    const lead = await agencyLead(t);
    const list = await lead.query(api.messages.listUnrouted, {});
    expect(list).toHaveLength(1);
    expect(list[0].phoneEnding).toBe("0123");
    expect(list[0].candidates.map((c) => c.studioName).sort()).toEqual(["Basement", "Skyline"]);
    expect(JSON.stringify(list)).not.toContain(PHONE);

    await expect(ownerA.mutation(api.messages.assignUnrouted, { id: list[0]._id, orgId: "studio-a" })).rejects.toThrow();
    await lead.mutation(api.messages.assignUnrouted, { id: list[0]._id, orgId: "studio-b" });
    const [m] = await messagesFor(t, b);
    expect(m.routedBy).toBe("assigned");
    expect(m.body).toBe("Is my session still on?");
    expect(await lead.query(api.messages.listUnrouted, {})).toEqual([]);
  });

  it("tells owners, managers and the booking's engineer, and never puts the message in the alert", async () => {
    const { t } = await twoStudios();
    const artistId = await addClient(t, "studio-a");
    await t.run(async (ctx) => {
      const engineerId = await ctx.db.insert("members", {
        orgId: "studio-a", name: "Ellis", role: "engineer", email: "e@x.com", skills: [], clerkUserId: "user_eng",
      });
      await ctx.db.insert("members", {
        orgId: "studio-a", name: "Remy", role: "engineer", email: "r@x.com", skills: [], clerkUserId: "user_other",
      });
      await ctx.db.insert("sessions", {
        orgId: "studio-a", title: "Mix", artistId, engineerId, serviceType: "mixing",
        startTime: Date.now() + 3_600_000, endTime: Date.now() + 7_200_000,
        status: "confirmed", rateCents: 10000, depositCents: 0, depositPaid: true, intakeCompleted: true,
      });
    });
    await t.mutation(internal.sms._handleInbound, { from: PHONE, body: "running late, gate code 4471" });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const alert = scheduled.find((f) => f.name.includes("toOrg"));
    expect(alert).toBeDefined();
    const args = alert!.args[0] as { title: string; clerkUserIds: string[]; strictAudience: boolean };
    expect(args.title).toBe("Nova sent a message");
    expect(args.strictAudience).toBe(true);
    expect([...args.clerkUserIds].sort()).toEqual(["user_a", "user_eng"]);
    expect(JSON.stringify(alert!.args)).not.toContain("4471");
  });
});

describe("answering", () => {
  it("Mark handled clears waiting without a reply, in this studio only", async () => {
    const { t, ownerA, ownerB } = await twoStudios();
    const artistId = await addClient(t, "studio-a");
    await t.mutation(internal.sms._handleInbound, { from: PHONE, body: "thanks!" });
    await expect(ownerB.mutation(api.messages.markHandled, { artistId })).rejects.toThrow(/not found/i);
    expect((await ownerA.mutation(api.messages.markHandled, { artistId })).marked).toBe(1);
    const [m] = await messagesFor(t, artistId);
    expect(m.handledAt).toBeTypeOf("number");
    expect(m.handledBy).toBe("user_a");
  });

  it("a studio text records who texted the phone and issues the portal link it carries", async () => {
    const { t, ownerA } = await twoStudios();
    const artistId = await addClient(t, "studio-a");
    const res = await ownerA.action(api.sms.sendClientSms, { artistId, body: "Stems are ready." });
    expect(res.status).toBe("simulated");
    await t.run(async (ctx) => {
      const contacts = await ctx.db.query("smsContacts").withIndex("by_phone", (q) => q.eq("phone", PHONE)).collect();
      expect(contacts.map((c) => c.orgId)).toEqual(["studio-a"]);
      const grant = await ctx.db.query("collaboratorGrants").withIndex("by_entity", (q) => q.eq("entityId", artistId)).first();
      expect(grant?.invitedBy).toBe("system:messages");
      expect(grant?.scope).toBe("artist_portal");
    });
  });

  it("a portal reply texts the client a link, never the message, and reuses one link", async () => {
    const { t, ownerA } = await twoStudios();
    const artistId = await addClient(t, "studio-a");
    expect((await ownerA.mutation(api.messages.sendPortal, { artistId, body: "Mix v2 is up, gate code 4471" })).notified).toBe("text");
    await ownerA.mutation(api.messages.sendPortal, { artistId, body: "One more note" });
    await t.run(async (ctx) => {
      const notes = await ctx.db.query("notifications").withIndex("by_org", (q) => q.eq("orgId", "studio-a")).collect();
      expect(notes).toHaveLength(2);
      const grants = await ctx.db.query("collaboratorGrants").withIndex("by_entity", (q) => q.eq("entityId", artistId)).collect();
      expect(grants).toHaveLength(1);
      for (const n of notes) {
        expect(n.body).toContain(`/portal/${grants[0].token}`);
        expect(n.body).not.toContain("4471");
      }
    });
  });

  it("a portal reply falls back to email, and to nothing for an opted-out client with no email", async () => {
    const { t, ownerA } = await twoStudios();
    const emailOnly = await addClient(t, "studio-a", { phone: undefined, email: "nova@x.com" });
    expect((await ownerA.mutation(api.messages.sendPortal, { artistId: emailOnly, body: "hi" })).notified).toBe("email");
    const optedOut = await addClient(t, "studio-a", { phone: "404-555-0188", name: "Quiet" });
    await t.run((ctx) => ctx.db.insert("smsOptOuts", { phone: "+14045550188", optedOut: true, updatedAt: Date.now() }));
    expect((await ownerA.mutation(api.messages.sendPortal, { artistId: optedOut, body: "hi" })).notified).toBe("none");
  });

  it("the portal thread: the client writes in, reads replies, and is rate limited", async () => {
    const { t, ownerA } = await twoStudios();
    const artistId = await addClient(t, "studio-a");
    const token = await portalGrant(t, artistId);
    await t.run((ctx) =>
      ctx.db.insert("clientMessages", {
        orgId: "studio-a", artistId, direction: "out", subject: "Receipt", body: "automated", channel: "internal", status: "sent",
      }),
    );
    await t.mutation(api.portal.sendMessage, { token, body: "Can we start at 3?" });
    await ownerA.mutation(api.messages.sendPortal, { artistId, body: "3 works." });
    const thread = await t.query(api.portal.thread, { token });
    expect(thread!.map((m) => [m.fromStudio, m.body])).toEqual([[false, "Can we start at 3?"], [true, "3 works."]]);
    const inbound = (await messagesFor(t, artistId)).find((m) => m.direction === "in");
    expect(inbound?.routedBy).toBe("portal");

    expect(await t.query(api.portal.thread, { token: "wrong" })).toBeNull();
    await expect(t.mutation(api.portal.sendMessage, { token: "wrong", body: "hi" })).rejects.toThrow(/no longer valid/);
    for (let i = 1; i < 20; i++) await t.mutation(api.portal.sendMessage, { token, body: `note ${i}` });
    await expect(t.mutation(api.portal.sendMessage, { token, body: "one too many" })).rejects.toThrow(/a lot of messages/);
  });
});

describe("keeping it small", () => {
  it("erasing a client removes this studio's routing records and leaves the other studio's", async () => {
    const { t, ownerA } = await twoStudios({ agencyId: "ag_1" });
    const artistId = await addClient(t, "studio-a");
    await t.run(async (ctx) => {
      await ctx.db.insert("smsContacts", { phone: PHONE, orgId: "studio-a", lastSentAt: Date.now() });
      await ctx.db.insert("smsContacts", { phone: PHONE, orgId: "studio-b", lastSentAt: Date.now() });
      await ctx.db.insert("unroutedMessages", {
        phone: PHONE, body: "x", candidateOrgIds: ["studio-a", "studio-b"], agencyId: "ag_1", receivedAt: Date.now(), status: "open",
      });
      await ctx.db.insert("unroutedMessages", {
        phone: PHONE, body: "y", candidateOrgIds: ["studio-a"], agencyId: "ag_1", receivedAt: Date.now(), status: "open",
      });
    });
    await ownerA.mutation(api.dataRights.eraseArtist, { artistId });
    await t.run(async (ctx) => {
      expect((await ctx.db.query("smsContacts").collect()).map((c) => c.orgId)).toEqual(["studio-b"]);
      const held = await ctx.db.query("unroutedMessages").collect();
      expect(held).toHaveLength(1);
      expect(held[0].candidateOrgIds).toEqual(["studio-b"]);
    });
  });

  it("prune keeps held texts 30 days and texted-contact records 90", async () => {
    const { t } = await twoStudios();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("unroutedMessages", {
        phone: PHONE, body: "old", candidateOrgIds: ["studio-a"], agencyId: "ag_1", receivedAt: now - 31 * DAY, status: "open",
      });
      await ctx.db.insert("unroutedMessages", {
        phone: PHONE, body: "new", candidateOrgIds: ["studio-a"], agencyId: "ag_1", receivedAt: now - DAY, status: "open",
      });
      await ctx.db.insert("smsContacts", { phone: PHONE, orgId: "studio-a", lastSentAt: now - 91 * DAY });
      await ctx.db.insert("smsContacts", { phone: "+14045550999", orgId: "studio-a", lastSentAt: now - 60 * DAY });
    });
    expect(await t.mutation(internal.messages.prune, {})).toEqual({ held: 1, contacts: 1 });
  });
});
