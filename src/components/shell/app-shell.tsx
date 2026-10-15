"use client";

import { useEffect, useState } from "react";
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
import { GlobalSessionSheet } from "@/components/shell/global-session-sheet";
import { GlobalInvoiceModal } from "@/components/shell/global-invoice-modal";
import { ClockWidget } from "@/components/timeclock/clock-widget";
import { MobileTabBar } from "@/components/shell/mobile-tabbar";
import { FeatureGuard } from "@/components/shell/feature-guard";
import { OrgTheme } from "@/components/shell/org-theme";
import { AppTransition } from "@/components/shell/app-motion";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShellErrorBoundary } from "@/components/shell/shell-error-boundary";
import { PageHeaderSlotProvider } from "@/components/shell/page-header-slot";
import { ShellFrame } from "@/components/shell/shell-frame";
import { BootRecorder } from "@/components/shell/boot-recorder";
import { BootSnapshotProvider } from "@/lib/boot-snapshot";

/* The authenticated app's shell: the gates (session, agency redirect, plan),
   the live theme layers and the chassis. While a gate holds, each one shows
   the boot preview (boot-shell.tsx) instead of a blank loader. */
export function AppShell({ children }: { children: React.ReactNode }) {
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
    <BootSnapshotProvider>
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
      {/* Records this studio's theme and dashboard for the next cold load,
          and hands first paint back from the cached theme. Renders nothing. */}
      <BootRecorder />
      {/* Engagement signal for the beta cohort. Renders nothing. */}
      <BetaLoginTracker />
      {/* pulse-hw switches on the hardware UI (src/app/hardware.css). */}
      <PageHeaderSlotProvider>
      <ShellFrame
        navCollapsed={navCollapsed}
        rail={<Sidebar collapsed={navCollapsed} onToggleCollapsed={toggleNav} />}
        banners={
          <>
            <StudioBanner />
            <BetaClockStarter />
            <BetaSignatureBanner />
            <BillingBanner />
          </>
        }
        topbar={<Topbar onOpenMenu={() => setMobileNav(true)} />}
        after={
          <>
            {/* Mobile nav drawer */}
            <Sheet open={mobileNav} onOpenChange={setMobileNav}>
              <SheetContent width="sm" placement="side" className="theme-dark-island material-regular lg:hidden">
                <Sidebar onNavigate={() => setMobileNav(false)} />
              </SheetContent>
            </Sheet>
            <BillingLock />
            <CommandPalette />
            <GlobalSessionSheet />
            <GlobalInvoiceModal />
            <ClockWidget />
            <MobileTabBar onOpenMore={() => setMobileNav(true)} />
          </>
        }
      >
        <AppTransition>{children}</AppTransition>
      </ShellFrame>
      </PageHeaderSlotProvider>
      </OrgTheme>
    </TooltipProvider>
    </BillingLockGate>
    </AgencyHomeRedirect>
    </AuthGate>
    </BootSnapshotProvider>
    </ShellErrorBoundary>
  );
}
