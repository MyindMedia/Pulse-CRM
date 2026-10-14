import { action, query, internalAction, internalQuery, type ActionCtx, type QueryCtx, type MutationCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOrg } from "./lib/tenant";
import { currentMemberId } from "./sessions";
import {
  googleConfigured,
  googleAuthUrl,
  googleCalendarList,
  googleCalendarListEvents,
  googleCalendarUpsertEvent,
  googleCalendarDeleteEvent,
  GoogleSyncTokenExpired,
  GoogleScopeMissing,
  isInvalidGrant,
  PULSE_ORIGIN_TAG,
  RECONNECT_REQUIRED,
  type GoogleCalendarEventBody,
  type GoogleCalendarListEvent,
} from "./lib/google";
import { pulseEventId, sessionToCalendarEvent } from "./googleCalendar";
import { parseGoogleTime } from "./googleCalendarSync";

/* ============================================================
   Team members' personal Google calendars (the second level of
   Google sync; the studio calendar is googleCalendar.ts).

   - Each member connects their own Google account from their
     schedule page (same OAuth app, callback tells the levels apart
     by the state row), picks a calendar and a direction.
   - Push: the sessions they engineer and the shifts they are
     scheduled for appear on their calendar, one event per item under
     a deterministic id so a repeat push updates instead of duplicating.
   - Pull: a cron reads their calendar into memberBusyBlocks. Only
     start and end are kept, never a title, so other staff see "Busy".
   - Pulse-origin events carry the same tag as the studio level and
     are skipped on the way in, so nothing loops.
   ============================================================ */

const FULL_PULL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const directionV = v.union(v.literal("two_way"), v.literal("push"), v.literal("pull"), v.literal("off"));

type Cal = Doc<"memberCalendars">;

export function memberPulls(cal: Cal | null | undefined): boolean {
  return Boolean(cal?.refreshToken) && (cal!.syncDirection === "two_way" || cal!.syncDirection === "pull");
}
export function memberPushes(cal: Cal | null | undefined): boolean {
  return Boolean(cal?.refreshToken) && (cal!.syncDirection === "two_way" || cal!.syncDirection === "push");
}

/** Pure: the Google event id of one item on one member's calendar. Includes the
 *  member so the same session on two calendars (or on the studio calendar of
 *  the same Google account) never collides. */
export function memberEventId(memberId: string, itemId: string): string {
  return pulseEventId(`${memberId}:${itemId}`);
}

export type MemberBlock = { googleEventId: string; startTime: number; endTime: number; allDay: boolean };
export type MemberMapResult =
  | { kind: "upsert"; block: MemberBlock }
  | { kind: "cancel"; googleEventId: string }
  | { kind: "skip" };

/** Pure: one event on a member's calendar -> busy time with NO title. Pulse's
 *  own events and events marked "free" do not block the person. */
export function mapMemberEvent(raw: GoogleCalendarListEvent): MemberMapResult {
  if (!raw.id) return { kind: "skip" };
  if (raw.extendedProperties?.private?.[PULSE_ORIGIN_TAG] === "1") return { kind: "skip" };
  if (raw.status === "cancelled") return { kind: "cancel", googleEventId: raw.id };
  if (raw.transparency === "transparent") return { kind: "skip" };
  const startTime = parseGoogleTime(raw.start);
  const endTime = parseGoogleTime(raw.end);
  if (startTime == null || endTime == null || endTime <= startTime) return { kind: "skip" };
  return {
    kind: "upsert",
    block: { googleEventId: raw.id, startTime, endTime, allDay: Boolean(raw.start?.date && !raw.start?.dateTime) },
  };
}

/* ---------- who is asking ---------- */

/** Internal: the signed-in member and their org. Null for the demo viewer or an
 *  agency user without a seat. */
export const _me = internalQuery({
  args: {},
  handler: async (ctx) => {
    const memberId = await currentMemberId(ctx);
    if (!memberId) return null;
    const member = await ctx.db.get(memberId);
    if (!member) return null;
    return { orgId: member.orgId, memberId };
  },
});

