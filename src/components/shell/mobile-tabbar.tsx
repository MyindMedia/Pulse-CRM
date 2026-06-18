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
 * iOS-style bottom tab bar (mobile only). Shows the first few primary nav
 * destinations as icon tabs plus a "More" tab that opens the full nav drawer.
 * Blurred material, gold active state, and safe-area padding so it sits above
 * the home indicator without clipping. Hidden on lg+ where the sidebar shows.
 */
export function MobileTabBar({ onOpenMore }: { onOpenMore: () => void }) {
  const pathname = usePathname();
  const { can, loaded } = useCapabilities();
  const org = useQuery(api.orgs.current);
  const disabledFeatures = org?.disabledFeatures;

  const items = React.useMemo(() => {
    const disabled = new Set(disabledFeatures ?? []);
    return NAV.filter((item) => {
      if (item.feature && disabled.has(item.feature)) return false;
      if (item.capability && (!loaded || !can(item.capability))) return false;
      return true;
    }).slice(0, 4);
  }, [disabledFeatures, can, loaded]);

  return (
    <nav
      aria-label="Primary"
      className="theme-dark-island fixed inset-x-0 bottom-0 z-30 lg:hidden material-thick border-t border-hairline-2/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
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
