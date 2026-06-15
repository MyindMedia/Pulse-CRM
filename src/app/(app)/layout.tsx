"use client";

import { useState } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { StudioBanner } from "@/components/shell/studio-banner";
import { BillingBanner, BillingLock } from "@/components/shell/billing-gate";
import { MemberSync } from "@/components/shell/member-sync";
import { CommandPalette } from "@/components/shell/command-palette";
import { FeatureGuard } from "@/components/shell/feature-guard";
import { OrgTheme } from "@/components/shell/org-theme";
import { AppTransition } from "@/components/shell/app-motion";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false);

  return (
    <TooltipProvider delayDuration={300}>
      <MemberSync />
      <FeatureGuard />
      <OrgTheme>
      <div className="relative min-h-dvh bg-ink">
        {/* Studio-light bloom - warm backdrop for the glass to refract */}
        <div className="app-bloom" aria-hidden />

        {/* Desktop rail */}
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 material-regular lg:block">
          <Sidebar />
        </aside>

        {/* Mobile nav drawer */}
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent width="sm" className="material-regular lg:hidden">
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </Sheet>

        {/* Main column */}
        <div className="relative z-10 flex min-h-dvh flex-col lg:pl-64">
          <StudioBanner />
          <BillingBanner />
          <Topbar onOpenMenu={() => setMobileNav(true)} />
          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
            <AppTransition>{children}</AppTransition>
          </main>
        </div>

        <BillingLock />
        <CommandPalette />
      </div>
      </OrgTheme>
    </TooltipProvider>
  );
}