async function calendarOf(ctx: QueryCtx, memberId: Id<"members">): Promise<Cal | null> {
  return await ctx.db.query("memberCalendars").withIndex("by_member", (q) => q.eq("memberId", memberId)).first();
}

/* ---------- connect, disconnect, settings ---------- */

export const status = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await currentMemberId(ctx);
    const base = { configured: googleConfigured(), hasMember: Boolean(memberId) };
    if (!memberId) return { ...base, connected: false, needsReconnect: false, email: null, calendarId: null, direction: "two_way" as const, syncedAt: null, error: null };
    const cal = await calendarOf(ctx, memberId);
    const connected = Boolean(cal?.refreshToken);
    const needsReconnect = Boolean(cal && !cal.refreshToken && cal.syncError === RECONNECT_REQUIRED);
    return {
      ...base,
      connected,
      needsReconnect,
      email: cal?.googleEmail || null,
      calendarId: cal?.calendarId ?? (cal ? "primary" : null),
      direction: cal?.syncDirection ?? ("two_way" as const),
      syncedAt: cal?.syncedAt ?? null,
      error: cal?.syncError && cal.syncError !== RECONNECT_REQUIRED ? cal.syncError : null,
    };
  },
});

export const authUrl = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!googleConfigured()) throw new ConvexError("Google connect isn’t configured yet. Ask your admin to set it up.");
    const me = await ctx.runQuery(internal.memberCalendar._me, {});
    if (!me) throw new ConvexError("Your login isn’t linked to a team profile yet. Ask an owner to add your email to the team.");
    const nonce = crypto.randomUUID();
    await ctx.runMutation(internal.googleAuth._createMemberOAuthState, { orgId: me.orgId, memberId: me.memberId, nonce });
    return { url: googleAuthUrl(nonce, "member") };
  },
});

/** Internal: the callback stores a member's token. */
export const _storeMemberTokens = internalMutation({
  args: { orgId: v.string(), memberId: v.string(), refreshToken: v.string(), email: v.optional(v.string()) },
  handler: async (ctx, { orgId, memberId, refreshToken, email }) => {
    const id = ctx.db.normalizeId("members", memberId);
    const member = id ? await ctx.db.get(id) : null;
    if (!id || !member || member.orgId !== orgId) throw new Error("Member not found");
    const existing = await calendarOf(ctx, id);
    if (existing) {
      const same = !existing.googleEmail || !email || existing.googleEmail === email;
      if (!same) await clearBlocks(ctx, id);
      await ctx.db.patch(existing._id, {
        refreshToken,
        googleEmail: email ?? existing.googleEmail,
        connectedAt: Date.now(),
        syncToken: undefined,
        syncError: undefined,
        ...(same ? {} : { calendarId: undefined }),
      });
    } else {
      await ctx.db.insert("memberCalendars", {
        orgId,
        memberId: id,
        googleEmail: email ?? "",
        refreshToken,
        syncDirection: "two_way",
        connectedAt: Date.now(),
      });
    }
  },
});

async function clearBlocks(ctx: MutationCtx, memberId: Id<"members">) {
  const blocks = await ctx.db.query("memberBusyBlocks").withIndex("by_member_start", (q) => q.eq("memberId", memberId)).collect();
  for (const b of blocks) await ctx.db.delete(b._id);
}

/** Internal: Google refused this member's token. Clear it and flag a reconnect. */
export const _markMemberReconnect = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const cal = await calendarOf(ctx, memberId);
    if (!cal?.refreshToken) return;
    await ctx.db.patch(cal._id, { refreshToken: "", syncToken: undefined, syncError: RECONNECT_REQUIRED });
  },
});

