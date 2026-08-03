import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { sendSms } from "./lib/sms";
import { normalizePhone } from "./lib/phone";
import { parseSmsIntent, parseRating } from "./lib/smsKeywords";
import { appUrl } from "./lib/links";
import { orgTz, dateLabel } from "./lib/tz";
import {
  renderSms,
  displayPhone,
  CLIENT_CONFIRM_ACK,
  CLIENT_DECLINE_FOLLOWUP,
  CLIENT_REBOOK_ACK,
  STAFF_CONFIRM_ACK,
  STAFF_DECLINE_ACK,
  OT_PROMPT,
  OT_YES_ACK,
  OT_NO_ACK,
  INTERN_PROMPT,
  INTERN_EXTEND_ACK,
  INTERN_APPROVED,
  INTERN_DENIED,
  INTERN_TIMEOUT,
  MGR_INTERN_APPROVAL,
  MGR_APPROVAL_ACK,
  MGR_ALERT,
  HELP_REPLY,
  RESCHEDULE_REPLY,
  LATE_ACK,
  WAITLIST_OFFER,
  WAITLIST_CLAIM_ACK,
  WAITLIST_TAKEN,
  COVER_OFFER,
  COVER_ACK,
  REVIEW_REQUEST,
  REVIEW_THANKS,
  REVIEW_LOW_ACK,
  OWNER_DIGEST,
} from "./lib/smsTemplates";

