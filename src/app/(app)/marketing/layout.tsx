"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/marketing", label: "Calendar" },
  { href: "/marketing/compose", label: "Compose" },
  { href: "/marketing/accounts", label: "Accounts" },
  { href: "/marketing/promos", label: "Promos" },
  { href: "/marketing/results", label: "Results" },
];

/** Shell for every Marketing surface - header + tab strip, with the active
 *  route's page rendered below. The tab strip is Link-based (real routes,
 *  not client-state panes) so each tab is deep-linkable and keeps its own
 *  page's data fetching. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing"
        description="Scheduled posts, promo codes and the results they drove, across every account your studio connects."
      />
      <nav className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg material-ultrathin p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((tab) => {
          const active = tab.href === "/marketing" ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "inline-flex shrink-0 whitespace-nowrap items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-200 ease-out",
                active
                  ? "bg-gold/15 text-gold-bright shadow-elev-1"
                  : "text-steel hover:bg-coal-3/60 hover:text-bone",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
