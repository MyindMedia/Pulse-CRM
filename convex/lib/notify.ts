import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

/* ============================================================
   notify() — the messaging seam.
   Confirmations and reminders are written to the `notifications`
   table and marked "simulated". Nothing is actually delivered yet;
   a real provider (Resend for email, Twilio for SMS) drops in here
   without changing any caller.
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
  await ctx.db.insert("notifications", { ...args, status: "simulated" });
}
