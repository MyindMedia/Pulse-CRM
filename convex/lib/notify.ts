import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/* ============================================================
   notify() - the messaging seam.
   Confirmations and reminders are written to the `notifications`
   table, then delivered for real by a scheduled internal action
   (Resend for email, the configured SMS provider for texts). The
   row's status advances simulated -> sent/failed; it only stays
   "simulated" when no provider is configured on the deployment.
   ============================================================ */

export async function notify(
  ctx: MutationCtx,
  args: {
    orgId: string;
    channel: "email" | "sms";
    recipient: string;
    subject: string;
    body: string;
    kind: string;
    sessionId?: Id<"sessions">;
  },
): Promise<void> {
  const id = await ctx.db.insert("notifications", { ...args, status: "simulated" });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { id });
}
