import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

describe("Google OAuth state nonce (CSRF guard)", () => {
  it("resolves the org for a valid nonce, then is single-use", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.googleAuth._createOAuthState, { orgId: "orgA", nonce: "n1" });
    expect(await t.mutation(internal.googleAuth._consumeOAuthState, { nonce: "n1" })).toBe("orgA");
    // Second consume returns null (deleted on first use) - a replay is rejected.
    expect(await t.mutation(internal.googleAuth._consumeOAuthState, { nonce: "n1" })).toBeNull();
  });

  it("rejects an unknown / forged nonce", async () => {
    const t = convexTest(schema);
    expect(await t.mutation(internal.googleAuth._consumeOAuthState, { nonce: "forged" })).toBeNull();
  });

  it("rejects an expired nonce", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("oauthStates", { nonce: "old", orgId: "orgA", expiresAt: Date.now() - 1000 });
    });
    expect(await t.mutation(internal.googleAuth._consumeOAuthState, { nonce: "old" })).toBeNull();
  });
});

describe("portal concierge rate limit", () => {
  it("blocks once the per-grant hourly cap is exceeded", async () => {
    const t = convexTest(schema);
    const grantId = await t.run((ctx) =>
      ctx.db.insert("collaboratorGrants", {
        orgId: "orgA", email: "a@x.com", name: "A", scope: "artist_portal",
        entityId: "e1", capabilities: [], token: "tok", expiresAt: Date.now() + 86_400_000,
        invitedBy: "u1", useCount: 0,
      }),
    );
    let allowed = 0;
    for (let i = 0; i < 35; i++) {
      if (await t.mutation(internal.grants.checkAskRate, { grantId })) allowed++;
    }
    expect(allowed).toBe(30); // capped at the hourly limit
  });
});
