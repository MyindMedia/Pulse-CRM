import type { MutationCtx } from "../_generated/server";
import { normalizePhone } from "./phone";

/* Who texted a phone last.
 *
 * Every studio texts from the one shared Myind Sound number, so a reply carries
 * no sign of which studio it answers. The best evidence is which studio wrote
 * to that phone most recently: recorded here on every outbound text, and read
 * by lib/smsRouting.ts when a reply arrives. */
export async function recordSmsContact(ctx: MutationCtx, orgId: string, rawPhone?: string | null): Promise<void> {
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (!phone) return;
  const now = Date.now();
  const existing = await ctx.db
    .query("smsContacts")
    .withIndex("by_phone_org", (q) => q.eq("phone", phone).eq("orgId", orgId))
    .first();
  if (existing) await ctx.db.patch(existing._id, { lastSentAt: now });
  else await ctx.db.insert("smsContacts", { phone, orgId, lastSentAt: now });
}