export const _recordMemberError = internalMutation({
  args: { memberId: v.id("members"), error: v.string() },
  handler: async (ctx, { memberId, error }) => {
    const cal = await calendarOf(ctx, memberId);
    if (cal) await ctx.db.patch(cal._id, { syncError: error });
  },
});

async function failure(ctx: ActionCtx, memberId: Id<"members">, where: string, err: unknown) {
  console.error(`[memberCalendar.${where}]`, err);
  if (isInvalidGrant(err)) {
    await ctx.runMutation(internal.memberCalendar._markMemberReconnect, { memberId });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  await ctx.runMutation(internal.memberCalendar._recordMemberError, { memberId, error: `${where}: ${message}`.slice(0, 300) });
}

/** Disconnect and forget the person's busy time. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const memberId = await currentMemberId(ctx);
    if (!memberId) return;
    const cal = await calendarOf(ctx, memberId);
    if (cal) await ctx.db.delete(cal._id);
    await clearBlocks(ctx, memberId);
  },
});

export const _myCalendarToken = internalQuery({
  args: {},
  handler: async (ctx) => {
    const memberId = await currentMemberId(ctx);
    if (!memberId) return null;
    const cal = await calendarOf(ctx, memberId);
    return cal?.refreshToken ? { memberId, refreshToken: cal.refreshToken } : null;
  },
});

/** The person's calendars, for the picker. */
export const listCalendars = action({
  args: {},
  handler: async (ctx): Promise<{ calendars: { id: string; name: string; primary: boolean }[]; needsReconnect: boolean }> => {
    const c = await ctx.runQuery(internal.memberCalendar._myCalendarToken, {});
    if (!c) return { calendars: [], needsReconnect: false };
    try {
      const list = await googleCalendarList(c.refreshToken);
      return { calendars: list.map(({ id, name, primary }) => ({ id, name, primary })), needsReconnect: false };
    } catch (err) {
      if (err instanceof GoogleScopeMissing) return { calendars: [], needsReconnect: true };
      await failure(ctx, c.memberId, "listCalendars", err);
      return { calendars: [], needsReconnect: isInvalidGrant(err) };
    }
  },
});

export const setCalendar = mutation({
  args: { calendarId: v.string() },
  handler: async (ctx, { calendarId }) => {
    const memberId = await currentMemberId(ctx);
    const cal = memberId ? await calendarOf(ctx, memberId) : null;
    if (!memberId || !cal?.refreshToken) throw new ConvexError("Connect Google first.");
    if (cal.calendarId === calendarId) return;
    // A different calendar has different events: start the pull over.
    await clearBlocks(ctx, memberId);
    await ctx.db.patch(cal._id, { calendarId, syncToken: undefined, syncError: undefined });
  },
});

export const setDirection = mutation({
  args: { direction: directionV },
  handler: async (ctx, { direction }) => {
    const memberId = await currentMemberId(ctx);
    const cal = memberId ? await calendarOf(ctx, memberId) : null;
    if (!cal) throw new ConvexError("Connect Google first.");
    await ctx.db.patch(cal._id, { syncDirection: direction });
  },
});

/* ---------- push: my sessions and shifts -> my calendar ---------- */

export const _memberPushContext = internalQuery({
  args: { memberId: v.id("members"), itemKind: v.union(v.literal("session"), v.literal("shift")), itemId: v.string() },
  handler: async (ctx, { memberId, itemKind, itemId }) => {
    const cal = await calendarOf(ctx, memberId);
    if (!cal || !memberPushes(cal)) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", cal.orgId)).first();
    const studioName = org?.name ?? "Studio";
    const base = { memberId, refreshToken: cal.refreshToken, calendarId: cal.calendarId ?? "primary", studioName };
    if (itemKind === "session") {
      const id = ctx.db.normalizeId("sessions", itemId);
      const s = id ? await ctx.db.get(id) : null;
      if (!s || s.engineerId !== memberId) return { ...base, item: null };
      return {
        ...base,
        item: {
          title: s.title,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status,
          serviceType: s.serviceType,
          requestStatus: s.requestStatus,
        },
        shift: null,
      };
    }
    const id = ctx.db.normalizeId("shifts", itemId);
    const sh = id ? await ctx.db.get(id) : null;
    if (!sh || sh.memberId !== memberId || sh.kind !== "scheduled") return { ...base, item: null };
    const room = sh.roomId ? await ctx.db.get(sh.roomId) : null;
    return {
      ...base,
      item: null,
      shift: { startTime: sh.startTime, endTime: sh.endTime, status: sh.status, roomName: room?.name, note: sh.note },
    };
  },
});

/** Pure: a scheduled shift -> an event on the person's calendar. */
export function shiftToCalendarEvent(
  shift: { startTime: number; endTime: number; status: "scheduled" | "confirmed" | "cancelled"; roomName?: string; note?: string },
  opts?: { studioName?: string },
): GoogleCalendarEventBody {
  const studio = opts?.studioName ?? "the studio";
  return {
    summary: `Shift at ${studio}${shift.roomName ? ` (${shift.roomName})` : ""}`,
    description: [shift.note, "Synced from Pulse."].filter(Boolean).join("\n"),
    start: { dateTime: new Date(shift.startTime).toISOString() },
    end: { dateTime: new Date(shift.endTime).toISOString() },
    status: shift.status === "cancelled" ? "cancelled" : "confirmed",
    transparency: "opaque",
    extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } },
  };
}

