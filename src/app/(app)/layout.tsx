"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useCollapsiblePanel } from "@/lib/use-collapsible-panel";
import { Sidebar } from "@/components/shell/sidebar";
import { WhiteLabelTheme } from "@/components/shell/white-label-theme";
import { BetaLoginTracker } from "@/components/shell/beta-login-tracker";
import { Topbar } from "@/components/shell/topbar";
import { StudioBanner } from "@/components/shell/studio-banner";
import { BillingBanner, BillingLock } from "@/components/shell/billing-gate";
import { MemberSync } from "@/components/shell/member-sync";
import { ActiveOrgSync } from "@/components/shell/active-org-sync";
import { TimezoneSync } from "@/components/shell/timezone-sync";
import { AuthGate } from "@/components/shell/auth-gate";
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
    <TooltipProvider delayDuration={300}>
      <MemberSync />
      <ActiveOrgSync />
      <TimezoneSync />
      <LiveToasts />
      <FeatureGuard />
      <OrgTheme>
      {/* Paints the workspace's white-label palette onto :root. Renders
          nothing; a non-Label tier gets Pulse's own values back. */}
      <WhiteLabelTheme />
      {/* Engagement signal for the beta cohort. Renders nothing. */}
      <BetaLoginTracker />
      <div className="relative min-h-dvh bg-ink">
        {/* Studio-light bloom - warm backdrop for the glass to refract */}
        <div className="app-bloom" aria-hidden />

        {/* Desktop rail - stays dark in light mode (dark chrome). */}
        <aside
          className={cn(
            "theme-dark-island fixed inset-y-0 left-0 z-20 hidden material-regular lg:block",
            "transition-[width] duration-200 ease-out",
            navCollapsed ? "w-[4.5rem]" : "w-64",
          )}
        >
          <Sidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} />
        </aside>

        {/* Mobile nav drawer */}
        <Sheet open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent width="sm" className="theme-dark-island material-regular lg:hidden">
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </Sheet>

        {/* Main column */}
        <div
          className={cn(
            "relative z-10 flex min-h-dvh flex-col transition-[padding] duration-200 ease-out",
            navCollapsed ? "lg:pl-[4.5rem]" : "lg:pl-64",
          )}
        >
          <StudioBanner />
          <BillingBanner />
          <Topbar onOpenMenu={() => setMobileNav(true)} />
          <main className="flex-1 px-4 py-6 pb-28 lg:px-8 lg:py-8 lg:pb-8">
            <AppTransition>{children}</AppTransition>
          </main>
        </div>

        <BillingLock />
        <CommandPalette />
        <ClockWidget />
        <MobileTabBar onOpenMore={() => setMobileNav(true)} />
      </div>
      </OrgTheme>
    </TooltipProvider>
    </AuthGate>
    </ShellErrorBoundary>
  );
}
