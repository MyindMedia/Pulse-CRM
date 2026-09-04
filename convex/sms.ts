import { action, query, internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { orgTz, dateLabel } from "./lib/tz";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";
import { sendSms, type SmsStatus } from "./lib/sms";
import { normalizePhone } from "./lib/phone";
import {
  renderSms,
  displayPhone,
  CLIENT_REMINDER,
  CLIENT_CONFIRM_2H,
  STAFF_REMINDER,
  STAFF_CONFIRM_2H,
  MANUAL_CLIENT,
} from "./lib/smsTemplates";
import { routeInbound } from "./smsFlows";
import { parseSmsIntent } from "./lib/smsKeywords";

/* SMS: automated session reminders (cron), manual studio→client texts, and
   inbound replies + STOP/START opt-out handling (A2P 10DLC compliance).
   Outbound runs in "simulated" mode until a provider is configured. */

const TWO_HOURS = 2 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// ── Opt-out (compliance) ────────────────────────────────────────────────

export const _isOptedOut = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const row = await ctx.db
      .query("smsOptOuts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    return row?.optedOut ?? false;
  },
});

export const _recordOptOut = internalMutation({
  args: { phone: v.string(), optedOut: v.boolean() },
  handler: async (ctx, { phone, optedOut }) => {
    const existing = await ctx.db
      .query("smsOptOuts")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .first();
    if (existing) await ctx.db.patch(existing._id, { optedOut, updatedAt: Date.now() });
    else await ctx.db.insert("smsOptOuts", { phone, optedOut, updatedAt: Date.now() });
  },
});

// ── Manual studio → client text ─────────────────────────────────────────

export const _smsContext = internalQuery({
  args: { artistId: v.id("artists") },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== orgId) throw new ConvexError("Client not found.");
    await requireCapability(ctx, "artists.edit", { orgId });
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      orgId,
      phone: artist.phone ? normalizePhone(artist.phone) : null,
      studioName: org?.name ?? "Studio",
    };
  },
});

export const _logSms = internalMutation({
  args: {
    artistId: v.id("artists"),
    direction: v.union(v.literal("out"), v.literal("in")),
    body: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated"), v.literal("received")),
    sentBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const artist = await ctx.db.get(args.artistId);
    if (!artist) return;
    await ctx.db.insert("clientMessages", {
      orgId: artist.orgId,
      artistId: args.artistId,
      direction: args.direction,
      subject: "Text message",
      body: args.body,
      channel: "sms",
      status: args.status,
      sentBy: args.sentBy,
    });
  },
});

/** Send an SMS to a client (artist) and log it to their thread. */
export const sendClientSms = action({
  args: { artistId: v.id("artists"), body: v.string() },
  handler: async (ctx, { artistId, body }): Promise<{ ok: boolean; status: SmsStatus | "opted_out" }> => {
    const c = await ctx.runQuery(internal.sms._smsContext, { artistId });
    if (!c.phone) throw new ConvexError("This client has no cell phone on file.");

    if (await ctx.runQuery(internal.sms._isOptedOut, { phone: c.phone })) {
      return { ok: false, status: "opted_out" };
    }
    const text = renderSms(MANUAL_CLIENT, { studio: c.studioName, body });
    const status = await sendSms({ to: c.phone, body: text });
    const identity = await ctx.auth.getUserIdentity();
    await ctx.runMutation(internal.sms._logSms, {
      artistId,
      direction: "out",
      body,
      status,
      sentBy: identity?.subject,
    });
    return { ok: status !== "failed", status };
  },
});

// ── Settings: the per-studio reminders toggle ───────────────────────────

export const remindersStatus = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      enabled: org?.smsRemindersEnabled !== false, // default on when unset
      providerConfigured: Boolean(
        process.env.TWILIO_ACCOUNT_SID || process.env.TELNYX_API_KEY || process.env.LOOPMESSAGE_API_KEY,
      ),
    };
  },
});

export const setRemindersEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) throw new ConvexError("No studio.");
    await ctx.db.patch(org._id, { smsRemindersEnabled: enabled });
  },
});

