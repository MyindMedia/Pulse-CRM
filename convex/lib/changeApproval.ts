import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { resolveViewer } from "./access";
import { bookingFeatures } from "./roomBusy";
import { notifyTeam } from "./notify";
import { changeRequested } from "./bookingMessages";
import { appUrl } from "./links";

/* ============================================================
   Change approvals on existing bookings (bookingFeatures.changeApproval,
   docs/plans/hardcover-booking.md, Phase 2 E).

   Anyone on the team can create a booking. With the switch on, changing
   someone else's booking (move, extend, change room or engineer, cancel)
   becomes a proposal in `sessionChangeRequests` instead of an edit. The
   booking's creator or an owner approves it, and approval runs the change
   through the same code paths a direct edit uses (sessions.ts).

   A booking with no creator (public booking) is decided by the owners;
   managers may decide those too, so a manager edits them directly.
   With the switch off nothing here runs: `changeGate` returns null.
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

export type ProposedChange = Doc<"sessionChangeRequests">["proposed"];

/** Who is acting, reduced to what the approval rules need. */
export type Actor = {
  memberId?: Id<"members">;
  /** Owner of the studio, the demo owner, or a Pulse agency operator. */
  ownerLevel: boolean;
  role?: Doc<"members">["role"];
};

export async function resolveActor(ctx: Ctx): Promise<Actor> {
  const viewer = await resolveViewer(ctx);
  if (viewer.kind === "agency_member") return { ownerLevel: true };
  if (viewer.kind !== "studio_member") return { ownerLevel: false };
  const raw = viewer.memberId as unknown as string;
  const memberId =
    raw && raw !== "demo" && raw !== "system"
      ? (ctx.db.normalizeId("members", raw) ?? undefined)
      : undefined;
  return { memberId, ownerLevel: viewer.role === "owner", role: viewer.role };
}

/** Pure: may this actor edit this booking directly? */
export function editsDirectly(actor: Actor, session: Pick<Doc<"sessions">, "createdByMemberId">): boolean {
  if (actor.ownerLevel) return true;
  const creator = session.createdByMemberId;
  if (creator) return actor.memberId !== undefined && actor.memberId === creator;
  // No creator (public booking): owners decide, and managers may too.
  return actor.role === "manager";
}

/** Pure: may this actor approve or decline a request on this booking? */
export function mayDecide(
  actor: Actor,
  session: Pick<Doc<"sessions">, "createdByMemberId">,
  request: Pick<Doc<"sessionChangeRequests">, "approverMemberId" | "requestedByMemberId">,
): boolean {
  if (actor.ownerLevel) return true;
  if (!actor.memberId) return false;
  // Nobody signs off on their own proposal.
  if (request.requestedByMemberId && request.requestedByMemberId === actor.memberId) return false;
  if (request.approverMemberId === actor.memberId) return true;
  if (session.createdByMemberId === actor.memberId) return true;
  return !session.createdByMemberId && actor.role === "manager";
}

/** Null when the edit goes ahead directly; otherwise the actor who must
 *  propose instead. Reads the studio's switch first, so with the switch off
 *  this is one org read and nothing else. */
export async function changeGate(
  ctx: MutationCtx,
  orgId: string,
  session: Doc<"sessions">,
): Promise<Actor | null> {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (!bookingFeatures(org).changeApproval) return null;
  const actor = await resolveActor(ctx);
  return editsDirectly(actor, session) ? null : actor;
}

/** Who decides: the booking's creator, else the first owner on the team. */
export async function resolveApprover(
  ctx: Ctx,
  orgId: string,
  session: Doc<"sessions">,
): Promise<Doc<"members"> | null> {
  if (session.createdByMemberId) {
    const creator = await ctx.db.get(session.createdByMemberId);
    if (creator && creator.orgId === orgId) return creator;
  }
  const team = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  return team.find((m) => m.role === "owner") ?? null;
}

function fmt(ms: number, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(ms);
}

/** Pure: one line describing a proposed change, e.g.
 *  "Move to Tuesday, October 20, 2:00 PM to 5:00 PM; engineer: Dana". */
export function describeProposal(
  session: Pick<Doc<"sessions">, "startTime" | "endTime">,
  proposed: ProposedChange,
  names: { roomName?: string | null; engineerName?: string | null },
  timeZone = "America/Los_Angeles",
): string {
  if (proposed.status === "cancelled") return "Cancel the booking";
  const parts: string[] = [];
  if (proposed.startTime !== undefined || proposed.endTime !== undefined) {
    const start = proposed.startTime ?? session.startTime;
    const end = proposed.endTime ?? session.endTime;
    const day = fmt(start, timeZone, { weekday: "long", month: "long", day: "numeric" });
    const t = (ms: number) => fmt(ms, timeZone, { hour: "numeric", minute: "2-digit" });
    if (proposed.startTime === undefined || proposed.startTime === session.startTime) {
      const mins = Math.round((end - session.endTime) / 60_000);
      parts.push(
        mins > 0
          ? `Extend by ${mins} min, to end at ${t(end)}`
          : mins < 0
            ? `Shorten by ${-mins} min, to end at ${t(end)}`
            : `Keep the time, ${t(start)} to ${t(end)}`,
      );
    } else {
      parts.push(`Move to ${day}, ${t(start)} to ${t(end)}`);
    }
  }
  if (proposed.roomId) parts.push(`room: ${names.roomName ?? "another room"}`);
  if (proposed.engineerId) parts.push(`engineer: ${names.engineerName ?? "another engineer"}`);
  if (proposed.status) parts.push(`status: ${proposed.status.replace("_", " ")}`);
  const text = parts.join("; ");
  return text ? text[0].toUpperCase() + text.slice(1) : "No change";
}

