"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useCollapsiblePanel } from "@/lib/use-collapsible-panel";
import { Sidebar } from "@/components/shell/sidebar";
import { WhiteLabelTheme } from "@/components/shell/white-label-theme";
import { BetaLoginTracker } from "@/components/shell/beta-login-tracker";
import { BetaSignatureBanner } from "@/components/shell/beta-signature-banner";
import { BetaClockStarter } from "@/components/shell/beta-clock-starter";
import { Topbar } from "@/components/shell/topbar";
import { StudioBanner } from "@/components/shell/studio-banner";
import { BillingBanner, BillingLock, BillingLockGate } from "@/components/shell/billing-gate";
import { MemberSync } from "@/components/shell/member-sync";
import { ActiveOrgSync } from "@/components/shell/active-org-sync";
import { TimezoneSync } from "@/components/shell/timezone-sync";
import { AuthGate } from "@/components/shell/auth-gate";
import { AgencyHomeRedirect } from "@/components/shell/agency-home-redirect";
import { LiveToasts } from "@/components/shell/live-toasts";
import { CommandPalette } from "@/components/shell/command-palette";
import { ClockWidget } from "@/components/timeclock/clock-widget";
import { MobileTabBar } from "@/components/shell/mobile-tabbar";
import { FeatureGuard } from "@/components/shell/feature-guard";
import { OrgTheme } from "@/components/shell/org-theme";
import { AppTransition } from "@/components/shell/app-motion";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShellErrorBoundary } from "@/components/shell/shell-error-boundary";
import { Brackets, PageHeaderSlotProvider } from "@/components/shell/page-header-slot";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false);
  const { collapsed: navCollapsed, toggle: toggleNav } = useCollapsiblePanel(
    "pulse:nav-collapsed",
  );

  // Cmd+\ folds the rail. The canvas uses the same idea for its own panels,
  // so one muscle memory covers every surface that competes for width.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "\\" || !(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      toggleNav();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleNav]);

  return (
    <ShellErrorBoundary>
    <AuthGate>
    <AgencyHomeRedirect>
    <BillingLockGate>
    <TooltipProvider delayDuration={300}>
      <MemberSync />
      <ActiveOrgSync />
      <TimezoneSync />
      <LiveToasts />
      <FeatureGuard />
      <OrgTheme>
      {/* Paints the workspace's white-label palette onto :root. Renders
          nothing; a non-Max tier gets Pulse's own values back. */}
      <WhiteLabelTheme />
      {/* Engagement signal for the beta cohort. Renders nothing. */}
      <BetaLoginTracker />
      {/* pulse-hw switches on the hardware UI (src/app/hardware.css). */}
      <PageHeaderSlotProvider>
      <div className="pulse-hw relative min-h-dvh bg-ink">
        {/* Studio-light bloom - warm backdrop for the glass to refract */}
        <div className="app-bloom" aria-hidden />

        {/* Desktop rail: its own chassis on the void, 24px in from the edges
            (kit 6.1, measured from pulse-overview.png). */}
        <aside
          className={cn(
            "pl-card pl-side fixed! bottom-6 left-6 top-6 z-20 hidden lg:block",
            "transition-[width] duration-200 ease-out",
            navCollapsed ? "w-[4.5rem]" : "w-64",
          )}
        >
          <Brackets />
          <Sidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} />
        </aside>

        {/* Mobile nav drawer */}
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent width="sm" className="theme-dark-island material-regular lg:hidden">
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </Sheet>

        {/* Main column: the top bar chassis, then the page. The rail ends at
            280px; content starts at 282 like the kit (120 when folded). */}
        <div
          className={cn(
            "relative z-10 flex min-h-dvh flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] transition-[padding] duration-200 ease-out lg:pr-8 lg:pt-6",
            navCollapsed ? "lg:pl-[120px]" : "lg:pl-[282px]",
          )}
        >
          <StudioBanner />
          <BetaClockStarter />
          <BetaSignatureBanner />
            <BillingBanner />
          <Topbar onOpenMenu={() => setMobileNav(true)} />
          <main className="flex-1 pb-28 pt-6 lg:pb-8">
            <AppTransition>{children}</AppTransition>
          </main>
        </div>

        <BillingLock />
        <CommandPalette />
        <ClockWidget />
        <MobileTabBar onOpenMore={() => setMobileNav(true)} />
      </div>
      </PageHeaderSlotProvider>
      </OrgTheme>
    </TooltipProvider>
    </BillingLockGate>
    </AgencyHomeRedirect>
    </AuthGate>
    </ShellErrorBoundary>
  );
}
