/* ============================================================
   Fill-the-gap deal texts (openspec/changes/off-peak-and-google-reviews).

   Every morning at 9am studio time, for each studio that turned deal texts
   on: find tomorrow's longest free block (3+ hours) across its rooms, ask
   the Pulse agent (TypeSafe Jev, one Choice: send or skip) whether it is
   worth a text, then
     - Approve each (default): the draft waits in the inbox,
     - Auto: a confident "send" goes out on its own.
   Sending re-checks everything at send time: consent, STOP, the 8-day cap,
   the 10am-7pm window and whether the block got booked meanwhile.
   ============================================================ */
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { sendSms } from "./lib/sms";
import { normalizePhone } from "./lib/phone";
import { renderSms, GAP_DEAL } from "./lib/smsTemplates";
import { appUrl } from "./lib/links";
import { orgTz, clockTime, dateLabel, localDayKey } from "./lib/tz";
import { localMidnight } from "./lib/roomBlockRange";
import { roomBusyIntervals, sessionHoldsSlot } from "./lib/roomBusy";
import { freeBlocks, padSessions, MIN_GAP_MS, type Interval } from "./lib/gaps";
import { localWeekdayHour, offPeakPctAt } from "./lib/offPeak";
import { canGetDealText, dealsEnabled, dealsMode, decideGapDeal, nextSendTime } from "./lib/deals";
import { askChoice } from "./lib/typesafe";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPEN_HOUR = 9; // booking.ts open hours
const CLOSE_HOUR = 22;
const SWEEP_HOUR = 9; // studio time
const MAX_RECIPIENTS = 100;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dedupeKey(roomId: string, dayKey: string) {
  return `gap_deal:${roomId}:${dayKey}`;
}

async function isOptedOut(ctx: QueryCtx | MutationCtx, phone: string) {
  const row = await ctx.db
    .query("smsOptOuts")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
  return row?.optedOut ?? false;
}

/** Was this gap ever proposed (any status)? One proposal per room per day. */
async function everProposed(ctx: QueryCtx | MutationCtx, orgId: string, key: string) {
  const row = await ctx.db
    .query("opsActions")
    .withIndex("by_org_dedupe", (q) => q.eq("orgId", orgId).eq("dedupeKey", key))
    .first();
  return row !== null;
}

/** Share of open hours booked in this room on the same weekday, last 4 weeks. */
async function sameWeekdayFillRate(ctx: QueryCtx, orgId: string, roomId: Id<"rooms">, open: Interval): Promise<number> {
  const from = open.start - 28 * DAY;
  const sessions = (
    await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from - DAY).lt("startTime", open.start))
      .collect()
  ).filter((s) => s.roomId === roomId && sessionHoldsSlot(s));
  let booked = 0;
  for (let k = 1; k <= 4; k++) {
    const ws = open.start - k * 7 * DAY;
    const we = open.end - k * 7 * DAY;
    for (const s of sessions) booked += Math.max(0, Math.min(s.endTime, we) - Math.max(s.startTime, ws));
  }
  return booked / (4 * (open.end - open.start));
}

