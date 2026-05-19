"use client";

import { useState } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { StudioBanner } from "@/components/shell/studio-banner";
import { CommandPalette } from "@/components/shell/command-palette";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-ink">
        {/* Desktop rail */}
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-hairline bg-ink-2 lg:block">
          <Sidebar />
        </aside>

        {/* Mobile nav drawer */}
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent width="sm" className="bg-ink-2 lg:hidden">
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </Sheet>

        {/* Main column */}
        <div className="flex min-h-dvh flex-col lg:pl-64">
          <StudioBanner />
          <Topbar onOpenMenu={() => setMobileNav(true)} />
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>

        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
