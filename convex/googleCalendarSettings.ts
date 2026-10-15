import { action, internalQuery } from "./_generated/server";
import { mutation } from "./functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";
import { SETUP_ACCESS } from "./lib/access";
import { googleCalendarList, GoogleScopeMissing, isInvalidGrant } from "./lib/google";

/* The studio (company) calendar's settings: which calendar of the connected
   account is the shared one, and which way events flow. Owners and managers
   only (the same gate as connecting Google). */

const directionV = v.union(v.literal("two_way"), v.literal("push"), v.literal("pull"), v.literal("off"));

export const _tokenForSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx, SETUP_ACCESS);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return org?.googleRefreshToken ? { orgId, refreshToken: org.googleRefreshToken } : null;
  },
});

/** The connected account's writable calendars, for the picker. `needsReconnect`
 *  is true when the grant was lost or predates calendar picking. */
export const listCalendars = action({
  args: {},
  handler: async (ctx): Promise<{ calendars: { id: string; name: string; primary: boolean }[]; needsReconnect: boolean }> => {
    const c = await ctx.runQuery(internal.googleCalendarSettings._tokenForSettings, {});
    if (!c) return { calendars: [], needsReconnect: false };
    try {
      const list = await googleCalendarList(c.refreshToken);
      return { calendars: list.map(({ id, name, primary }) => ({ id, name, primary })), needsReconnect: false };
    } catch (err) {
      if (err instanceof GoogleScopeMissing) return { calendars: [], needsReconnect: true };
      if (isInvalidGrant(err)) {
        await ctx.runMutation(internal.googleAuth._markReconnect, { orgId: c.orgId });
        return { calendars: [], needsReconnect: true };
      }
      console.error("[googleCalendarSettings.listCalendars]", err);
      throw new ConvexError("Could not load your Google calendars. Try again in a minute.");
    }
  },
});

/** Choose the shared studio calendar. Starts the pull over on the new calendar
 *  and drops the old calendar's imported busy time. */
export const setCalendar = mutation({
  args: { calendarId: v.string(), calendarName: v.string() },
  handler: async (ctx, { calendarId, calendarName }) => {
    const orgId = await currentOrg(ctx, SETUP_ACCESS);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org?.googleRefreshToken) throw new ConvexError("Connect Google first.");
    if ((org.googleCalendarId ?? "primary") === calendarId) {
      if (org.googleCalendarName !== calendarName) await ctx.db.patch(org._id, { googleCalendarName: calendarName });
      return;
    }
    const old = await ctx.db.query("googleBusyBlocks").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const b of old) await ctx.db.delete(b._id);
    // The old calendar's events leave the review list too; ones that became
    // bookings stay, so their bookings keep their history.
    const events = await ctx.db.query("googleEvents").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    for (const e of events) if (!e.importedSessionId) await ctx.db.delete(e._id);
    await ctx.db.patch(org._id, {
      googleCalendarId: calendarId,
      googleCalendarName: calendarName,
      googleCalendarSyncToken: undefined,
      googleCalendarSyncError: undefined,
      googleCalendarPushError: undefined,
      googleCalendarPushErrorAt: undefined,
    });
  },
});

export const setDirection = mutation({
  args: { direction: directionV },
  handler: async (ctx, { direction }) => {
    const orgId = await currentOrg(ctx, SETUP_ACCESS);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) throw new ConvexError("Studio not found.");
    await ctx.db.patch(org._id, { googleSyncDirection: direction });
  },
});