/** Tomorrow's best gap for one studio, or null when there is nothing to do. */
export const _pick = internalQuery({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org || !dealsEnabled(org)) return null;
    const tz = orgTz(org);
    if (localWeekdayHour(now, tz).hour !== SWEEP_HOUR) return null;

    const [y, m, d] = localDayKey(now, tz).split("-").map(Number);
    const midnight = localMidnight(y, m, d + 1, tz);
    const open = { start: midnight + OPEN_HOUR * HOUR, end: midnight + CLOSE_HOUR * HOUR };
    const dayKey = localDayKey(open.start, tz);

    const rooms = (await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()).filter((r) => r.status !== "retired" && r.bookable !== false);

    let best: { room: Doc<"rooms">; gap: Interval } | null = null;
    for (const room of rooms) {
      if (await everProposed(ctx, orgId, dedupeKey(room._id, dayKey))) continue;
      const busy = await roomBusyIntervals(ctx, { orgId, roomId: room._id, from: open.start - HOUR, to: open.end + HOUR });
      for (const gap of freeBlocks(padSessions(busy), open, MIN_GAP_MS)) {
        if (!best || gap.end - gap.start > best.gap.end - best.gap.start) best = { room, gap };
      }
    }
    if (!best) return null;
    const { room, gap } = best;

    // Clients who said yes to deal texts, can get one now, and never sent
    // STOP. Regulars of this room first; everyone opted in otherwise.
    const artists = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const eligible: Doc<"artists">[] = [];
    for (const a of artists) {
      const phone = a.phone ? normalizePhone(a.phone) : null;
      if (!phone || !canGetDealText(a, now)) continue;
      if (await isOptedOut(ctx, phone)) continue;
      eligible.push(a);
    }
    if (eligible.length === 0) return null;
    const regulars = new Set(
      (
        await ctx.db
          .query("sessions")
          .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", now - 365 * DAY))
          .collect()
      )
        .filter((s) => s.roomId === room._id)
        .map((s) => s.artistId),
    );
    const ofRoom = eligible.filter((a) => regulars.has(a._id));
    const recipients = (ofRoom.length > 0 ? ofRoom : eligible).slice(0, MAX_RECIPIENTS);

    const pct = org.offPeakEnabled
      ? Math.max(
          0,
          ...Array.from({ length: Math.ceil((gap.end - gap.start) / HOUR) }, (_, i) =>
            offPeakPctAt(room.offPeakWindows, gap.start + i * HOUR, tz),
          ),
        )
      : 0;
    const when = `${dateLabel(gap.start, tz)} ${clockTime(gap.start, tz)}-${clockTime(gap.end, tz)}`;
    const body = `${room.name} has open time ${when}.${pct > 0 ? ` Off-peak hours are ${pct}% off.` : ""}`;
    const fillRate = await sameWeekdayFillRate(ctx, orgId, room._id, open);
    const hours = Math.round(((gap.end - gap.start) / HOUR) * 10) / 10;

    return {
      orgId,
      mode: dealsMode(org),
      roomId: room._id,
      roomName: room.name,
      gapStart: gap.start,
      gapEnd: gap.end,
      dayKey,
      when,
      body,
      artistIds: recipients.map((a) => a._id),
      state: {
        open_block: {
          room: room.name,
          day: WEEKDAYS[localWeekdayHour(gap.start, tz).weekday],
          starts: clockTime(gap.start, tz),
          ends: clockTime(gap.end, tz),
          hours,
        },
        pricing: {
          room_rate_per_hour: room.hourlyRateCents ? `$${Math.round(room.hourlyRateCents / 100)}` : "not set",
          off_peak_discount: pct > 0 ? `${pct}% off` : "none",
        },
        audience: {
          clients_who_can_be_texted: recipients.length,
          have_booked_this_room_before: ofRoom.length > 0,
        },
        history: {
          share_of_open_hours_booked_on_this_weekday_last_4_weeks: `${Math.round(fillRate * 100)}%`,
          days_since_this_studio_last_sent_a_deal_text: org.lastDealTextAt
            ? Math.floor((now - org.lastDealTextAt) / DAY)
            : "never",
        },
      },
    };
  },
});

/** Record the agent's pick: an inbox card, or (Auto) an approved action
 *  that executes right away. */
export const _propose = internalMutation({
  args: {
    orgId: v.string(),
    roomId: v.id("rooms"),
    roomName: v.string(),
    gapStart: v.number(),
    gapEnd: v.number(),
    dayKey: v.string(),
    when: v.string(),
    body: v.string(),
    artistIds: v.array(v.id("artists")),
    auto: v.boolean(),
    verdict: v.optional(v.object({ choice: v.string(), confidence: v.number() })),
  },
  handler: async (ctx, a) => {
    const key = dedupeKey(a.roomId, a.dayKey);
    if (await everProposed(ctx, a.orgId, key)) return null;
    const n = a.artistIds.length;
    const verdict = a.verdict
      ? `Pulse agent says ${a.verdict.choice} (${Math.round(a.verdict.confidence * 100)}% sure).`
      : "The Pulse agent was not reachable, so this one is yours to call.";
    const now = Date.now();
    const id = await ctx.db.insert("opsActions", {
      orgId: a.orgId,
      type: "gap_deal_text",
      priority: "medium",
      title: `Text ${n} client${n === 1 ? "" : "s"} about open time in ${a.roomName}`,
      rationale: `${a.when} is open. ${verdict} Only clients who opted in to deal texts get it, at most once every 8 days.`,
      entityType: "room",
      entityId: a.roomId,
      confidence: a.verdict?.confidence,
      payload: {
        kind: "sms_blast",
        roomId: a.roomId,
        gapStart: a.gapStart,
        gapEnd: a.gapEnd,
        body: a.body,
        artistIds: a.artistIds,
      },
      status: a.auto ? "approved" : "proposed",
      autonomy: a.auto,
      source: "rule",
      model: a.verdict ? "jev-latest" : undefined,
      dedupeKey: key,
      ...(a.auto ? { decidedBy: "Pulse agent", decidedAt: now } : {}),
      createdAt: now,
    });
    if (a.auto) await ctx.scheduler.runAfter(0, internal.opsActions.execute, { id });
    return id;
  },
});

