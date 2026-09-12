import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* Production Clerk only lets allowlisted addresses create an account. Owners
   were put on the list when invited; teammates never were, so every staff
   invitation ended on the web page with "<email>, <phone> are not allowed to
   access this application" (found 2026-09-12 recording the App Review video).
   These pin both doors: the invitation, and the acceptance - which also rescues
   invitations sent before the fix. */

type Call = { url: string; body: unknown };
const realFetch = globalThis.fetch;

function stubClerk() {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/v1/users")) return new Response(JSON.stringify({ id: "user_new" }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

const allowlisted = (calls: Call[]) =>
  calls
    .filter((c) => c.url === "https://api.clerk.com/v1/allowlist_identifiers")
    .map((c) => (c.body as { identifier: string }).identifier);

describe("teammates are allowlisted in Clerk", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    process.env.CLERK_SECRET_KEY = "sk_test_key";
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Skyline Sound", slug: "demo", plan: "studio", status: "active",
        clerkOrgId: "org_demo",
      });
    });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.CLERK_SECRET_KEY;
    vi.restoreAllMocks();
  });

  it("inviting a teammate puts their email on the allowlist", async () => {
    const calls = stubClerk();
    await t.action(api.members.inviteTeammate, {
      name: "Jordan Rivera", email: "Jordan@Demo.com", role: "engineer",
    });
    expect(allowlisted(calls)).toContain("jordan@demo.com");
  });

  it("accepting an invitation allowlists the email before creating the account", async () => {
    const token = await t.mutation(internal.invites.record, {
      orgId: "pulse-demo", clerkOrgId: "org_demo", email: "sam@demo.com", ownerName: "Sam",
      studioName: "Skyline Sound", invitedBy: "owner", emailStatus: "sent", role: "engineer",
    });
    await t.mutation(internal.members._prepareTeammate, { name: "Sam", email: "sam@demo.com", role: "engineer" });
    const calls = stubClerk();

    const res = await t.action(api.invites.accept, {
      token, name: "Sam Lee", password: "correct horse battery staple", phone: "(500) 555-0009",
    });

    expect(res.ok).toBe(true);
    const allowAt = calls.findIndex((c) => c.url.endsWith("/v1/allowlist_identifiers"));
    const createAt = calls.findIndex((c) => c.url.endsWith("/v1/users"));
    expect(allowlisted(calls)).toContain("sam@demo.com");
    expect(allowAt).toBeGreaterThanOrEqual(0);
    expect(allowAt).toBeLessThan(createAt);
  });
});