function money(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/* Two-way SMS flows over the GHL number. Outbound questions open an smsPrompt;
   routeInbound() (called from sms._handleInbound) matches a reply to the
   sender's newest open prompt and applies the effect. The timeclock sweep
   (cron) asks the overtime / intern questions and enforces the caps. */

const HOUR = 3_600_000;
const MIN = 60_000;
const OT_AFTER = 8 * HOUR; // staff: confirm overtime past this
const INTERN_AFTER = 4 * HOUR; // interns: need permission past this
const REPLY_WINDOW = 45 * MIN; // how long a prompt waits for an answer
const APPROVAL_WINDOW = 60 * MIN; // how long a manager has to APPROVE/DENY
const REBOOK_HOLD = 10 * 24 * HOUR; // deposit held for rebooking after a NO

// ── Small helpers ───────────────────────────────────────────────────────

async function orgOf(ctx: QueryCtx | MutationCtx, orgId: string) {
  return await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

function studioName(org: Doc<"orgs"> | null): string {
  return org?.name ?? "the studio";
}

function bookingLink(org: Doc<"orgs"> | null): string | null {
  return org?.slug ? `${appUrl()}/book/${org.slug}` : null;
}

/** Managers (owner/manager) of an org that have a cell on file. */
async function managerPhones(ctx: QueryCtx | MutationCtx, orgId: string) {
  const members = await ctx.db
    .query("members")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return members
    .filter((m) => (m.role === "owner" || m.role === "manager") && m.phone)
    .map((m) => ({ member: m, phone: normalizePhone(m.phone!) }))
    .filter((m): m is { member: Doc<"members">; phone: string } => Boolean(m.phone));
}

async function isOptedOut(ctx: QueryCtx | MutationCtx, phone: string) {
  const row = await ctx.db
    .query("smsOptOuts")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  return row?.optedOut ?? false;
}

/** Queue an outbound SMS from a mutation (delivery happens in the action). */
function queueSend(ctx: MutationCtx, to: string, body: string) {
  void ctx.scheduler.runAfter(0, internal.smsFlows._send, { to, body });
}

async function alertManagers(ctx: MutationCtx, orgId: string, body: string) {
  const org = await orgOf(ctx, orgId);
  const text = renderSms(MGR_ALERT, { studio: studioName(org), body });
  for (const m of await managerPhones(ctx, orgId)) {
    if (!(await isOptedOut(ctx, m.phone))) queueSend(ctx, m.phone, text);
  }
}

export const _send = internalAction({
  args: { to: v.string(), body: v.string() },
  handler: async (_ctx, { to, body }) => {
    await sendSms({ to, body });
  },
});

// ── Prompt lifecycle ────────────────────────────────────────────────────

export const _openPrompt = internalMutation({
  args: {
    orgId: v.string(),
    phone: v.string(),
    kind: v.union(
      v.literal("booking_confirm"),
      v.literal("rebook_offer"),
      v.literal("staff_confirm"),
      v.literal("overtime_confirm"),
      v.literal("intern_checkin"),
      v.literal("intern_approval"),
    ),
    sessionId: v.optional(v.id("sessions")),
    entryId: v.optional(v.id("timeEntries")),
    memberId: v.optional(v.id("members")),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await openPrompt(ctx, args);
  },
});

async function openPrompt(
  ctx: MutationCtx,
  args: {
    orgId: string;
    phone: string;
    kind: Doc<"smsPrompts">["kind"];
    sessionId?: Id<"sessions">;
    entryId?: Id<"timeEntries">;
    memberId?: Id<"members">;
    artistId?: Id<"artists">;
    expiresAt: number;
  },
) {
  // One open question of a kind per phone - retire older ones so a reply is
  // never ambiguous.
  const open = await ctx.db
    .query("smsPrompts")
    .withIndex("by_phone_status", (q) => q.eq("phone", args.phone).eq("status", "open"))
    .collect();
  for (const p of open) {
    if (p.kind === args.kind) await ctx.db.patch(p._id, { status: "expired" });
  }
  await ctx.db.insert("smsPrompts", {
    orgId: args.orgId,
    phone: args.phone,
    kind: args.kind,
    sessionId: args.sessionId,
    entryId: args.entryId,
    memberId: args.memberId,
    artistId: args.artistId,
    status: "open",
    sentAt: Date.now(),
    expiresAt: args.expiresAt,
  });
}

async function answerPrompt(ctx: MutationCtx, prompt: Doc<"smsPrompts">, answer: string) {
  await ctx.db.patch(prompt._id, { status: "answered", answer, answeredAt: Date.now() });
}

/** First reply wins: once one recipient answers, retire the same offer for
 *  everyone else it went to. */
async function retireSiblingPrompts(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  kind: Doc<"smsPrompts">["kind"],
) {
  const siblings = await ctx.db
    .query("smsPrompts")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const s of siblings) {
    if (s.kind === kind && s.status === "open") await ctx.db.patch(s._id, { status: "expired" });
  }
}

/** Offer an uncovered session to the org's other engineers (first YES wins). */
async function broadcastCover(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  declinerId: Id<"members"> | null,
  org: Doc<"orgs"> | null,
) {
  const members = await ctx.db
    .query("members")
    .withIndex("by_org", (q) => q.eq("orgId", session.orgId))
    .collect();
  const candidates = members
    .filter(
      (m) =>
        (m.role === "engineer" || m.role === "assistant_engineer") &&
        m.phone &&
        m._id !== declinerId,
    )
    .slice(0, 5);
  const dateStr = dateLabel(session.startTime, orgTz(org));
  const bodyText = renderSms(COVER_OFFER, {
    studio: studioName(org),
    title: session.title,
    date: dateStr,
  });
  for (const m of candidates) {
    const phone = normalizePhone(m.phone!);
    if (!phone || (await isOptedOut(ctx, phone))) continue;
    await openPrompt(ctx, {
      orgId: session.orgId,
      phone,
      kind: "cover_offer",
      sessionId: session._id,
      memberId: m._id,
      expiresAt: session.startTime,
    });
    queueSend(ctx, phone, bodyText);
  }
}

// ── Inbound routing (called from sms._handleInbound, a mutation) ───────

/** Try to consume an inbound reply. Returns true when it answered a prompt or
 *  a standalone keyword; false hands the text back to the normal thread +
 *  receptionist path. */
export async function routeInbound(
  ctx: MutationCtx,
  phone: string,
  body: string,
): Promise<boolean> {
  const intent = parseSmsIntent(body);
  const now = Date.now();

  const open = (
    await ctx.db
      .query("smsPrompts")
      .withIndex("by_phone_status", (q) => q.eq("phone", phone).eq("status", "open"))
      .collect()
  )
    .filter((p) => p.expiresAt > now)
    .sort((a, b) => b.sentAt - a.sentAt);

  // A phone can hold several open questions of different kinds (e.g. a rebook
  // offer + an overtime check). Newest-first, first prompt whose kind accepts
  // this intent wins - so REBOOK finds the rebook offer even when a newer
  // YES/NO question is also open.
  for (const prompt of open) {
    if (await applyPromptAnswer(ctx, prompt, intent, phone, body)) return true;
  }
  return await handleStandaloneKeyword(ctx, phone, intent);
}

async function applyPromptAnswer(
  ctx: MutationCtx,
  prompt: Doc<"smsPrompts">,
  intent: ReturnType<typeof parseSmsIntent>,
  phone: string,
  body: string,
): Promise<boolean> {
  const org = await orgOf(ctx, prompt.orgId);
  const studio = studioName(org);

  if (prompt.kind === "booking_confirm") {
    const session = prompt.sessionId ? await ctx.db.get(prompt.sessionId) : null;
    if (!session) return false;
    if (intent === "yes") {
      if (session.status === "tentative") await ctx.db.patch(session._id, { status: "confirmed" });
      await answerPrompt(ctx, prompt, "yes");
      queueSend(ctx, phone, renderSms(CLIENT_CONFIRM_ACK, { title: session.title, studio }));
      return true;
    }
    if (intent === "no") {
      const holdUntil = Date.now() + REBOOK_HOLD;
      const holdDate = dateLabel(holdUntil, orgTz(org));
      await ctx.db.patch(session._id, { clientDeclinedAt: Date.now(), rebookHoldUntil: holdUntil });
      await answerPrompt(ctx, prompt, "no");
      await openPrompt(ctx, {
        orgId: prompt.orgId,
        phone,
        kind: "rebook_offer",
        sessionId: session._id,
        expiresAt: holdUntil,
      });
      queueSend(
        ctx,
        phone,
        renderSms(CLIENT_DECLINE_FOLLOWUP, { studio, holdDate, link: bookingLink(org) }),
      );
      await alertManagers(
        ctx,
        prompt.orgId,
        `client declined "${session.title}" via the pre-session confirm text. Deposit held for rebooking until ${holdDate}.`,
      );
      return true;
    }
    return false;
  }

  if (prompt.kind === "rebook_offer") {
    if (intent !== "rebook" && intent !== "yes") return false;
    const session = prompt.sessionId ? await ctx.db.get(prompt.sessionId) : null;
    const holdDate = dateLabel(session?.rebookHoldUntil ?? prompt.expiresAt, orgTz(org));
    await answerPrompt(ctx, prompt, "rebook");
    queueSend(ctx, phone, renderSms(CLIENT_REBOOK_ACK, { studio, holdDate, link: bookingLink(org) }));
    await alertManagers(ctx, prompt.orgId, `client wants to REBOOK "${session?.title ?? "a session"}" - reach out to reschedule.`);
    return true;
  }

  if (prompt.kind === "staff_confirm") {
    const session = prompt.sessionId ? await ctx.db.get(prompt.sessionId) : null;
    if (!session) return false;
    if (intent === "yes") {
      if (session.engineerRequestStatus === "pending") {
        await ctx.db.patch(session._id, { engineerRequestStatus: "confirmed" });
      }
      if (prompt.memberId) {
        const shifts = await ctx.db
          .query("shifts")
          .withIndex("by_session", (q) => q.eq("sessionId", session._id))
          .collect();
        for (const s of shifts) {
          if (s.memberId === prompt.memberId && s.status === "scheduled") {
            await ctx.db.patch(s._id, { status: "confirmed" });
          }
        }
      }
      await answerPrompt(ctx, prompt, "yes");
      queueSend(ctx, phone, renderSms(STAFF_CONFIRM_ACK, { studio }));
      return true;
    }
    if (intent === "no") {
      await answerPrompt(ctx, prompt, "no");
      const who = prompt.memberId ? (await ctx.db.get(prompt.memberId))?.name : null;
      queueSend(ctx, phone, renderSms(STAFF_DECLINE_ACK, { studio }));
      await alertManagers(
        ctx,
        prompt.orgId,
        `${who ?? "a staffer"} cannot work "${session.title}" - find cover or reassign.`,
      );
      await broadcastCover(ctx, session, prompt.memberId ?? null, org);
      return true;
    }
    return false;
  }

  if (prompt.kind === "cover_offer") {
    const session = prompt.sessionId ? await ctx.db.get(prompt.sessionId) : null;
    if (!session || !prompt.memberId) return false;
    if (intent === "yes") {
      await ctx.db.patch(session._id, {
        engineerId: prompt.memberId,
        engineerRequestStatus: "confirmed",
      });
      await answerPrompt(ctx, prompt, "yes");
      await retireSiblingPrompts(ctx, session._id, "cover_offer");
      const dateStr = dateLabel(session.startTime, orgTz(org));
      queueSend(ctx, phone, renderSms(COVER_ACK, { title: session.title, date: dateStr, studio }));
      const eng = await ctx.db.get(prompt.memberId);
      await alertManagers(ctx, prompt.orgId, `${eng?.name ?? "an engineer"} took "${session.title}" (${dateStr}).`);
      return true;
    }
    if (intent === "no") {
      await answerPrompt(ctx, prompt, "no");
      return true;
    }
    return false;
  }

  if (prompt.kind === "waitlist_claim") {
    if (intent !== "claim" && intent !== "yes") return false;
    const session = prompt.sessionId ? await ctx.db.get(prompt.sessionId) : null;
    if (!session) return false;
    await answerPrompt(ctx, prompt, "claim");
    await retireSiblingPrompts(ctx, session._id, "waitlist_claim");
    const dateStr = dateLabel(session.startTime, orgTz(org));
    queueSend(
      ctx,
      phone,
      renderSms(WAITLIST_CLAIM_ACK, { date: dateStr, studio, link: bookingLink(org) }),
    );
    const artist = prompt.artistId ? await ctx.db.get(prompt.artistId) : null;
    await alertManagers(
      ctx,
      prompt.orgId,
      `${artist?.name ?? "a waitlisted client"} CLAIMED the freed ${dateStr} slot - confirm their booking.`,
    );
    return true;
  }

  if (prompt.kind === "review_rating") {
    if (intent !== "rating") return false;
    const rating = parseRating(body);
    if (rating === null) return false;
    const session = prompt.sessionId ? await ctx.db.get(prompt.sessionId) : null;
    const artist = prompt.artistId ? await ctx.db.get(prompt.artistId) : null;
    await ctx.db.insert("reviews", {
      orgId: prompt.orgId,
      artistId: prompt.artistId,
      sessionId: prompt.sessionId,
      rating,
      authorName: artist?.name,
      // 4-5 star ratings feed the booking page's social proof; anything lower
      // stays hidden and goes straight to the owner instead.
      status: rating >= 4 ? "published" : "hidden",
      source: "sms",
      at: Date.now(),
    });
    await answerPrompt(ctx, prompt, String(rating));
    if (rating >= 4) {
      queueSend(ctx, phone, renderSms(REVIEW_THANKS, { studio }));
    } else {
      queueSend(ctx, phone, renderSms(REVIEW_LOW_ACK, {}));
      await alertManagers(
        ctx,
        prompt.orgId,
        `${artist?.name ?? "a client"} rated "${session?.title ?? "a session"}" ${rating}/5 - reach out personally.`,
      );
    }
    return true;
  }

  if (prompt.kind === "overtime_confirm") {
    const entry = prompt.entryId ? await ctx.db.get(prompt.entryId) : null;
    if (!entry || entry.status !== "active") return false;
    if (intent === "yes") {
      await ctx.db.patch(entry._id, { otStatus: "confirmed" });
      await answerPrompt(ctx, prompt, "yes");
      queueSend(ctx, phone, renderSms(OT_YES_ACK, { studio }));
      return true;
    }
    if (intent === "no") {
      await ctx.db.patch(entry._id, {
        clockOutAt: entry.clockInAt + OT_AFTER,
        status: "completed",
        otStatus: "declined",
        autoClosedReason: "ot_declined",
      });
      await answerPrompt(ctx, prompt, "no");
      queueSend(ctx, phone, renderSms(OT_NO_ACK, { studio }));
      return true;
    }
    return false;
  }

  if (prompt.kind === "intern_checkin") {
    if (intent !== "extend" && intent !== "yes") return false;
    const entry = prompt.entryId ? await ctx.db.get(prompt.entryId) : null;
    if (!entry || entry.status !== "active") return false;
    await ctx.db.patch(entry._id, { internExtension: "requested" });
    await answerPrompt(ctx, prompt, "extend");
    queueSend(ctx, phone, renderSms(INTERN_EXTEND_ACK, {}));
    const intern = prompt.memberId ? await ctx.db.get(prompt.memberId) : null;
    const mgrs = await managerPhones(ctx, prompt.orgId);
    for (const m of mgrs) {
      await openPrompt(ctx, {
        orgId: prompt.orgId,
        phone: m.phone,
        kind: "intern_approval",
        entryId: entry._id,
        memberId: prompt.memberId,
        expiresAt: Date.now() + APPROVAL_WINDOW,
      });
      queueSend(
        ctx,
        m.phone,
        renderSms(MGR_INTERN_APPROVAL, { studio, name: intern?.name ?? "an intern" }),
      );
    }
    return true;
  }

  if (prompt.kind === "intern_approval") {
    if (intent !== "approve" && intent !== "deny") return false;
    const entry = prompt.entryId ? await ctx.db.get(prompt.entryId) : null;
    const intern = prompt.memberId ? await ctx.db.get(prompt.memberId) : null;
    const internPhone = intern?.phone ? normalizePhone(intern.phone) : null;
    await answerPrompt(ctx, prompt, intent);
    // Retire the sibling approval prompts sent to the other managers.
    if (prompt.entryId) {
      const siblings = await ctx.db
        .query("smsPrompts")
        .withIndex("by_entry", (q) => q.eq("entryId", prompt.entryId))
        .collect();
      for (const s of siblings) {
        if (s.kind === "intern_approval" && s.status === "open") {
          await ctx.db.patch(s._id, { status: "expired" });
        }
      }
    }
    if (entry && entry.status === "active") {
      if (intent === "approve") {
        await ctx.db.patch(entry._id, { internExtension: "approved" });
        if (internPhone) queueSend(ctx, internPhone, renderSms(INTERN_APPROVED, { studio }));
      } else {
        await ctx.db.patch(entry._id, {
          internExtension: "denied",
          clockOutAt: Date.now(),
          status: "completed",
          autoClosedReason: "intern_denied",
        });
        if (internPhone) queueSend(ctx, internPhone, renderSms(INTERN_DENIED, { studio }));
      }
    }
    queueSend(ctx, phone, renderSms(MGR_APPROVAL_ACK, { name: intern?.name ?? "The intern" }));
    return true;
  }

  return false;
}

/** Keywords that work without an open prompt: HELP, RESCHEDULE, LATE. */
async function handleStandaloneKeyword(
  ctx: MutationCtx,
  phone: string,
  intent: ReturnType<typeof parseSmsIntent>,
): Promise<boolean> {
  if (intent !== "help" && intent !== "reschedule" && intent !== "late" && intent !== "claim")
    return false;

  // Best-effort org context: an artist or member with this cell.
  const artists = await ctx.db.query("artists").collect();
  const artist = artists.find((a) => a.phone && normalizePhone(a.phone) === phone);
  let orgId = artist?.orgId ?? null;
  let memberName: string | null = null;
  if (!orgId) {
    const members = await ctx.db.query("members").collect();
    const member = members.find((m) => m.phone && normalizePhone(m.phone) === phone);
    orgId = member?.orgId ?? null;
    memberName = member?.name ?? null;
  }
  const org = orgId ? await orgOf(ctx, orgId) : null;
  const studio = studioName(org);
  const phoneDisplay = displayPhone(org?.contact?.phone);

  if (intent === "help") {
    queueSend(ctx, phone, renderSms(HELP_REPLY, { studio, phone: phoneDisplay }));
    return true;
  }
  if (intent === "claim") {
    // CLAIM with no open offer = someone beat them to the slot.
    queueSend(ctx, phone, renderSms(WAITLIST_TAKEN, { studio, link: bookingLink(org) }));
    return true;
  }
  if (intent === "reschedule") {
    queueSend(
      ctx,
      phone,
      renderSms(RESCHEDULE_REPLY, { link: bookingLink(org), phone: phoneDisplay }),
    );
    if (orgId && artist) {
      await alertManagers(ctx, orgId, `${artist.name} texted RESCHEDULE - follow up to move their session.`);
    }
    return true;
  }
  // late
  if (orgId) {
    const who = artist?.name ?? memberName ?? "someone";
    await alertManagers(ctx, orgId, `${who} texted that they are running LATE.`);
    queueSend(ctx, phone, renderSms(LATE_ACK, { studio }));
    return true;
  }
  return false;
}

// ── Timeclock sweep (cron): overtime + intern checks, caps + escalation ──

export const _timeclockDue = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const now = Date.now();
    const org = await orgOf(ctx, orgId);
    const studio = studioName(org);
    const entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
      .collect();

    const otPrompts: { entryId: Id<"timeEntries">; memberId: Id<"members">; phone: string | null; name: string; body: string }[] = [];
    const internPrompts: typeof otPrompts = [];
    const otExpired: { entryId: Id<"timeEntries">; name: string }[] = [];
    const internTimeouts: { entryId: Id<"timeEntries">; phone: string | null; name: string }[] = [];

    for (const e of entries) {
      const member = await ctx.db.get(e.memberId);
      if (!member) continue;
      const phone = member.phone ? normalizePhone(member.phone) : null;
      const onClock = now - e.clockInAt;
      const isIntern = member.role === "intern";

      if (isIntern) {
        if (onClock >= INTERN_AFTER && !e.internPromptSentAt) {
          internPrompts.push({
            entryId: e._id,
            memberId: member._id,
            phone,
            name: member.name,
            body: renderSms(INTERN_PROMPT, { studio }),
          });
        } else if (
          e.internPromptSentAt &&
          (e.internExtension === undefined || e.internExtension === "requested")
        ) {
          // Timed out when every open prompt on the entry has lapsed.
          const prompts = await ctx.db
            .query("smsPrompts")
            .withIndex("by_entry", (q) => q.eq("entryId", e._id))
            .collect();
          const stillWaiting = prompts.some((p) => p.status === "open" && p.expiresAt > now);
          const everPrompted = prompts.length > 0;
          if (everPrompted && !stillWaiting) {
            internTimeouts.push({ entryId: e._id, phone, name: member.name });
          }
        }
      } else {
        if (onClock >= OT_AFTER && !e.otPromptSentAt) {
          otPrompts.push({
            entryId: e._id,
            memberId: member._id,
            phone,
            name: member.name,
            body: renderSms(OT_PROMPT, { studio }),
          });
        } else if (e.otPromptSentAt && !e.otStatus && now - e.otPromptSentAt > REPLY_WINDOW) {
          otExpired.push({ entryId: e._id, name: member.name });
        }
      }
    }
    return { studio, otPrompts, internPrompts, otExpired, internTimeouts };
  },
});

