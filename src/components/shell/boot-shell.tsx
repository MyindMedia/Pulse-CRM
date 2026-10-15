"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { activeNav } from "@/lib/nav";
import { useCollapsiblePanel } from "@/lib/use-collapsible-panel";
import { useBootSnapshotStore } from "@/lib/boot-snapshot";
import { PageHeaderSlotProvider, useSlotRef } from "@/components/shell/page-header-slot";
import { BaySkeleton, BootChassis } from "@/components/shell/boot-chassis";

export { BaySkeleton };

/* What a cold load shows while the session is being confirmed (Clerk, then
   the Convex socket) and the plan check answers, in place of the old
   full-screen logo loader.

   It is the real chassis (ShellFrame, so the swap to the live shell moves no
   pixels) painted in the studio's cached colors, with the dashboard the
   person saw last time rendered from the boot cache. The whole preview is
   `inert`: nothing in it can be clicked, focused or submitted, so no write
   can start before the session is confirmed. It is also server-rendered, so
   the chassis is on screen at first paint instead of after the JavaScript
   has downloaded; the cached figures fill in at hydration. */

// The dashboard body only loads on /dashboard, and only when there is a
// snapshot to render; every other route's first load stays as it was.
const BootDashboard = dynamic(() => import("@/components/dashboard/boot-dashboard"), {
  ssr: false,
  loading: () => <BaySkeleton />,
});

export function BootShell() {
  return (
    <PageHeaderSlotProvider>
      <BootShellBody />
    </PageHeaderSlotProvider>
  );
}

function BootShellBody() {
  const pathname = usePathname();
  const { collapsed } = useCollapsiblePanel("pulse:nav-collapsed");
  const store = useBootSnapshotStore();
  const snapshot = pathname === "/dashboard" && !!store?.hasData();
  const titleRef = useSlotRef("title");
  const actionsRef = useSlotRef("actions");
  return (
    <BootChassis
      collapsed={collapsed}
      title={activeNav(pathname)?.label ?? "Pulse"}
      titleRef={titleRef}
      actionsRef={actionsRef}
    >
      {snapshot ? <BootDashboard /> : undefined}
    </BootChassis>
  );
}
