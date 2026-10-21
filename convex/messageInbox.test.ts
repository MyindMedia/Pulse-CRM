import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* The Messages page: one row per client conversation, read and archived
   state per studio, who wrote each message, and the per-client switch that
   keeps the AI receptionist out of a conversation. */

type T = ReturnType<typeof convexTest>;
let clock = Date.parse("2026-10-21T18:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});
afterEach(() => vi.useRealTimers());

const tick = () => vi.setSystemTime((clock += 60_000));

async function studios() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    for (const [orgId, subject] of [["studio-a", "user_a"], ["studio-b", "user_b"]] as const) {
      await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier: "growth", status: "active" });
      await ctx.db.insert("members", {
        orgId, name: subject === "user_a" ? "Olu" : "Bo", role: "owner", email: `${subject}@x.com`, skills: [], clerkUserId: subject,
      });
    }
  });
  return { t, a: t.withIdentity({ subject: "user_a", name: "Olu" }), b: t.withIdentity({ subject: "user_b", name: "Bo" }) };
}

function client(t: T, orgId: string, name: string, phone?: string) {
  return t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId, name, type: "artist", ...(phone ? { phone } : {}),
      genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
    }),
  );
}

async function say(t: T, orgId: string, artistId: Id<"artists">, direction: "in" | "out", body: string, sentBy?: string) {
  tick();
  await t.run((ctx) =>
    ctx.db.insert("clientMessages", {
      orgId, artistId, direction, subject: "Text message", body, channel: "sms",
      status: direction === "in" ? "received" : "sent", ...(sentBy ? { sentBy } : {}),
    }),
  );
}

describe("conversations", () => {
  it("lists one row per client, newest first, with unread and needs-reply", async () => {
    const { t, a, b } = await studios();
    const nova = await client(t, "studio-a", "Nova");
    const kai = await client(t, "studio-a", "Kai");
    await say(t, "studio-a", nova, "out", "Reminder: 7 PM", "user_a");
    await say(t, "studio-a", kai, "out", "Your mix is ready", "user_a");
    await say(t, "studio-a", nova, "in", "Can we push to 8?");

    const rows = await a.query(api.messageInbox.conversations, {});
    expect(rows.map((r) => [r.name, r.lastBody, r.unread, r.waiting])).toEqual([
      ["Nova", "Can we push to 8?", true, true],
      ["Kai", "Your mix is ready", false, false],
    ]);
    expect(await a.query(api.messageInbox.unreadCount, {})).toBe(1);
    expect((await a.query(api.messageInbox.conversations, { view: "waiting" })).map((r) => r.name)).toEqual(["Nova"]);
    expect((await a.query(api.messageInbox.conversations, { search: "mix" })).map((r) => r.name)).toEqual(["Kai"]);

    // Another studio never sees them.
    expect(await b.query(api.messageInbox.conversations, {})).toEqual([]);
  });

  it("opening a conversation reads it until the client writes again", async () => {
    const { t, a } = await studios();
    const nova = await client(t, "studio-a", "Nova");
    await say(t, "studio-a", nova, "in", "Hi");
    tick();
    await a.mutation(api.messageInbox.markRead, { artistId: nova });
    expect((await a.query(api.messageInbox.conversations, {}))[0].unread).toBe(false);
    await say(t, "studio-a", nova, "in", "Hello?");
    expect((await a.query(api.messageInbox.conversations, {}))[0].unread).toBe(true);
  });

  it("archived conversations leave the inbox and come back on a new message", async () => {
    const { t, a } = await studios();
    const nova = await client(t, "studio-a", "Nova");
    await say(t, "studio-a", nova, "in", "Thanks!");
    tick();
    await a.mutation(api.messageInbox.setArchived, { artistId: nova, archived: true });
    expect(await a.query(api.messageInbox.conversations, {})).toEqual([]);
    expect((await a.query(api.messageInbox.conversations, { view: "archived" })).map((r) => r.name)).toEqual(["Nova"]);
    await say(t, "studio-a", nova, "in", "One more thing");
    expect((await a.query(api.messageInbox.conversations, {})).map((r) => r.name)).toEqual(["Nova"]);
  });

  it("will not touch another studio's client", async () => {
    const { t, b } = await studios();
    const nova = await client(t, "studio-a", "Nova");
    await expect(b.mutation(api.messageInbox.setArchived, { artistId: nova, archived: true })).rejects.toThrow();
    expect(await b.query(api.messageInbox.contact, { artistId: nova })).toBeNull();
  });
});

describe("thread", () => {
  it("runs oldest first and says who wrote each message", async () => {
    const { t, a } = await studios();
    const nova = await client(t, "studio-a", "Nova");
    await say(t, "studio-a", nova, "out", "Reminder: 7 PM");
    await say(t, "studio-a", nova, "in", "Book me Friday?");
    await say(t, "studio-a", nova, "out", "Here is the link", "receptionist:abc");
    await say(t, "studio-a", nova, "out", "See you then", "user_a");
    const thread = await a.query(api.messageInbox.thread, { artistId: nova });
    expect(thread.map((m) => [m.body, m.author])).toEqual([
      ["Reminder: 7 PM", { kind: "auto" }],
      ["Book me Friday?", null],
      ["Here is the link", { kind: "agent" }],
      ["See you then", { kind: "person", name: "Olu" }],
    ]);
  });
});

describe("AI replies per client", () => {
  async function receptionistRuns(t: T) {
    return t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((f) => f.name.includes("receptionist")).length,
    );
  }

  it("the receptionist answers by default and stays out once the studio turns it off", async () => {
    const { t, a } = await studios();
    await t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "studio-a")).first();
      await ctx.db.patch(org!._id, { aiReceptionistEnabled: true });
    });
    const nova = await client(t, "studio-a", "Nova", "(404) 555-0177");

    await t.mutation(internal.sms._handleInbound, { from: "+14045550177", body: "Any time Friday?" });
    expect(await receptionistRuns(t)).toBe(1);

    await a.mutation(api.messageInbox.setAiReplies, { artistId: nova, on: false });
    expect((await a.query(api.messageInbox.contact, { artistId: nova }))?.aiRepliesOff).toBe(true);
    await t.mutation(internal.sms._handleInbound, { from: "+14045550177", body: "Hello?" });
    expect(await receptionistRuns(t)).toBe(1);

    // The message itself still lands in the conversation.
    const thread = await a.query(api.messageInbox.thread, { artistId: nova });
    expect(thread.map((m) => m.body)).toEqual(["Any time Friday?", "Hello?"]);
  });
});