/** describeProposal with the names and the studio's timezone looked up. */
export async function describeRequest(
  ctx: Ctx,
  session: Doc<"sessions">,
  proposed: ProposedChange,
): Promise<string> {
  const [room, engineer, org] = await Promise.all([
    proposed.roomId ? ctx.db.get(proposed.roomId) : null,
    proposed.engineerId ? ctx.db.get(proposed.engineerId) : null,
    ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", session.orgId)).first(),
  ]);
  return describeProposal(
    session,
    proposed,
    { roomName: room?.name, engineerName: engineer?.name },
    org?.timezone || undefined,
  );
}

export type ProposalResult = {
  proposed: true;
  requestId: Id<"sessionChangeRequests">;
  approverName: string;
};

/** A mutation that may propose instead of edit returns `Direct` or this.
 *  Every field of the direct shape is declared (as undefined) so existing
 *  callers that read e.g. `res.rateCents` still typecheck; new callers
 *  narrow on `res.proposed`. */
export type Proposed<Direct> = ProposalResult & { [K in keyof Direct]?: undefined };
export type DirectOr<Direct> =
  | (Direct & { proposed?: undefined; requestId?: undefined; approverName?: undefined })
  | Proposed<Direct>;

/** Record a proposal (or fold it into the requester's open one on the same
 *  booking), log it, and tell the approver. */
export async function proposeChange(
  ctx: MutationCtx,
  args: {
    orgId: string;
    session: Doc<"sessions">;
    actor: Actor;
    proposed: ProposedChange;
    reason?: string;
  },
): Promise<ProposalResult> {
  const { orgId, session, actor } = args;
  if (!actor.memberId) {
    // Only a signed-in teammate can propose; everyone else is owner-level or
    // has no business editing bookings.
    throw new Error("Sign in as a team member to propose a change.");
  }
  const approver = await resolveApprover(ctx, orgId, session);
  const approverMemberId = approver?._id;

  const open = (
    await ctx.db.query("sessionChangeRequests").withIndex("by_session", (q) => q.eq("sessionId", session._id)).collect()
  ).find((r) => r.status === "pending" && r.origin === "pulse" && r.requestedByMemberId === actor.memberId);

  let requestId: Id<"sessionChangeRequests">;
  let proposed: ProposedChange;
  if (open) {
    // A cancel replaces whatever was proposed; anything else is merged in.
    const base = open.proposed.status === "cancelled" ? {} : open.proposed;
    proposed = args.proposed.status === "cancelled" ? { status: "cancelled" } : { ...base, ...args.proposed };
    requestId = open._id;
    await ctx.db.patch(open._id, {
      proposed,
      reason: args.reason?.trim() || open.reason,
      approverMemberId,
    });
  } else {
    proposed = args.proposed;
    requestId = await ctx.db.insert("sessionChangeRequests", {
      orgId,
      sessionId: session._id,
      requestedByMemberId: actor.memberId,
      origin: "pulse",
      proposed,
      reason: args.reason?.trim() || undefined,
      approverMemberId,
      status: "pending",
    });
  }

  const requester = await ctx.db.get(actor.memberId);
  const requesterName = requester?.name ?? "A teammate";
  const approverName = approver?.name ?? "the owner";
  const summary = await describeRequest(ctx, session, proposed);

  await ctx.db.insert("activity", {
    orgId,
    kind: "session.change_requested",
    summary: `${requesterName} proposed a change to ${session.title}: ${summary}. Waiting on ${approverName}.`,
    entityType: "session",
    entityId: session._id,
    accent: "info",
  });

  const facts = await bookingFactsFor(ctx, session);
  const msg = changeRequested({
    ...facts,
    requesterName,
    summary,
    reviewUrl: `${appUrl()}/calendar?session=${session._id}`,
  });
  await notifyTeam(ctx, {
    orgId,
    subject: msg.subject,
    body: msg.body,
    kind: "session.change_requested",
    sessionId: session._id,
    toMemberId: approverMemberId,
  });
  if (approver?.clerkUserId) {
    await ctx.scheduler.runAfter(0, internal.notify.toOrg, {
      orgId,
      title: msg.subject,
      body: summary,
      url: `/calendar?session=${session._id}`,
      tag: `change-${requestId}`,
      clerkUserIds: [approver.clerkUserId],
      strictAudience: true,
    });
  }

  return { proposed: true, requestId, approverName };
}

/** The plain facts the booking message templates take. */
export async function bookingFactsFor(ctx: Ctx, session: Doc<"sessions">) {
  const [org, artist, room, engineer] = await Promise.all([
    ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", session.orgId)).first(),
    ctx.db.get(session.artistId),
    session.roomId ? ctx.db.get(session.roomId) : null,
    session.engineerId ? ctx.db.get(session.engineerId) : null,
  ]);
  return {
    studioName: org?.name ?? "Your studio",
    clientName: artist?.name ?? "the client",
    roomName: room?.name,
    engineerName: engineer?.name,
    startTime: session.startTime,
    endTime: session.endTime,
    timeZone: org?.timezone || undefined,
  };
}
