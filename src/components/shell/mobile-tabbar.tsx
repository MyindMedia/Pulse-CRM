"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { MoreHorizontal } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/lib/use-capabilities";

/**
 * The hourly-use surfaces an operator actually taps on a phone, in order.
 * The bar draws from this list (not the top of the full nav) so the bottom
 * tabs are the daily-driver screens; everything else lives in the More drawer.
 * "/clock" (the staff punch clock) only shows for actual studio team members -
 * agency viewers and demo owners have no member row to clock.
 */
const MOBILE_PRIMARY = ["/dashboard", "/clock", "/calendar", "/bookings", "/payments"] as const;

/**
 * iOS-style bottom tab bar (mobile only). Surfaces the operator's daily-driver
 * destinations (Today, Calendar, Bookings, Payments) as icon tabs plus a "More"
 * tab that opens the full nav drawer. Blurred material, gold active state, and
 * safe-area padding so it sits above the home indicator without clipping.
 * Hidden on lg+ where the sidebar shows.
 */
export function MobileTabBar({ onOpenMore }: { onOpenMore: () => void }) {
  const pathname = usePathname();
  const { can, loaded } = useCapabilities();
  const org = useQuery(api.orgs.current);
  const disabledFeatures = org?.disabledFeatures;
  // Already subscribed globally by ClockWidget, so this dedupes to no extra load.
  const clockStatus = useQuery(api.timeclock.myStatus, {});
  const isStaff = Boolean(clockStatus?.member);

  const items = React.useMemo(() => {
    const disabled = new Set(disabledFeatures ?? []);
    const byHref = new Map(NAV.map((item) => [item.href, item]));
    return MOBILE_PRIMARY.map((href) => byHref.get(href))
      .filter((item): item is (typeof NAV)[number] => Boolean(item))
      .filter((item) => {
        if (item.href === "/clock" && !isStaff) return false;
        if (item.feature && disabled.has(item.feature)) return false;
        if (item.capability && (!loaded || !can(item.capability))) return false;
        return true;
      })
      .slice(0, 5);
  }, [disabledFeatures, can, loaded, isStaff]);

  return (
    <nav
      aria-label="Primary"
      className="theme-dark-island fixed inset-x-0 bottom-0 z-30 lg:hidden material-thick border-t border-hairline-2/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        className="mx-auto grid max-w-md"
        style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 active:scale-95 transition-transform"
            >
              <item.icon
                className={cn("size-[1.35rem] transition-colors", active ? "text-gold" : "text-steel")}
              />
              <span
                className={cn(
                  "max-w-full truncate text-[0.625rem] font-medium tracking-tight transition-colors",
                  active ? "text-bone" : "text-steel/80",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMore}
          aria-label="More"
          className="flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 text-steel active:scale-95 transition-transform"
        >
          <MoreHorizontal className="size-[1.35rem]" />
          <span className="text-[0.625rem] font-medium tracking-tight text-steel/80">More</span>
        </button>
      </div>
    </nav>
  );
}
