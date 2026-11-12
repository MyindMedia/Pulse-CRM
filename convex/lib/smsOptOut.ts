import type { QueryCtx } from "../_generated/server";
import { normalizePhone } from "./phone";

/** Has this number replied STOP (and not START since)? The number is
 *  normalized to E.164 first, the same way the STOP handler stores it
 *  (sms.ts handleInboundText), so "(555) 123-4567" matches "+15551234567". */
export async function isSmsOptedOut(ctx: QueryCtx, rawPhone: string): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;
  const row = await ctx.db
    .query("smsOptOuts")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  return row?.optedOut ?? false;
}