export const pushMemberItem = internalAction({
  args: { memberId: v.id("members"), itemKind: v.union(v.literal("session"), v.literal("shift")), itemId: v.string() },
  handler: async (ctx, args) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.memberCalendar._memberPushContext, args);
    if (!c) return; // not connected, or direction does not push
    const eventId = memberEventId(args.memberId, args.itemId);
    try {
      let body: GoogleCalendarEventBody | null = null;
      if (c.item) body = sessionToCalendarEvent(c.item, { studioName: c.studioName });
      else if ("shift" in c && c.shift) body = shiftToCalendarEvent(c.shift, { studioName: c.studioName });
      // No item (it moved to another engineer or is gone) or a cancelled one: clear the slot.
      if (!body || body.status === "cancelled") {
        await googleCalendarDeleteEvent(c.refreshToken, eventId, c.calendarId);
        return;
      }
      await googleCalendarUpsertEvent(c.refreshToken, body, eventId, c.calendarId);
    } catch (err) {
      await failure(ctx, args.memberId, "pushMemberItem", err);
    }
  },
});

export const _memberRemoveContext = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const cal = await calendarOf(ctx, memberId);
    return cal && memberPushes(cal) ? { refreshToken: cal.refreshToken, calendarId: cal.calendarId ?? "primary" } : null;
  },
});

export const removeMemberItem = internalAction({
  args: { memberId: v.id("members"), itemId: v.string() },
  handler: async (ctx, { memberId, itemId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.memberCalendar._memberRemoveContext, { memberId });
    if (!c) return;
    try {
      await googleCalendarDeleteEvent(c.refreshToken, memberEventId(memberId, itemId), c.calendarId);
    } catch (err) {
      await failure(ctx, memberId, "removeMemberItem", err);
    }
  },
});

/* ---------- pull: my calendar -> busy time (no titles) ---------- */

export const _memberSyncContext = internalQuery({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const cal = await calendarOf(ctx, memberId);
    if (!cal || !memberPulls(cal)) return null;
    return { orgId: cal.orgId, refreshToken: cal.refreshToken, calendarId: cal.calendarId ?? "primary", syncToken: cal.syncToken ?? null };
  },
});

