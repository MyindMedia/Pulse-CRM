"use client";

import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/* The platform owner's inbox in the agency console top bar. Feature requests
   are the first thing that lands here; opening the bell marks them read. */
export function AgencyBell() {
  const data = useQuery(api.featureRequests.notifications, {});
  const markRead = useMutation(api.featureRequests.markNotificationsRead);
  const unread = data?.unread ?? 0;
  return (
    <Popover onOpenChange={(open) => { if (open && unread > 0) void markRead({}); }}>
      <PopoverTrigger
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-9 place-items-center rounded-md text-steel outline-none transition-colors hover:bg-coal-2 hover:text-bone focus-visible:ring-2 focus-visible:ring-gold/30"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[0.625rem] font-semibold leading-4 text-gold-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-graphite/50 px-3 py-2 text-xs font-medium text-steel">Notifications</div>
        {data && data.items.length > 0 ? (
          <ul className="max-h-80 divide-y divide-graphite/40 overflow-y-auto">
            {data.items.map((n) => (
              <li key={n._id}>
                <Link href={n.href ?? "/agency"} className="block px-3 py-2.5 hover:bg-coal-2/70">
                  <p className="break-words text-sm font-medium text-bone">{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 break-words text-xs text-steel">{n.body}</p>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-steel">Nothing new.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
