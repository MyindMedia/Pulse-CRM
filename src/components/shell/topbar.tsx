"use client";

import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Menu, Search } from "lucide-react";
import { activeNav } from "@/lib/nav";
import { openCommandPalette } from "@/components/shell/command-palette";
import { InsightsBell } from "@/components/shell/insights-bell";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { Brackets, useSlotRef } from "@/components/shell/page-header-slot";

/* The top bar chassis (kit section 6.1): the page title and its caption, the
 * search well, then the page's own keys. The title and keys come from the
 * page's PageHeader through two slots; until a page fills them, the nav label
 * and the studio name stand in. Notifications and the account menu are app
 * functions the kit's mockup leaves out; they sit at the end as small keys. */
export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const org = useQuery(api.orgs.current);
  const current = activeNav(pathname);
  const titleRef = useSlotRef("title");
  const actionsRef = useSlotRef("actions");

  return (
    <header className="pl-card relative flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 lg:min-h-[76px] lg:flex-nowrap lg:gap-x-4 lg:px-6 lg:py-3">
      <Brackets />
      <button onClick={onOpenMenu} className="pl-icon-key lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>

      <div className="min-w-0 flex-1 lg:max-w-[42%] lg:flex-none">
        <div ref={titleRef} className="pl-title-slot" />
        <div className="pl-title-fallback min-w-0">
          <h1 className="truncate font-sans text-[22px] font-extrabold leading-7 tracking-[-0.01em] text-bone lg:text-[26px] lg:leading-8">
            {current?.label ?? "Pulse"}
          </h1>
          <p className="truncate font-sans text-[11px] leading-4 text-steel">{org?.name ?? "Pulse Studio"}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={openCommandPalette}
        className="pl-search hidden min-w-0 flex-1 md:flex"
        aria-label="Search"
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">Search clients, sessions, invoices</span>
        <kbd className="ml-auto hidden shrink-0 rounded-[4px] border border-hairline px-1.5 font-mono text-[10px] text-steel lg:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-2 md:contents">
        <button type="button" onClick={openCommandPalette} className="pl-icon-key md:hidden" aria-label="Search">
          <Search className="size-4" />
        </button>
        <InsightsBell />
        <ProfileMenu />
      </div>

      {/* The page's keys. On a phone they wrap onto their own row inside the
          chassis rather than squeezing the title. */}
      <div
        ref={actionsRef}
        className="pl-actions-slot order-last flex w-full flex-wrap items-center gap-2 lg:order-none lg:w-auto lg:flex-nowrap"
      />
    </header>
  );
}
