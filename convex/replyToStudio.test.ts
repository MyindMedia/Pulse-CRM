import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { studioReplyTo } from "./lib/email";

/* client-messages-reply-goes-to-pulse: client emails say "Reply to this
   email", but every message went out from Pulse with no reply-to, so the
   client's reply landed in Pulse's inbox, not the studio's. fetch is mocked:
   nothing leaves the test. */
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
});

function mockResend() {
  process.env.RESEND_API_KEY = "re_test";
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
}

const sentBody = (fetchMock: ReturnType<typeof mockResend>) =>
  JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as Record<string, unknown>;

describe("studio email replies reach the studio", () => {
  it("studioReplyTo prefers the studio contact email, then the owner", () => {
    expect(studioReplyTo({ contact: { contactEmail: "hello@studio.test" }, ownerEmail: "o@studio.test" })).toBe("hello@studio.test");
    expect(studioReplyTo({ ownerEmail: "o@studio.test" })).toBe("o@studio.test");
    expect(studioReplyTo({ contact: { contactEmail: "not an email" } })).toBeUndefined();
    expect(studioReplyTo(null)).toBeUndefined();
  });

  it("a notify() email sets reply_to to the studio", async () => {
    const t = convexTest(schema);
    const id = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_r", name: "Reply Studio", slug: "reply", tier: "growth", status: "active",
        ownerEmail: "owner@reply.test", contact: { contactEmail: "hello@reply.test" },
      } as never);
      return await ctx.db.insert("notifications", {
        orgId: "org_r", channel: "email", recipient: "client@x.test", subject: "Reminder",
        body: "Reply to this email if you need to reschedule.", kind: "session.reminder_24h", status: "simulated",
      });
    });
    const fetchMock = mockResend();
    await t.action(internal.notifications.deliver, { id });
    expect(sentBody(fetchMock).reply_to).toBe("hello@reply.test");
  });

  it("an approved waitlist offer email sets reply_to to the studio", async () => {
    const t = convexTest(schema);
    const id = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_r", name: "Reply Studio", slug: "reply", tier: "growth", status: "active", ownerEmail: "owner@reply.test",
      } as never);
      return await ctx.db.insert("opsActions", {
        orgId: "org_r", type: "waitlist_fill", priority: "medium", title: "Offer slot", rationale: "x",
        status: "approved", createdAt: Date.now(), autonomy: false, source: "rule", dedupeKey: "waitlist_fill:x",
        payload: { kind: "email", to: "client@x.test", subject: "Slot", body: "Reply to this email and we will lock it in.", notifyKind: "waitlist.offer" },
      } as never);
    });
    const fetchMock = mockResend();
    await t.action(internal.opsActions.execute, { id });
    expect(sentBody(fetchMock).reply_to).toBe("owner@reply.test");
  });
});