export const _recordTimeclockPrompt = internalMutation({
  args: {
    entryId: v.id("timeEntries"),
    memberId: v.id("members"),
    orgId: v.string(),
    kind: v.union(v.literal("overtime_confirm"), v.literal("intern_checkin")),
    phone: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { entryId, memberId, orgId, kind, phone }) => {
    const stamp =
      kind === "overtime_confirm" ? { otPromptSentAt: Date.now() } : { internPromptSentAt: Date.now() };
    await ctx.db.patch(entryId, stamp);
    if (phone) {
      await openPrompt(ctx, {
        orgId,
        phone,
        kind,
        entryId,
        memberId,
        expiresAt: Date.now() + REPLY_WINDOW,
      });
    }
  },
});

export const _markOtUnconfirmed = internalMutation({
  args: { entryId: v.id("timeEntries") },
  handler: async (ctx, { entryId }) => {
    const e = await ctx.db.get(entryId);
    if (!e || e.otStatus) return;
    await ctx.db.patch(entryId, { otStatus: "unconfirmed" });
  },
});

export const _capInternEntry = internalMutation({
  args: { entryId: v.id("timeEntries") },
  handler: async (ctx, { entryId }) => {
    const e = await ctx.db.get(entryId);
    if (!e || e.status !== "active") return;
    await ctx.db.patch(entryId, {
      clockOutAt: e.clockInAt + INTERN_AFTER,
      status: "completed",
      internExtension: "timeout",
      autoClosedReason: "intern_timeout",
    });
    // Retire whatever prompts were still open on this entry.
    const prompts = await ctx.db
      .query("smsPrompts")
      .withIndex("by_entry", (q) => q.eq("entryId", entryId))
      .collect();
    for (const p of prompts) {
      if (p.status === "open") await ctx.db.patch(p._id, { status: "expired" });
    }
  },
});

