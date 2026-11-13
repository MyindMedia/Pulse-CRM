import { v } from "convex/values";
import { internalMutation } from "./functions";
import { contactSince, stampContact } from "./lib/agentAutoSend";

/* ============================================================
   One-time report for client rows written before contact stamps existed.

   The assistant sends alone only to a client whose address went on file
   before the conversation it read (lib/agentAutoSend.ts). Rows written
   before that rule have no stamp, so their reminders wait for a person.
   Nothing runs this automatically. The owner runs it per studio:

     report:  npx convex run clientContacts:stampLegacyContacts '{"orgId":"…"}'
     apply:   … '{"orgId":"…","apply":true}'   (page with "cursor")

   Only rows with no stamp at all are listed: every write path since then
   stores one (public forms store an empty one, so a contact typed into a
   form is never stamped from here).

   Applying stamps each current address as on file from NOW (we cannot
   know when it really went on file), so it becomes eligible only after
   one full message window has passed. Leads and erased rows are skipped.
   ============================================================ */
export const stampLegacyContacts = internalMutation({
  args: { orgId: v.string(), apply: v.optional(v.boolean()), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { orgId, apply, cursor }) => {
    const page = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    const now = Date.now();
    const unproven: { id: string; name: string; email: string | null; phone: string | null }[] = [];
    for (const a of page.page) {
      if (a.erasedAt || a.catalogOnly || a.status === "lead") continue;
      // Only rows written before stamps existed. A row with a stamp object
      // (even an empty one from a public form) is never stamped from here:
      // a contact typed into a public form must not go on file this way.
      if (a.contactOnFile !== undefined) continue;
      const c = contactSince(a);
      const missing = (c.email && c.emailAt === null) || (c.phone && c.phoneAt === null);
      if (!missing) continue;
      unproven.push({ id: a._id, name: a.name, email: c.email, phone: c.phone });
      if (apply) await ctx.db.patch(a._id, { contactOnFile: stampContact(a.contactOnFile, { email: a.email, phone: a.phone }, now) });
    }
    return { applied: !!apply, unproven, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