export const _applyMemberDelta = internalMutation({
  args: {
    orgId: v.string(),
    memberId: v.id("members"),
    upserts: v.array(v.object({ googleEventId: v.string(), startTime: v.number(), endTime: v.number(), allDay: v.boolean() })),
    cancels: v.array(v.string()),
    nextSyncToken: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { orgId, memberId, upserts, cancels, nextSyncToken }) => {
    const now = Date.now();
    const find = (googleEventId: string) =>
      ctx.db.query("memberBusyBlocks").withIndex("by_event", (q) => q.eq("memberId", memberId).eq("googleEventId", googleEventId)).first();
    for (const b of upserts) {
      const existing = await find(b.googleEventId);
      if (existing) await ctx.db.patch(existing._id, { startTime: b.startTime, endTime: b.endTime, allDay: b.allDay, updatedAt: now });
      else await ctx.db.insert("memberBusyBlocks", { orgId, memberId, ...b, updatedAt: now });
    }
    for (const id of cancels) {
      const existing = await find(id);
      if (existing) await ctx.db.delete(existing._id);
    }
    const cal = await calendarOf(ctx, memberId);
    if (cal) await ctx.db.patch(cal._id, { syncToken: nextSyncToken ?? undefined, syncedAt: now, syncError: undefined });
  },
});

export const _resetMemberSyncToken = internalMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    const cal = await calendarOf(ctx, memberId);
    if (cal) await ctx.db.patch(cal._id, { syncToken: undefined });
  },
});

/** Pull one member's calendar into busy blocks. */
export const pullMember = internalAction({
  args: { memberId: v.id("members") },
  handler: async (ctx, { memberId }) => {
    if (!googleConfigured()) return;
    const c = await ctx.runQuery(internal.memberCalendar._memberSyncContext, { memberId });
    if (!c) return;
    const full = { timeMin: new Date(Date.now() - FULL_PULL_LOOKBACK_MS).toISOString(), calendarId: c.calendarId };
    try {
      let listed;
      try {
        listed = await googleCalendarListEvents(c.refreshToken, c.syncToken ? { syncToken: c.syncToken, calendarId: c.calendarId } : full);
      } catch (err) {
        if (!(err instanceof GoogleSyncTokenExpired)) throw err;
        await ctx.runMutation(internal.memberCalendar._resetMemberSyncToken, { memberId });
        listed = await googleCalendarListEvents(c.refreshToken, full);
      }
      const upserts: MemberBlock[] = [];
      const cancels: string[] = [];
      for (const raw of listed.events) {
        const m = mapMemberEvent(raw);
        if (m.kind === "upsert") upserts.push(m.block);
        else if (m.kind === "cancel") cancels.push(m.googleEventId);
      }
      await ctx.runMutation(internal.memberCalendar._applyMemberDelta, {
        orgId: c.orgId,
        memberId,
        upserts,
        cancels,
        nextSyncToken: listed.nextSyncToken,
      });
    } catch (err) {
      await failure(ctx, memberId, "pullMember", err);
    }
  },
});

/** Cron helper: fan out a pull to every member who pulls. */
export const scheduleMemberPulls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cals = await ctx.db.query("memberCalendars").collect();
    const pulling = cals.filter(memberPulls);
    for (const cal of pulling) {
      await ctx.scheduler.runAfter(0, internal.memberCalendar.pullMember, { memberId: cal.memberId });
    }
    return { scheduled: pulling.length };
  },
});

/* ---------- the staff schedule: "Busy", never a title ---------- */

export const busyInRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const orgId = await currentOrg(ctx);
    const cals = await ctx.db.query("memberCalendars").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const pulling = new Set<Id<"members">>(cals.filter(memberPulls).map((c) => c.memberId));
    if (pulling.size === 0) return [];
    const blocks = await ctx.db
      .query("memberBusyBlocks")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", from - 31 * 86_400_000).lt("startTime", to))
      .collect();
    return blocks
      .filter((b) => pulling.has(b.memberId) && b.endTime > from && b.startTime < to)
      .map((b) => ({ memberId: b.memberId, startTime: b.startTime, endTime: b.endTime, allDay: b.allDay ?? false }));
  },
});