export const _managerAlertList = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const out: string[] = [];
    for (const m of await managerPhones(ctx, orgId)) {
      if (!(await isOptedOut(ctx, m.phone))) out.push(m.phone);
    }
    return out;
  },
});

// ── Lifecycle sweep (cron): waitlist backfill + post-session reviews ────

const REVIEW_MARK = "review_req";

export const _lifecycleDue = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const now = Date.now();
    const org = await orgOf(ctx, orgId);
    if (org?.smsRemindersEnabled === false) return { waitlistBlasts: [], reviewRequests: [] };
    const studio = studioName(org);
    const tz = orgTz(org);

    // Freed future slots not yet offered: cancelled or client-declined.
    const upcoming = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gt("startTime", now))
      .collect();
    const waitlistBlasts: {
      sessionId: Id<"sessions">;
      offers: { phone: string; artistId: Id<"artists">; entryId: Id<"waitlistEntries">; body: string }[];
    }[] = [];
    const freed = upcoming.filter(
      (s) => !s.waitlistBlastAt && (s.status === "cancelled" || s.clientDeclinedAt),
    );
    if (freed.length > 0) {
      const entries = (
        await ctx.db
          .query("waitlistEntries")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).filter((e) => e.status === "waiting" || e.status === "notified");
      for (const s of freed) {
        const dateStr = dateLabel(s.startTime, tz);
        const room = s.roomId ? await ctx.db.get(s.roomId) : null;
        const matches = entries
          .filter(
            (e) =>
              e.artistId !== s.artistId &&
              (!e.roomId || e.roomId === s.roomId) &&
              (e.preferredFrom == null || s.startTime >= e.preferredFrom) &&
              (e.preferredTo == null || s.startTime <= e.preferredTo) &&
              (!e.lastNotifiedAt || now - e.lastNotifiedAt > 24 * HOUR),
          )
          .sort(
            (a, b) =>
              (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) ||
              a.createdAt - b.createdAt,
          )
          .slice(0, 5);
        const offers = [];
        for (const e of matches) {
          const artist = await ctx.db.get(e.artistId);
          const phone = artist?.phone ? normalizePhone(artist.phone) : null;
          if (!phone || (await isOptedOut(ctx, phone))) continue;
          offers.push({
            phone,
            artistId: e.artistId,
            entryId: e._id,
            body: renderSms(WAITLIST_OFFER, { studio, date: dateStr, room: room?.name ?? null }),
          });
        }
        waitlistBlasts.push({ sessionId: s._id, offers });
      }
    }

    // Completed sessions from the last day that haven't been asked for a review.
    const recent = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gt("startTime", now - 48 * HOUR))
      .collect();
    const reviewRequests: {
      sessionId: Id<"sessions">;
      artistId: Id<"artists">;
      phone: string;
      body: string;
    }[] = [];
    for (const s of recent) {
      if (s.status !== "completed") continue;
      if (s.endTime > now - HOUR || s.endTime < now - 24 * HOUR) continue;
      if ((s.smsRemindersSent ?? []).includes(REVIEW_MARK)) continue;
      const artist = await ctx.db.get(s.artistId);
      const phone = artist?.phone ? normalizePhone(artist.phone) : null;
      if (!phone || (await isOptedOut(ctx, phone))) continue;
      reviewRequests.push({
        sessionId: s._id,
        artistId: s.artistId,
        phone,
        body: renderSms(REVIEW_REQUEST, { studio }),
      });
    }
    return { waitlistBlasts, reviewRequests };
  },
});

