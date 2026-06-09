"use client";

import { motion } from "motion/react";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { relativeTime } from "@/lib/format";

export type ActivityItem = {
  kind: string;
  summary: string;
  accent?: string;
  _creationTime: number;
};

/** Vertical event feed for a single subaccount. */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No activity yet"
        description="Bookings, payments, and roster changes for this studio will show up here."
      />
    );
  }

  return (
    <ol className="relative space-y-4 pl-5">
      <span className="absolute inset-y-1 left-[0.3125rem] w-px bg-hairline" aria-hidden />
      {items.map((item, i) => (
        <motion.li
          key={`${item._creationTime}-${i}`}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.2 }}
          className="relative"
        >
          <span
            className="absolute -left-5 top-1.5 size-2.5 rounded-full border-2 border-ink"
            style={{ backgroundColor: item.accent ?? "#fdb913" }}
            aria-hidden
          />
          <p className="text-sm text-bone">{item.summary}</p>
          <p className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-steel/70">
            <span className="font-meta uppercase tracking-wide">{item.kind}</span>
            <span aria-hidden>·</span>
            <span>{relativeTime(item._creationTime)}</span>
          </p>
        </motion.li>
      ))}
    </ol>
  );
}