// ── Automated session reminders (cron) ──────────────────────────────────

/** Reminders due for one org's upcoming sessions, recipients pre-filtered for
 *  opt-outs. Returns at most one kind ("24h"|"2h") per session per tick. */
export const _dueReminders = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org || org.smsRemindersEnabled === false) return [];
    const studio = org.name ?? "Studio";
    // The studio's own callback number from the onboarding wizard - clients
    // should reach the studio, never the shared 10DLC sender.
    const studioPhone = displayPhone(org.contact?.phone);
    const now = Date.now();

    const upcoming = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gt("startTime", now).lt("startTime", now + DAY + TWO_HOURS),
      )
      .collect();

    const out: {
      sessionId: Id<"sessions">;
      kind: "24h" | "2h";
      artistId: Id<"artists">;
      startTime: number;
      recipients: {
        phone: string;
        body: string;
        isClient: boolean;
        // At 2h the reminder is a YES/NO question - the sender opens a prompt
        // so the reply router can apply the answer.
        promptKind?: "booking_confirm" | "staff_confirm";
        memberId?: Id<"members">;
      }[];
    }[] = [];

    for (const s of upcoming) {
      if (s.status !== "tentative" && s.status !== "confirmed") continue;
      const sent = s.smsRemindersSent ?? [];
      const ms = s.startTime - now;
      let kind: "24h" | "2h" | null = null;
      if (ms <= TWO_HOURS && !sent.includes("2h")) kind = "2h";
      else if (ms <= DAY && ms > TWO_HOURS && !sent.includes("24h")) kind = "24h";
      if (!kind) continue;

      const dateStr = dateLabel(s.startTime, orgTz(org));
      const soon = kind === "2h" ? "in about 2 hours" : "in about a day";

      const artist = await ctx.db.get(s.artistId);
      const recipients: (typeof out)[number]["recipients"] = [];

      const clientPhone = artist?.phone ? normalizePhone(artist.phone) : null;
      if (clientPhone) {
        recipients.push({
          phone: clientPhone,
          isClient: true,
          promptKind: kind === "2h" ? ("booking_confirm" as const) : undefined,
          body: renderSms(kind === "2h" ? CLIENT_CONFIRM_2H : CLIENT_REMINDER, {
            studio,
            title: s.title,
            soon,
            date: dateStr,
            phone: studioPhone,
          }),
        });
      }
      if (s.engineerId) {
        const eng = await ctx.db.get(s.engineerId);
        const engPhone = eng?.phone ? normalizePhone(eng.phone) : null;
        if (engPhone) {
          recipients.push({
            phone: engPhone,
            isClient: false,
            promptKind: kind === "2h" ? ("staff_confirm" as const) : undefined,
            memberId: s.engineerId,
            body: renderSms(kind === "2h" ? STAFF_CONFIRM_2H : STAFF_REMINDER, {
              studio,
              title: s.title,
              soon,
              date: dateStr,
            }),
          });
        }
      }

      // Drop opted-out numbers.
      const filtered: typeof recipients = [];
      for (const r of recipients) {
        const off = await ctx.db
          .query("smsOptOuts")
          .withIndex("by_phone", (q) => q.eq("phone", r.phone))
          .first();
        if (!off?.optedOut) filtered.push(r);
      }
      if (filtered.length === 0) {
        // Nothing to send, but still mark so we don't re-scan this session forever.
        out.push({ sessionId: s._id, kind, artistId: s.artistId, startTime: s.startTime, recipients: [] });
        continue;
      }
      out.push({ sessionId: s._id, kind, artistId: s.artistId, startTime: s.startTime, recipients: filtered });
    }
    return out;
  },
});

export const _markReminderSent = internalMutation({
  args: { sessionId: v.id("sessions"), kind: v.string() },
  handler: async (ctx, { sessionId, kind }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return;
    const sent = s.smsRemindersSent ?? [];
    if (!sent.includes(kind)) await ctx.db.patch(sessionId, { smsRemindersSent: [...sent, kind] });
  },
});

