/* Test fixture for session files, payments and session file delivery.

   The file name carries two dots on purpose: the Convex bundler skips any
   module whose name has more than one dot, so this test-only helper (which
   imports vitest and convex-test) is never pushed to a deployment, and vitest
   does not pick it up as a test file either.

   R2 is mocked by the @convex-dev/r2 test component (presigns locally); nothing
   here touches Cloudflare, Resend or a deployment. */
import { vi } from "vitest";
import { convexTest } from "convex-test";
import r2Test from "@convex-dev/r2/test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";

export type TestConvex = ReturnType<typeof convexTest<(typeof schema)["tables"]>>;
export type IdentityClient = ReturnType<TestConvex["withIdentity"]>;

export const R2_ENDPOINT = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
export const R2_KEY_PREFIX = "test";
export const APP_URL = "https://app.example.test";

/** The env every test in these suites runs with. Email and text providers are
 *  blanked so a test can never send a real message. */
export function r2Env(): void {
  vi.stubEnv("R2_ENDPOINT", R2_ENDPOINT);
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIATEST");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-test-value");
  vi.stubEnv("R2_PRIVATE_BUCKET", "pulse-private");
  vi.stubEnv("R2_MEDIA_BUCKET", "pulse-media");
  vi.stubEnv("R2_KEY_PREFIX", R2_KEY_PREFIX);
  vi.stubEnv("R2_PUBLIC_URL", "https://media.example.test");
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "");
}

/** Studio A takes cards online: the platform Stripe key is set and the studio
 *  has a connected account that can charge. Both pay pages (the booking
 *  checkout and the invoice page) need this before they can charge anything,
 *  so the delivery page offers a Pay button only with it (payTargetFor). */
export async function cardsOn(t: TestConvex, orgId = "studio_a"): Promise<void> {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
  await t.run(async (ctx) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    await ctx.db.patch(org!._id, { stripeAccountId: `acct_${orgId}`, stripeChargesEnabled: true });
  });
}

const artistBase = {
  type: "artist" as const,
  genres: [],
  tags: [],
  status: "active" as const,
  reliability: "solid" as const,
  sessionCount: 0,
  lifetimeValueCents: 0,
};

export async function setupStudios() {
  const t = convexTest(schema);
  r2Test.register(t);
  const start = Date.UTC(2026, 10, 10, 18, 0, 0);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "studio_a", name: "Studio A", slug: "studio-a", tier: "growth", status: "active",
      accentColor: "#3b63e6", ownerEmail: "owner@studio-a.example.com",
    });
    await ctx.db.insert("orgs", {
      orgId: "studio_b", name: "Studio B", slug: "studio-b", tier: "growth", status: "active",
      ownerEmail: "owner@studio-b.example.com",
    });
    const owner = await ctx.db.insert("members", { orgId: "studio_a", name: "Olu Owner", role: "owner", skills: [], clerkUserId: "u_owner" });
    await ctx.db.insert("members", { orgId: "studio_a", name: "Mo Manager", role: "manager", skills: [], clerkUserId: "u_mgr" });
    const engineer = await ctx.db.insert("members", { orgId: "studio_a", name: "Eli Engineer", role: "engineer", skills: [], clerkUserId: "u_eng" });
    await ctx.db.insert("members", { orgId: "studio_b", name: "Bea Owner", role: "owner", skills: [], clerkUserId: "u_b" });

    const artistId = await ctx.db.insert("artists", {
      ...artistBase, orgId: "studio_a", name: "Jordan Ellis", email: "jordan.ellis@example.com",
    });
    const sessionId = await ctx.db.insert("sessions", {
      orgId: "studio_a", title: "Vocal tracking", artistId, serviceType: "recording",
      engineerId: engineer, createdByMemberId: owner,
      startTime: start, endTime: start + 4 * 3_600_000, status: "confirmed",
      rateCents: 36000, depositCents: 18000, depositPaid: true, amountPaidCents: 18000,
      intakeCompleted: false,
    });
    const otherSessionId = await ctx.db.insert("sessions", {
      orgId: "studio_a", title: "Mix review", artistId, serviceType: "mixing",
      startTime: start + 86_400_000, endTime: start + 86_400_000 + 2 * 3_600_000, status: "confirmed",
      rateCents: 20000, depositCents: 10000, depositPaid: false, amountPaidCents: 0,
      intakeCompleted: false,
    });
    const bArtistId = await ctx.db.insert("artists", {
      ...artistBase, orgId: "studio_b", name: "Casey Bloom", email: "casey.bloom@example.com",
    });
    const bSessionId = await ctx.db.insert("sessions", {
      orgId: "studio_b", title: "B session", artistId: bArtistId, serviceType: "recording",
      startTime: start, endTime: start + 3_600_000, status: "confirmed",
      rateCents: 10000, depositCents: 5000, depositPaid: false, amountPaidCents: 0,
      intakeCompleted: false,
    });
    return { artistId, sessionId, otherSessionId, bSessionId };
  });
  const as = (user: string): IdentityClient => t.withIdentity({ subject: user, name: user });
  return {
    t,
    as,
    start,
    A: {
      orgId: "studio_a" as const, owner: "u_owner" as const, manager: "u_mgr" as const, engineer: "u_eng" as const,
      artistId: ids.artistId, sessionId: ids.sessionId, otherSessionId: ids.otherSessionId,
    },
    B: { orgId: "studio_b" as const, owner: "u_b" as const, sessionId: ids.bSessionId },
  };
}

/** prepareUpload -> (the browser PUTs) -> confirmUpload's effect -> attach. */
export async function uploadSessionFile(
  t: TestConvex,
  who: IdentityClient,
  sessionId: Id<"sessions">,
  fileName = "Lead vocal.wav",
  mimeType = "audio/wav",
  size = 5_000_000,
): Promise<{ assetId: Id<"mediaAssets">; versionId: Id<"mediaVersions"> }> {
  const prep = await who.mutation(api.sessionFiles.prepareUpload, { sessionId, fileName, mimeType, size });
  await t.mutation(internal.media._markReady, { mediaId: prep.mediaId, size });
  return await who.mutation(api.sessionFiles.attach, { sessionId, mediaId: prep.mediaId });
}

/** Email rows for the booking's client, oldest first. */
export async function clientEmails(t: TestConvex, sessionId: Id<"sessions">): Promise<Array<Doc<"notifications">>> {
  return await t.run(async (ctx) => {
    const session = await ctx.db.get(sessionId);
    const artist = session ? await ctx.db.get(session.artistId) : null;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .take(200);
    return rows
      .filter((r) => r.channel === "email" && !!artist?.email && r.recipient === artist.email)
      .sort((a, b) => a._creationTime - b._creationTime);
  });
}