export const _recordWaitlistBlast = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    offers: v.array(
      v.object({
        phone: v.string(),
        artistId: v.id("artists"),
        entryId: v.id("waitlistEntries"),
      }),
    ),
  },
  handler: async (ctx, { sessionId, offers }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return;
    await ctx.db.patch(sessionId, { waitlistBlastAt: Date.now() });
    for (const o of offers) {
      await ctx.db.patch(o.entryId, { status: "notified", lastNotifiedAt: Date.now() });
      await openPrompt(ctx, {
        orgId: s.orgId,
        phone: o.phone,
        kind: "waitlist_claim",
        sessionId,
        artistId: o.artistId,
        expiresAt: s.startTime,
      });
    }
  },
});

export const _recordReviewRequest = internalMutation({
  args: { sessionId: v.id("sessions"), artistId: v.id("artists"), phone: v.string() },
  handler: async (ctx, { sessionId, artistId, phone }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return;
    await ctx.db.patch(sessionId, {
      smsRemindersSent: [...(s.smsRemindersSent ?? []), REVIEW_MARK],
    });
    await openPrompt(ctx, {
      orgId: s.orgId,
      phone,
      kind: "review_rating",
      sessionId,
      artistId,
      expiresAt: Date.now() + 7 * 24 * HOUR,
    });
  },
});

