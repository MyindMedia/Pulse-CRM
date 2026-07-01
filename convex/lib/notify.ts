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

/** Resolve a teammate's email address by member id. Returns null when the
    member has no email on file (or the id is stale). */
export async function resolveMemberEmail(
  ctx: MutationCtx,
  memberId: Id<"members">,
): Promise<string | null> {
  const member = await ctx.db.get(memberId);
  return member?.email ?? null;
}

/** Email the studio's internal team about a status change - new bookings,
    payments landing, invoices paid, holds released.

    By default this reaches the org owner. Pass `toMemberId` (routes to that
    teammate's email) or `toEmail` (explicit address) to reach the teammate
    the event actually concerns - e.g. the assigned engineer on a booking.
    Any targeting that resolves to no address falls back to the owner, so the
    alert is never silently dropped. No-op only when neither the target nor the
    owner has an email on file. The existing `{ orgId, subject, body, kind,
    sessionId }` call shape stays valid - the routing fields are optional. */
export async function notifyTeam(
  ctx: MutationCtx,
  args: {
    orgId: string;
    subject: string;
    body: string;
    kind: string;
    sessionId?: Id<"sessions">;
    /** Route to this teammate's email, falling back to the owner. */
    toMemberId?: Id<"members">;
    /** Route to an explicit email, falling back to the owner. */
    toEmail?: string;
  },
): Promise<void> {
  const { toMemberId, toEmail, ...payload } = args;

  let recipient: string | null = null;
  if (toEmail) {
    recipient = toEmail;
  } else if (toMemberId) {
    recipient = await resolveMemberEmail(ctx, toMemberId);
  }

  // Fall back to the org owner whenever no target address resolved.
  if (!recipient) {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();
    recipient = org?.ownerEmail ?? null;
  }

  if (!recipient) return;
  await notify(ctx, { ...payload, channel: "email", recipient });
}