/** Hourly cron. Acts only for studios where it is 9am now. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const orgIds: string[] = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    const now = Date.now();
    for (const orgId of orgIds) {
      const pick = await ctx.runQuery(internal.gapDeals._pick, { orgId, now });
      if (!pick) continue;
      const answer = await askChoice({
        state: pick.state,
        instructions:
          "A recording studio has a block of open time tomorrow. Should it text its opted-in clients about it? " +
          "Each client gets at most four deal texts a month, so a text is worth sending only when the block " +
          "will likely stay empty without a nudge and enough clients can be reached to have a fair chance of filling it.",
        criteria: {
          send: "The block is long, this weekday usually has free hours, enough clients can be reached, and no deal text went out in the last few days.",
          skip: "This weekday usually fills on its own, very few clients can be reached, a deal text went out in the last few days, or the block is not worth a client's attention.",
        },
      });
      const decision = decideGapDeal(answer, pick.mode);
      if (decision === "drop") continue;
      await ctx.runMutation(internal.gapDeals._propose, {
        orgId: pick.orgId,
        roomId: pick.roomId,
        roomName: pick.roomName,
        gapStart: pick.gapStart,
        gapEnd: pick.gapEnd,
        dayKey: pick.dayKey,
        when: pick.when,
        body: pick.body,
        artistIds: pick.artistIds,
        auto: decision === "auto",
        verdict: answer ? { choice: answer.choice, confidence: answer.confidence } : undefined,
      });
    }
  },
});

/** Send one deal text and log it to the client's thread. */
export const _deliver = internalAction({
  args: { artistId: v.id("artists"), phone: v.string(), text: v.string() },
  handler: async (ctx, { artistId, phone, text }) => {
    const status = await sendSms({ to: phone, body: text });
    await ctx.runMutation(internal.sms._logSms, { artistId, direction: "out", body: text, status, sentBy: "Pulse agent" });
  },
});

/**
 * Execute an approved gap_deal_text (called from opsActions.finalize).
 * Returns the result line, or `retryAt` when it is outside 10am-7pm studio
 * time and should run again then.
 */
export async function deliverGapDeal(
  ctx: MutationCtx,
  action: Doc<"opsActions">,
  p: Extract<Doc<"opsActions">["payload"], { kind: "sms_blast" }>,
): Promise<{ result: string } | { retryAt: number }> {
  const now = Date.now();
  if (now >= p.gapStart - HOUR) return { result: "Not sent: the open time has passed" };
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", action.orgId))
    .first();
  if (!org || !dealsEnabled(org)) return { result: "Not sent: deal texts are turned off" };
  const tz = orgTz(org);
  const at = nextSendTime(now, (ts) => localWeekdayHour(ts, tz).hour);
  if (at > now) {
    if (at >= p.gapStart - HOUR) return { result: "Not sent: no send window before the open time" };
    return { retryAt: at };
  }
  const busy = await roomBusyIntervals(ctx, {
    orgId: action.orgId,
    roomId: p.roomId,
    from: p.gapStart - HOUR,
    to: p.gapEnd + HOUR,
  });
  if (freeBlocks(padSessions(busy), { start: p.gapStart, end: p.gapEnd }, MIN_GAP_MS).length === 0) {
    return { result: "Not sent: the time got booked" };
  }

  const text = renderSms(GAP_DEAL, {
    studio: org.name ?? "the studio",
    body: p.body,
    link: org.slug ? `${appUrl()}/book/${org.slug}` : null,
  });
  let sent = 0;
  for (const artistId of p.artistIds) {
    const artist = await ctx.db.get(artistId);
    if (!artist || artist.orgId !== action.orgId || !canGetDealText(artist, now)) continue;
    const phone = normalizePhone(artist.phone!);
    if (!phone || (await isOptedOut(ctx, phone))) continue;
    await ctx.db.patch(artistId, { lastDealTextAt: now });
    await ctx.scheduler.runAfter(0, internal.gapDeals._deliver, { artistId, phone, text });
    sent++;
  }
  if (sent > 0) await ctx.db.patch(org._id, { lastDealTextAt: now });
  return { result: sent > 0 ? `Deal text sent to ${sent} client${sent === 1 ? "" : "s"}` : "Not sent: no client could get it" };
}
