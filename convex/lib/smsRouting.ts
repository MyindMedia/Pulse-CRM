import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { normalizePhone } from "./phone";

export type InboundRoute =
  | { kind: "none" }
  | { kind: "routed"; artist: Doc<"artists">; routedBy: "only_match" | "last_texted" | "best_guess" }
  | { kind: "unrouted"; candidateOrgIds: string[]; agencyId: string };

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/* Which studio an inbound text is for.
 *
 * Texts arrive on one shared number with nothing but the sender's phone. The
 * old rule took the first client anywhere with that phone, so a client of two
 * studios could land in either. In order:
 *   1. Only one studio has this client: that studio.
 *   2. Several do: the one that texted this phone most recently in the last 30
 *      days (outbound texts, reminders and two-way prompts all count).
 *   3. None did lately, and one agency runs every candidate studio: held on that
 *      agency's Unrouted list for a person to send on. No studio sees a text
 *      that may not be theirs.
 *   4. No single agency runs them: the studio where the client was last in
 *      touch, marked as a guess.
 */
export async function routeInboundText(ctx: MutationCtx, phone: string, now = Date.now()): Promise<InboundRoute> {
  const candidates = (await ctx.db.query("artists").collect()).filter(
    (a) => !a.erasedAt && !!a.phone && normalizePhone(a.phone) === phone,
  );
  if (candidates.length === 0) return { kind: "none" };

  const orgIds = [...new Set(candidates.map((a) => a.orgId))];
  if (orgIds.length === 1) {
    return { kind: "routed", artist: newestIn(candidates, orgIds[0]), routedBy: "only_match" };
  }

  const since = now - RECENT_MS;
  const lastByOrg = new Map<string, number>();
  const note = (orgId: string, at: number) => {
    if (at >= since && at > (lastByOrg.get(orgId) ?? 0)) lastByOrg.set(orgId, at);
  };
  for (const c of await ctx.db.query("smsContacts").withIndex("by_phone", (q) => q.eq("phone", phone)).collect()) {
    note(c.orgId, c.lastSentAt);
  }
  for (const p of await ctx.db.query("smsPrompts").withIndex("by_phone_status", (q) => q.eq("phone", phone)).collect()) {
    note(p.orgId, p.sentAt);
  }
  for (const a of candidates) {
    const rows = await ctx.db.query("clientMessages").withIndex("by_artist", (q) => q.eq("artistId", a._id)).collect();
    for (const m of rows) if (m.direction === "out") note(a.orgId, m._creationTime);
  }

  const ranked = orgIds
    .map((orgId) => ({ orgId, at: lastByOrg.get(orgId) ?? 0 }))
    .filter((r) => r.at > 0)
    .sort((x, y) => y.at - x.at);
  if (ranked.length > 0 && (ranked.length === 1 || ranked[0].at > ranked[1].at)) {
    return { kind: "routed", artist: newestIn(candidates, ranked[0].orgId), routedBy: "last_texted" };
  }

  const orgs = await Promise.all(
    orgIds.map((orgId) => ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first()),
  );
  const agencies = new Set(orgs.map((o) => o?.agencyId ?? ""));
  if (agencies.size === 1 && !agencies.has("")) {
    return { kind: "unrouted", candidateOrgIds: orgIds, agencyId: [...agencies][0] };
  }

  let best = candidates[0];
  let bestAt = -1;
  for (const a of candidates) {
    const rows = await ctx.db.query("clientMessages").withIndex("by_artist", (q) => q.eq("artistId", a._id)).collect();
    const at = Math.max(a.lastContactAt ?? 0, a._creationTime, ...rows.map((m) => m._creationTime));
    if (at > bestAt) {
      best = a;
      bestAt = at;
    }
  }
  return { kind: "routed", artist: best, routedBy: "best_guess" };
}

/** The most recently contacted row for this client in one studio (a studio can hold a client twice). */
function newestIn(candidates: Doc<"artists">[], orgId: string): Doc<"artists"> {
  return candidates
    .filter((a) => a.orgId === orgId)
    .sort((x, y) => (y.lastContactAt ?? y._creationTime) - (x.lastContactAt ?? x._creationTime))[0];
}
