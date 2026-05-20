"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Menu, Search } from "lucide-react";
import { activeNav } from "@/lib/nav";
import { openCommandPalette } from "@/components/shell/command-palette";
import { InsightsBell } from "@/components/shell/insights-bell";
import { Avatar } from "@/components/ui/avatar";

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const org = useQuery(api.orgs.current);
  const current = activeNav(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-hairline bg-ink/70 px-4 backdrop-blur-xl backdrop-saturate-150 lg:px-6">
      <button
        onClick={onOpenMenu}
        className="grid size-9 place-items-center rounded-md text-ash hover:bg-coal-2 hover:text-bone lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      <div className="min-w-0">
        <p className="overline hidden sm:block">{org?.name ?? "Pulse Studio"}</p>
        <h1 className="truncate font-display text-base font-semibold text-bone">
          {current?.label ?? "Pulse"}
        </h1>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={openCommandPalette}
          className="flex h-9 items-center gap-2 rounded-md border border-hairline-2 bg-coal/60 px-3 text-sm text-ash-dim transition-colors hover:border-hairline-2 hover:text-ash"
        >
          <Search className="size-4" />
          <span className="hidden md:inline">Search</span>
          <kbd className="hidden rounded border border-hairline-2 bg-ink-2 px-1.5 font-mono text-[0.625rem] text-ash-dim md:inline">
            ⌘K
          </kbd>
        </button>

        <InsightsBell />

        <div className="flex items-center gap-2 rounded-md border border-hairline-2 bg-coal/60 py-1 pl-1 pr-2.5">
          <Avatar name={org?.actor ?? "Studio"} size="sm" />
          <div className="hidden leading-tight sm:block">
            <p className="text-xs font-medium text-bone">{org?.actor ?? "Studio"}</p>
            <p className="font-mono text-[0.625rem] uppercase text-ash-dim">
              {org?.plan ?? "studio"} plan
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
