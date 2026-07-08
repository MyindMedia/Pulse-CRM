"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Menu, Search } from "lucide-react";
import { activeNav } from "@/lib/nav";
import { openCommandPalette } from "@/components/shell/command-palette";
import { InsightsBell } from "@/components/shell/insights-bell";
import { ProfileMenu } from "@/components/shell/profile-menu";

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const org = useQuery(api.orgs.current);
  const current = activeNav(pathname);

  return (
    <header className="theme-dark-island sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/[0.08] bg-obsidian/65 px-4 backdrop-blur-2xl backdrop-saturate-150 lg:px-6">
      <button
        onClick={onOpenMenu}
        className="grid size-9 place-items-center rounded-chrome text-steel hover:bg-coal-2 hover:text-bone lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      <div className="min-w-0">
        <p className="chrome-meta hidden text-steel sm:block">{org?.name ?? "Pulse Studio"}</p>
        <h1 className="truncate font-grotesk text-base font-semibold tracking-[-0.01em] text-bone">
          {current?.label ?? "Pulse"}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={openCommandPalette}
          className="chrome-ghost flex h-9 items-center gap-2 rounded-chrome px-3 font-meta text-xs uppercase tracking-[0.04em] text-steel transition-colors hover:text-bone"
        >
          <Search className="size-4" />
          <span className="hidden md:inline">Search</span>
          <kbd className="hidden rounded border border-graphite/60 bg-obsidian px-1.5 font-meta text-[0.625rem] text-steel md:inline">
            ⌘K
          </kbd>
        </button>

        <InsightsBell />

        <ProfileMenu />
      </div>
    </header>
  );
}
