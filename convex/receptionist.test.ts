import { describe, it, expect, beforeEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { heuristicIntent } from "./receptionist";

/* AI SMS receptionist (Tier 4). No LLM key is configured in tests, so intent
   classification degrades to the deterministic heuristic and no live model is
   called. No SMS provider is configured either, so sends are "simulated". */
describe("receptionist", () => {
  let t: ReturnType<typeof convexTest>;
  const ORG = "pulse-demo";

  beforeEach(async () => {
    // No live LLM in tests: with no key, classification degrades to the
    // deterministic heuristic (mirrors portal.test.ts).
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: ORG,
        name: "Skyline",
        slug: "skyline",
        plan: "studio",
        status: "active",
        ownerEmail: "owner@skyline.com",
      });
    });
  });

  async function enableReceptionist(enabled: boolean) {
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect())[0];
      await ctx.db.patch(org._id, { aiReceptionistEnabled: enabled });
    });
  }

  async function addArtist(phone: string) {
    return t.run((ctx) =>
      ctx.db.insert("artists", {
        orgId: ORG,
        name: "Nova",
        type: "artist",
        phone,
        genres: [],
        tags: [],
        status: "active",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
      }),
    );
  }

  async function outboundReplies(artistId: Id<"artists">) {
    return t.run(async (ctx) => {
      const rows = await ctx.db.query("clientMessages").collect();
      return rows.filter(
        (m) =>
          m.artistId === artistId &&
          m.direction === "out" &&
          (m.sentBy ?? "").startsWith("receptionist"),
      );
    });
  }

  async function teamNotifications() {
    return t.run(async (ctx) => {
      const rows = await ctx.db.query("notifications").collect();
      return rows.filter((r) => (r.kind ?? "").startsWith("receptionist."));
    });
  }

  it("heuristicIntent classifies booking, human, and small talk deterministically", () => {
    expect(heuristicIntent("Do you have studio time available this weekend?").isBookingInquiry).toBe(true);
    const human = heuristicIntent("Can someone call me back please?");
    expect(human.wantsHuman).toBe(true);
    expect(human.isBookingInquiry).toBe(false);
    const ack = heuristicIntent("thanks!");
    expect(ack.isBookingInquiry).toBe(false);
    expect(ack.wantsHuman).toBe(false);
  });

  it("no-ops when the receptionist is disabled", async () => {
    const artistId = await addArtist("(404) 555-0134");
    const inboundId = await t.run((ctx) =>
      ctx.db.insert("clientMessages", {
        orgId: ORG,
        artistId,
        direction: "in",
        subject: "Text message",
        body: "Can I book a session?",
        channel: "sms",
        status: "received",
      }),
    );
    const res = await t.action(internal.receptionist.handle, {
      orgId: ORG,
      from: "+14045550134",
      body: "Can I book a session?",
      clientMessageId: inboundId,
      artistId,
    });
    expect(res.status).toBe("skipped_disabled");
    expect(await outboundReplies(artistId)).toHaveLength(0);
    expect(await teamNotifications()).toHaveLength(0);
  });

  it("on a booking inquiry: sends one outbound reply + a team notification", async () => {
    await enableReceptionist(true);
    const artistId = await addArtist("(404) 555-0140");
    const inboundId = await t.run((ctx) =>
      ctx.db.insert("clientMessages", {
        orgId: ORG,
        artistId,
        direction: "in",
        subject: "Text message",
        body: "Hi! Do you have any studio time available to book this weekend?",
        channel: "sms",
        status: "received",
      }),
    );
    const res = await t.action(internal.receptionist.handle, {
      orgId: ORG,
      from: "+14045550140",
      body: "Hi! Do you have any studio time available to book this weekend?",
      clientMessageId: inboundId,
      artistId,
    });
    expect(res.status).toBe("replied_booking");

    const replies = await outboundReplies(artistId);
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toContain("/book/skyline");
    expect(replies[0].channel).toBe("sms");

    const notes = await teamNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe("receptionist.replied");
  });

  it("does not reply twice to the same inbound clientMessageId", async () => {
    await enableReceptionist(true);
    const artistId = await addArtist("(404) 555-0141");
    const inboundId = await t.run((ctx) =>
      ctx.db.insert("clientMessages", {
        orgId: ORG,
        artistId,
        direction: "in",
        subject: "Text message",
        body: "What are your rates to book a recording session?",
        channel: "sms",
        status: "received",
      }),
    );
    const args = {
      orgId: ORG,
      from: "+14045550141",
      body: "What are your rates to book a recording session?",
      clientMessageId: inboundId,
      artistId,
    } as const;

    const first = await t.action(internal.receptionist.handle, args);
    expect(first.status).toBe("replied_booking");
    const second = await t.action(internal.receptionist.handle, args);
    expect(second.status).toBe("skipped_duplicate");

    expect(await outboundReplies(artistId)).toHaveLength(1);
  });

  it("does not auto-reply to opt-out (STOP) bodies", async () => {
    await enableReceptionist(true);
    const artistId = await addArtist("(404) 555-0142");
    const res = await t.action(internal.receptionist.handle, {
      orgId: ORG,
      from: "+14045550142",
      body: "STOP",
      artistId,
    });
    expect(res.status).toBe("skipped_optout_keyword");
    expect(await outboundReplies(artistId)).toHaveLength(0);
  });

  it("does not message an opted-out number", async () => {
    await enableReceptionist(true);
    const artistId = await addArtist("(404) 555-0143");
    await t.run((ctx) =>
      ctx.db.insert("smsOptOuts", { phone: "+14045550143", optedOut: true, updatedAt: Date.now() }),
    );
    const res = await t.action(internal.receptionist.handle, {
      orgId: ORG,
      from: "+14045550143",
      body: "Can I book a session this week?",
      artistId,
    });
    expect(res.status).toBe("skipped_opted_out");
    expect(await outboundReplies(artistId)).toHaveLength(0);
  });

  it("wants-human message replies with a follow-up and flags the team", async () => {
    await enableReceptionist(true);
    const artistId = await addArtist("(404) 555-0144");
    const inboundId = await t.run((ctx) =>
      ctx.db.insert("clientMessages", {
        orgId: ORG,
        artistId,
        direction: "in",
        subject: "Text message",
        body: "Please have someone call me back, it's urgent.",
        channel: "sms",
        status: "received",
      }),
    );
    const res = await t.action(internal.receptionist.handle, {
      orgId: ORG,
      from: "+14045550144",
      body: "Please have someone call me back, it's urgent.",
      clientMessageId: inboundId,
      artistId,
    });
    expect(res.status).toBe("replied_human");
    const notes = await teamNotifications();
    expect(notes[0].kind).toBe("receptionist.human_needed");
  });
});
