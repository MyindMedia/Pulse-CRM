"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2 } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";

/* The Pulse wordmark - a gold pulse glyph + the name. */
function Wordmark() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
      <span className="grid size-8 place-items-center rounded-md bg-gold text-gold-ink">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M2 12h4l3-8 6 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-bone">Pulse</span>
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-6 py-5">
      <div className="px-3">
        <Wordmark />
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-coal-2 text-bone"
                  : "text-ash hover:bg-coal/60 hover:text-bone",
              )}
            >
              <item.icon
                className={cn(
                  "size-[1.1rem] shrink-0 transition-colors",
                  active ? "text-gold" : "text-ash-dim group-hover:text-ash",
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
          className="group flex items-center gap-3 rounded-md border border-hairline-2 bg-coal/40 px-3 py-2 text-xs font-medium text-ash transition-colors hover:border-gold-dim hover:text-bone"
        >
          <Building2 className="size-[1.1rem] shrink-0 text-ash-dim transition-colors group-hover:text-gold" />
          Agency console
        </Link>
        <div className="px-2">
          <p className="text-[0.625rem] font-mono uppercase tracking-[0.18em] text-ash-dim">
            Pulse by Myind Sound
          </p>
          <p className="mt-0.5 text-[0.625rem] text-ash-dim">v1.0 - Studio edition</p>
        </div>
      </div>
    </div>
  );
}