/** Cron: every 15 min - offer freed slots to the waitlist and ask yesterday's
 *  completed sessions for a 1-5 rating. */
export const sweepLifecycle = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of orgIds) {
      const due = await ctx.runQuery(internal.smsFlows._lifecycleDue, { orgId });
      for (const blast of due.waitlistBlasts) {
        for (const o of blast.offers) await sendSms({ to: o.phone, body: o.body });
        await ctx.runMutation(internal.smsFlows._recordWaitlistBlast, {
          sessionId: blast.sessionId,
          offers: blast.offers.map(({ phone, artistId, entryId }) => ({ phone, artistId, entryId })),
        });
      }
      for (const r of due.reviewRequests) {
        await sendSms({ to: r.phone, body: r.body });
        await ctx.runMutation(internal.smsFlows._recordReviewRequest, {
          sessionId: r.sessionId,
          artistId: r.artistId,
          phone: r.phone,
        });
      }
    }
  },
});

// ── Owner daily digest (cron, hourly; sends at 8am org-local) ───────────

export const _digestDue = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await orgOf(ctx, orgId);
    if (!org || org.smsRemindersEnabled === false) return null;
    const tz = orgTz(org);
    const now = new Date();
    const hour = Number(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(now),
    );
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // YYYY-MM-DD
    if (hour !== 8 || org.smsDigestLastSent === today) return null;

    const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    const sessions = (
      await ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gt("startTime", Date.now() - 18 * HOUR),
        )
        .collect()
    ).filter(
      (s) =>
        dayFmt.format(new Date(s.startTime)) === today &&
        s.status !== "cancelled" &&
        s.status !== "no_show",
    );
    const flags = (
      await ctx.db
        .query("timeEntries")
        .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "active"))
        .collect()
    ).filter((e) => e.otStatus === "unconfirmed").length;
    if (sessions.length === 0 && flags === 0) {
      return { skip: true as const, today, phones: [] as string[], body: "" };
    }

    const unconfirmed = sessions.filter((s) => s.status === "tentative").length;
    const revenue = money(sessions.reduce((sum, s) => sum + s.rateCents, 0));
    const flagBits = [
      unconfirmed > 0 ? `${unconfirmed} unconfirmed` : null,
      flags > 0 ? `${flags} payroll flag(s)` : null,
    ].filter(Boolean);
    const body = renderSms(OWNER_DIGEST, {
      studio: studioName(org),
      sessions: String(sessions.length),
      revenue,
      flags: flagBits.length > 0 ? `, ${flagBits.join(", ")}` : "",
    });
    const phones: string[] = [];
    for (const m of await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()) {
      if (m.role !== "owner" || !m.phone) continue;
      const p = normalizePhone(m.phone);
      if (p && !(await isOptedOut(ctx, p))) phones.push(p);
    }
    return { skip: false as const, today, phones, body };
  },
});

