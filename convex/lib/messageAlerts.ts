import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";

const DAY_MS = 24 * 60 * 60 * 1000;

/* A client wrote in: tell the people who answer.
 *
 * Owners and managers, and the engineer on this client's booking when there is
 * one within a day either side. The alert names the client and never carries
 * the message: a push passes through Apple, and the text itself stays in the
 * studio's own records (docs/compliance/messages.md). */
export async function alertStudioOfClientMessage(ctx: MutationCtx, artist: Doc<"artists">): Promise<void> {
  const orgId = artist.orgId;
  const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  const audience = new Set(
    members
      .filter((m) => (m.role === "owner" || m.role === "manager") && !!m.clerkUserId)
      .map((m) => m.clerkUserId as string),
  );
  const now = Date.now();
  const nearby = await ctx.db
    .query("sessions")
    .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now - DAY_MS).lt("startTime", now + DAY_MS))
    .collect();
  for (const s of nearby) {
    if (s.artistId !== artist._id || !s.engineerId || s.status === "cancelled") continue;
    const engineer = await ctx.db.get(s.engineerId);
    if (engineer?.clerkUserId) audience.add(engineer.clerkUserId);
  }
  if (audience.size === 0) return;
  await ctx.scheduler.runAfter(0, internal.notify.toOrg, {
    orgId,
    title: `${artist.name} sent a message`,
    body: "Open Messages to read it and reply.",
    url: `/roster/${artist._id}`,
    tag: "client-message",
    clerkUserIds: [...audience],
    strictAudience: true,
  });
}
