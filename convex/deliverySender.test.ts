import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { studioSender } from "./lib/email";

/* F2-11 (eval E-05): a session file delivery email comes from the studio, in
   the same "<Studio> via Pulse <support@studiopulse.tech>" form clientEmail.ts
   uses, and a studio name can never add an address or a header. Every other
   notification kind keeps today's sender. fetch is mocked: nothing leaves the
   test. */

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
});

function mockResend() {
  process.env.RESEND_API_KEY = "re_test";
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 200 }));
}

const sentFrom = (fetchMock: ReturnType<typeof mockResend>) =>
  (JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { from?: string }).from;

async function queued(studioName: string, kind: string) {
  const t = convexTest(schema);
  const id = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org_s", name: studioName, slug: "sender", tier: "growth", status: "active", ownerEmail: "owner@sender.test",
    } as never);
    return await ctx.db.insert("notifications", {
      orgId: "org_s", channel: "email", recipient: "client@x.test", subject: "Your files",
      body: "Your files are ready.", kind, status: "simulated",
    });
  });
  return { t, id };
}

describe("delivery email sender (F2-11)", () => {
  it("F2-11 delivery.ready and delivery.pay come from the studio via Pulse", async () => {
    for (const kind of ["delivery.ready", "delivery.pay"]) {
      const { t, id } = await queued("Blue Room Studios", kind);
      const fetchMock = mockResend();
      await t.action(internal.notifications.deliver, { id });
      expect(sentFrom(fetchMock)).toBe("Blue Room Studios via Pulse <support@studiopulse.tech>");
      vi.restoreAllMocks();
    }
  });

  it("F2-11 a hostile studio name cannot add an address or a header", async () => {
    const hostile = 'Evil" <attacker@evil.test>, "Bob\r\nBcc: victim@x.test';
    const { t, id } = await queued(hostile, "delivery.ready");
    const fetchMock = mockResend();
    await t.action(internal.notifications.deliver, { id });
    const from = sentFrom(fetchMock)!;
    expect(from.endsWith(" via Pulse <support@studiopulse.tech>")).toBe(true);
    const name = from.slice(0, -" via Pulse <support@studiopulse.tech>".length);
    expect(name).not.toMatch(/["<>,@;:\\()[\]\r\n\t]/);
    expect(from.match(/</g)).toHaveLength(1);
    expect(from.match(/@/g)).toHaveLength(1);
  });

  it("F2-11 other notification kinds keep today's sender", async () => {
    const { t, id } = await queued("Blue Room Studios", "session.reminder_24h");
    const fetchMock = mockResend();
    await t.action(internal.notifications.deliver, { id });
    expect(sentFrom(fetchMock)).toBe("Pulse <support@studiopulse.tech>");
  });

  it("F2-11 studioSender keeps ordinary names and falls back when nothing is left", () => {
    expect(studioSender("Mike's Place")).toBe("Mike's Place via Pulse <support@studiopulse.tech>");
    expect(studioSender("St. Louis Sound")).toBe("St. Louis Sound via Pulse <support@studiopulse.tech>");
    expect(studioSender('"<>",')).toBe("Your studio via Pulse <support@studiopulse.tech>");
    expect(studioSender("A  \n  B")).toBe("A B via Pulse <support@studiopulse.tech>");
  });
});