export const _markDigestSent = internalMutation({
  args: { orgId: v.string(), today: v.string() },
  handler: async (ctx, { orgId, today }) => {
    const org = await orgOf(ctx, orgId);
    if (org) await ctx.db.patch(org._id, { smsDigestLastSent: today });
  },
});

/** Cron: hourly - one 8am (org-local) owner text on days with activity. */
export const sweepDailyDigest = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of orgIds) {
      const due = await ctx.runQuery(internal.smsFlows._digestDue, { orgId });
      if (!due) continue;
      if (!due.skip) for (const p of due.phones) await sendSms({ to: p, body: due.body });
      await ctx.runMutation(internal.smsFlows._markDigestSent, { orgId, today: due.today });
    }
  },
});

/** Cron: every 15 min, ask the 8h overtime / 4h intern questions and enforce
 *  the no-answer caps. */
export const sweepTimeclock = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of orgIds) {
      const due = await ctx.runQuery(internal.smsFlows._timeclockDue, { orgId });
      const managers: string[] =
        due.otPrompts.some((p) => !p.phone) ||
        due.internPrompts.some((p) => !p.phone) ||
        due.otExpired.length > 0 ||
        due.internTimeouts.length > 0
          ? await ctx.runQuery(internal.smsFlows._managerAlertList, { orgId })
          : [];

      for (const p of [...due.otPrompts, ...due.internPrompts]) {
        const kind = due.otPrompts.includes(p) ? "overtime_confirm" : "intern_checkin";
        if (p.phone) await sendSms({ to: p.phone, body: p.body });
        await ctx.runMutation(internal.smsFlows._recordTimeclockPrompt, {
          entryId: p.entryId,
          memberId: p.memberId,
          orgId,
          kind,
          phone: p.phone,
        });
        if (!p.phone) {
          for (const m of managers) {
            await sendSms({
              to: m,
              body: renderSms(MGR_ALERT, {
                studio: due.studio,
                body: `${p.name} hit the ${kind === "overtime_confirm" ? "8-hour overtime" : "4-hour intern"} check but has no cell on file - please follow up in person.`,
              }),
            });
          }
        }
      }

      for (const e of due.otExpired) {
        await ctx.runMutation(internal.smsFlows._markOtUnconfirmed, { entryId: e.entryId });
        for (const m of managers) {
          await sendSms({
            to: m,
            body: renderSms(MGR_ALERT, {
              studio: due.studio,
              body: `${e.name} passed 8 hours and did not answer the overtime text - entry flagged for payroll review.`,
            }),
          });
        }
      }

      for (const t of due.internTimeouts) {
        await ctx.runMutation(internal.smsFlows._capInternEntry, { entryId: t.entryId });
        if (t.phone) await sendSms({ to: t.phone, body: renderSms(INTERN_TIMEOUT, { studio: due.studio }) });
        for (const m of managers) {
          await sendSms({
            to: m,
            body: renderSms(MGR_ALERT, {
              studio: due.studio,
              body: `intern ${t.name} hit 4 hours without an approval - clocked out and capped at 4 hours.`,
            }),
          });
        }
      }
    }
  },
});
