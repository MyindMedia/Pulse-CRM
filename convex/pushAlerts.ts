import { internalMutation } from "./functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { computeT10Alerts, type T10Session, type T10Shift } from "./lib/t10";
import { orgTz } from "./lib/tz";

/* The every-minute device-alert sweep. Only orgs with registered devices are
   scanned; each due alert is deduped through the pushAlerts ledger and fanned
   out via the Node web-push action. Alert semantics live in lib/t10.ts. */

export const sweep = internalMutation({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const now = nowMs ?? Date.now();

    // Only orgs that actually have devices listening.
    const subs = await ctx.db.query("pushSubscriptions").collect();
    const orgIds = [...new Set(subs.map((s) => s.orgId))];
    let fired = 0;

    for (const orgId of orgIds) {
      const orgRow = await ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .first();
      const tz = orgTz(orgRow);
      // Near-term sessions: started up to 12h ago (long sessions still end in
      // range) through those starting just past the T-10 window.
      const rows = await ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gte("startTime", now - 12 * 3_600_000).lte("startTime", now + 11 * 60_000),
        )
        .collect();
      const interesting = rows.filter(
        (s) =>
          s.status !== "cancelled" &&
          s.status !== "no_show" &&
          // Anything whose start, end, or just-ended moment is near the windows.
          (s.startTime >= now + 8 * 60_000 || s.endTime >= now - 3 * 60_000),
      );

      const sessions: T10Session[] = await Promise.all(
        interesting.map(async (s) => {
          const [artist, room] = await Promise.all([
            s.artistId ? ctx.db.get(s.artistId) : null,
            s.roomId ? ctx.db.get(s.roomId) : null,
          ]);
          // Refresh target lookup only matters for sessions ending about now.
          let nextInRoom: T10Session["nextInRoom"] = null;
          if (s.roomId && s.endTime >= now - 3 * 60_000 && s.endTime <= now + 60_000) {
            const upcoming = await ctx.db
              .query("sessions")
              .withIndex("by_org_start", (q) =>
                q.eq("orgId", orgId).gte("startTime", s.endTime).lte("startTime", s.endTime + 2 * 3_600_000),
              )
              .collect();
            const candidate = upcoming
              .filter((n) => n.roomId === s.roomId && n._id !== s._id && n.status !== "cancelled")
              .sort((a, b) => a.startTime - b.startTime)[0];
            if (candidate) {
              const nextArtist = candidate.artistId ? await ctx.db.get(candidate.artistId) : null;
              nextInRoom = { artistName: nextArtist?.name ?? "the next client", startTime: candidate.startTime };
            }
          }
          return {
            _id: s._id,
            startTime: s.startTime,
            endTime: s.endTime,
            status: s.status,
            artistName: artist?.name ?? "A client",
            roomName: room?.name ?? null,
            nextInRoom,
          };
        }),
      );

      const shiftRows = await ctx.db
        .query("shifts")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gte("startTime", now + 8 * 60_000).lte("startTime", now + 11 * 60_000),
        )
        .collect();
      const shifts: T10Shift[] = await Promise.all(
        shiftRows.map(async (sh) => ({
          _id: sh._id,
          startTime: sh.startTime,
          status: sh.status,
          memberName: (await ctx.db.get(sh.memberId))?.name ?? "A team member",
        })),
      );

      // "On schedule" targeting: staff whose shift covers RIGHT NOW (plus a
      // 20-min lead-in for the incoming crew) get the pings; when nobody
      // on-shift has a registered device the send falls back to all devices.
      const activeShiftRows = await ctx.db
        .query("shifts")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gte("startTime", now - 14 * 3_600_000).lte("startTime", now + 20 * 60_000),
        )
        .collect();
      const onShiftMemberIds = [
        ...new Set(
          activeShiftRows
            .filter((sh) => sh.status !== "cancelled" && sh.endTime >= now)
            .map((sh) => sh.memberId),
        ),
      ];
      const onShiftClerkIds = (
        await Promise.all(onShiftMemberIds.map((id) => ctx.db.get(id)))
      )
        .map((m) => m?.clerkUserId)
        .filter((id): id is string => Boolean(id));

      for (const alert of computeT10Alerts(now, sessions, shifts, tz)) {
        const seen = await ctx.db
          .query("pushAlerts")
          .withIndex("by_org_key", (q) => q.eq("orgId", orgId).eq("key", alert.key))
          .first();
        if (seen) continue;
        await ctx.db.insert("pushAlerts", { orgId, key: alert.key, sentAt: now });
        await ctx.scheduler.runAfter(0, internal.pushSend.sendToOrg, {
          orgId,
          title: alert.title,
          body: alert.body,
          url: alert.url,
          tag: alert.key,
          clerkUserIds: onShiftClerkIds.length > 0 ? onShiftClerkIds : undefined,
        });
        fired += 1;
      }
    }
    return { orgs: orgIds.length, fired };
  },
});
