"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Building2 } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { PulseLogo } from "@/components/brand/pulse-logo";

/* The Pulse wordmark - the official gold pulse glyph + "PULSE" lockup.
 * Stretches across the full sidebar rail. */
function Wordmark() {
  // Two-thirds of the rail width - the source PNG is tightly cropped, so the
  // height follows automatically (h-auto on the img).
  return (
    <div className="w-2/3">
      <PulseLogo size="full" className="block" />
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Hide nav features the agency has disabled for this sub-account.
  const org = useQuery(api.orgs.current);
  const disabled = new Set(org?.disabledFeatures ?? []);
  const items = NAV.filter((item) => !item.feature || !disabled.has(item.feature));

  return (
    <div className="flex h-full flex-col gap-6 py-5">
      <div className="px-4">
        <Wordmark />
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex min-h-11 items-center gap-3 rounded-chrome px-3 py-2 font-meta text-[0.7rem] uppercase tracking-[0.04em] " +
                  "transition-[background-color,color,border-color,transform] duration-200 ease-out active:scale-[0.98] border",
                active
                  ? "border-gold/50 bg-gold/12 text-bone"
                  : "border-transparent text-steel hover:bg-coal/60 hover:text-bone",
              )}
            >
              <item.icon
                className={cn(
                  "size-[1.1rem] shrink-0 transition-colors",
                  active ? "text-gold" : "text-steel/70 group-hover:text-steel",
                )}
              />
              {item.label}
              {active && <span className="ml-auto size-1.5 rounded-full bg-gold" />}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 px-3">
        <Link
          href="/agency"
          onClick={onNavigate}
          className="group flex items-center gap-3 rounded-chrome border border-graphite/60 bg-coal/40 px-3 py-2 font-meta text-[0.7rem] uppercase tracking-[0.04em] text-steel transition-colors hover:border-gold hover:text-bone"
        >
          <Building2 className="size-[1.1rem] shrink-0 text-steel/70 transition-colors group-hover:text-gold" />
          Agency console
        </Link>
        <div className="px-2">
          <p className="chrome-meta text-steel/80">Pulse by Myind Sound</p>
          <p className="mt-0.5 font-meta text-[0.625rem] text-steel/60">v1.0 · Studio edition</p>
        </div>
      </div>
    </div>
  );
}