/** Cron entry: scan every active org for due reminders and send them. */
export const sendDueReminders = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of orgIds) {
      const due = await ctx.runQuery(internal.sms._dueReminders, { orgId });
      for (const item of due) {
        for (const r of item.recipients) {
          const status = await sendSms({ to: r.phone, body: r.body });
          if (r.isClient) {
            await ctx.runMutation(internal.sms._logSms, {
              artistId: item.artistId,
              direction: "out",
              body: r.body,
              status,
            });
          }
          // The 2h text asks a YES/NO question - open the prompt the reply
          // router resolves against. Late answers stay useful for 2h past start.
          if (r.promptKind && status !== "failed") {
            await ctx.runMutation(internal.smsFlows._openPrompt, {
              orgId,
              phone: r.phone,
              kind: r.promptKind,
              sessionId: item.sessionId,
              memberId: r.memberId,
              expiresAt: item.startTime + TWO_HOURS,
            });
          }
        }
        await ctx.runMutation(internal.sms._markReminderSent, { sessionId: item.sessionId, kind: item.kind });
      }
    }
  },
});

/** Internal: fire a one-off SMS/iMessage for connectivity testing. Run via
 *  `npx convex run sms:_testSend '{"to":"+1...","body":"..."}'`. Not exposed
 *  to clients. Returns the provider status. */
export const _testSend = internalAction({
  args: { to: v.string(), body: v.string() },
  handler: async (_ctx, { to, body }): Promise<{ status: SmsStatus }> => {
    const status = await sendSms({ to, body });
    return { status };
  },
});

// ── Inbound (replies + STOP/START) ──────────────────────────────────────

/** Handle an inbound SMS: honor STOP/START keywords, then let the two-way flow
 *  router try to consume the reply (booking confirms, overtime, intern
 *  approvals, HELP/RESCHEDULE/LATE), else log it to the matching client's
 *  thread (best-effort phone match across artists). */
export const _handleInbound = internalMutation({
  args: { from: v.string(), body: v.string() },
  handler: async (ctx, { from, body }) => {
    const phone = normalizePhone(from);
    if (!phone) return;
    const intent = parseSmsIntent(body);

    if (intent === "stop") {
      const existing = await ctx.db.query("smsOptOuts").withIndex("by_phone", (q) => q.eq("phone", phone)).first();
      if (existing) await ctx.db.patch(existing._id, { optedOut: true, updatedAt: Date.now() });
      else await ctx.db.insert("smsOptOuts", { phone, optedOut: true, updatedAt: Date.now() });
      return;
    }
    if (intent === "start") {
      const existing = await ctx.db.query("smsOptOuts").withIndex("by_phone", (q) => q.eq("phone", phone)).first();
      if (existing) await ctx.db.patch(existing._id, { optedOut: false, updatedAt: Date.now() });
      return;
    }

    // Two-way flows: YES/NO/EXTEND/APPROVE/... against the sender's open
    // prompt, plus the standalone HELP/RESCHEDULE/LATE keywords.
    const consumed = await routeInbound(ctx, phone, body);

    // Best-effort: route the reply into the thread of an artist with this phone.
    const artists = await ctx.db.query("artists").collect();
    const match = artists.find((a) => a.phone && normalizePhone(a.phone) === phone);
    if (match) {
      const clientMessageId = await ctx.db.insert("clientMessages", {
        orgId: match.orgId,
        artistId: match._id,
        direction: "in",
        subject: "Text message",
        body,
        channel: "sms",
        status: "received",
      });

      // AI receptionist (opt-in, Tier 4): when the studio has enabled it, hand
      // the inbound off to an action that may auto-reply with the booking link.
      // We only SCHEDULE it here (this is a mutation - no LLM/HTTP inline), and
      // all opt-out/recording behavior above stays intact + unconditional.
      // Skipped when a flow already consumed the reply - one answer, one voice.
      const org = await ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", match.orgId))
        .first();
      if (!consumed && org?.aiReceptionistEnabled === true) {
        await ctx.scheduler.runAfter(0, internal.receptionist.handle, {
          orgId: match.orgId,
          from,
          body,
          clientMessageId,
          artistId: match._id,
        });
      }
    }
  },
});
