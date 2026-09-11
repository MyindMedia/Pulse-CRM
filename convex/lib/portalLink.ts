import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { GUEST_SCOPE_CAPABILITIES, GUEST_SCOPE_DEFAULT_TTL_MS } from "./accessPolicies";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The client's portal address: a live link if they have one with more than a
 *  week left, otherwise a new one. Issued by the system for messaging, so it is
 *  not counted against the studio's magic-link allowance (grants.issue is). */
export async function ensurePortalLink(ctx: MutationCtx, orgId: string, artist: Doc<"artists">): Promise<string> {
  const base = process.env.APP_URL ?? "https://studiopulse.tech";
  const now = Date.now();
  const live = (
    await ctx.db.query("collaboratorGrants").withIndex("by_entity", (q) => q.eq("entityId", artist._id)).collect()
  )
    .filter((g) => g.scope === "artist_portal" && g.orgId === orgId && !g.revoked && g.expiresAt > now + WEEK_MS)
    .sort((a, b) => b.expiresAt - a.expiresAt)[0];
  if (live) return `${base}/portal/${live.token}`;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  await ctx.db.insert("collaboratorGrants", {
    orgId,
    email: artist.email ?? "",
    name: artist.name,
    scope: "artist_portal",
    entityId: artist._id,
    capabilities: [...GUEST_SCOPE_CAPABILITIES.artist_portal],
    token,
    expiresAt: now + GUEST_SCOPE_DEFAULT_TTL_MS.artist_portal,
    invitedBy: "system:messages",
    useCount: 0,
  });
  return `${base}/portal/${token}`;
}
