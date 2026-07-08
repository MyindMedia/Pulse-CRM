"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { useCapabilities } from "@/lib/use-capabilities";

/**
 * Live pop-up notifications for owners + managers (schedule.manage): when a
 * teammate clocks in or out and when a booking lands, a toast pops in real
 * time via the same reactive activity feed that fills the notification bell.
 * Only events that happen AFTER mount pop (no replay flood on page load), the
 * viewer's own punches are skipped (the clock UI already confirms those), and
 * every event remains in the bell for anyone who missed the toast.
 */
const POP: Record<string, { title: string; route: string }> = {
  "booking.created": { title: "New booking", route: "/bookings" },
  "booking.held": { title: "Booking hold placed", route: "/bookings" },
  "staff.clocked_in": { title: "Staff on the clock", route: "/payroll" },
  "staff.clocked_out": { title: "Staff off the clock", route: "/payroll" },
  "engineer.requested": { title: "Engineer requested", route: "/bookings" },
  "engineer.confirmed": { title: "Booking finalized", route: "/bookings" },
  "engineer.declined": { title: "Session needs restaffing", route: "/bookings" },
};

export function LiveToasts() {
  const router = useRouter();
  const { can, loaded } = useCapabilities();
  const manager = loaded && can("schedule.manage");
  // limit 20 matches InsightsBell's subscription exactly so Convex dedupes
  // the two consumers into ONE activityFeed query.
  const feed = useQuery(api.notifications.activityFeed, manager ? { limit: 20 } : "skip");
  // The viewer's own member row (null for non-staff) - to mute self punches.
  // Already subscribed globally by ClockWidget, so this dedupes to no extra load.
  const me = useQuery(api.timeclock.myStatus, {});

  const cutoff = React.useRef<number | null>(null);
  const seen = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    // Stamp the mount time on first run (kept out of render for purity).
    if (cutoff.current === null) cutoff.current = Date.now();
    if (!manager || !feed) return;
    // Oldest first so near-simultaneous events pop in the order they happened.
    for (const row of [...feed].reverse()) {
      const pop = POP[row.kind];
      if (!pop) continue;
      if (row._creationTime <= cutoff.current) continue; // pre-mount history stays in the bell
      if (seen.current.has(row._id)) continue;
      seen.current.add(row._id);
      const isOwnPunch =
        row.kind.startsWith("staff.") &&
        row.entityId != null &&
        me?.member?._id != null &&
        row.entityId === me.member._id;
      if (isOwnPunch) continue;
      toast(pop.title, {
        description: row.summary,
        action: { label: "View", onClick: () => router.push(pop.route) },
      });
    }
  }, [feed, manager, me, router]);

  return null;
}
