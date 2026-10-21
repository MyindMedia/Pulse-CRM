import { v } from "convex/values";
import { internalQuery, internalAction } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizePhone } from "./lib/phone";
import { studioTag, tagZuopsLead, zuopsSmsConfig } from "./lib/zuopsSms";

/* Studio groups in Zuops. Every studio texts through the one Pulse sub-account,
   so each studio's contacts are grouped there by a "Studio: <name>" tag. The
   source is smsContacts, which records every studio-to-phone text; a row is
   tagged once and then stamped. Rows from before Zuops carried SMS are left
   until that studio texts the phone again (the send bumps lastSentAt). Reply
   routing does not depend on this: Pulse routes replies itself (smsRouting). */

type Untagged = { id: Id<"smsContacts">; phone: string; studio: string; name?: string };

/** Texts sent before this time went out through GHL, so their phones are not
 *  backfilled into Zuops. */
const ZUOPS_SMS_SINCE = Date.parse("2026-10-21T19:00:00Z");
const BATCH = 20;

export const _untagged = internalQuery({
  args: {},
  handler: async (ctx): Promise<Untagged[]> => {
    const rows = await ctx.db
      .query("smsContacts")
      .withIndex("by_zuops_tagged", (q) => q.eq("zuopsTaggedAt", undefined).gte("lastSentAt", ZUOPS_SMS_SINCE))
      .take(BATCH);
    const out: Untagged[] = [];
    for (const r of rows) {
      const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", r.orgId)).first();
      if (!org) continue;
      const artists = await ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", r.orgId)).collect();
      const client = artists.find((a) => !a.erasedAt && !!a.phone && normalizePhone(a.phone) === r.phone);
      out.push({ id: r._id, phone: r.phone, studio: org.name, name: client?.name });
    }
    return out;
  },
});

export const _markTagged = internalMutation({
  args: { id: v.id("smsContacts") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { zuopsTaggedAt: Date.now() });
  },
});

/** Cron: tag new studio contacts in Zuops, a batch a run. Only while Zuops
 *  carries Pulse SMS. A failure leaves the row for the next run. */
export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ skipped: true } | { tagged: number; seen: number }> => {
    if ((process.env.SMS_PROVIDER ?? "").toLowerCase() !== "zuops" || !zuopsSmsConfig()) return { skipped: true };
    const rows: Untagged[] = await ctx.runQuery(internal.zuopsStudioTags._untagged, {});
    let tagged = 0;
    for (const r of rows) {
      const res = await tagZuopsLead({ phone: r.phone, tag: studioTag(r.studio), name: r.name });
      if (res !== "tagged") continue;
      await ctx.runMutation(internal.zuopsStudioTags._markTagged, { id: r.id });
      tagged++;
    }
    return { tagged, seen: rows.length };
  },
});
