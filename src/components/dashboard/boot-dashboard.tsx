"use client";

import { BootMode, SnapshotBoundary } from "@/lib/boot-snapshot";
import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { BaySkeleton } from "@/components/shell/boot-chassis";

/* The dashboard as this person last saw it, rendered from the boot cache by
   the real dashboard components (so the live swap is a value change, not a
   layout change). Boot mode skips every live query; the boot shell around it
   is inert. A cache the current code cannot render falls back to the plain
   skeleton and is dropped. */
export default function BootDashboard() {
  return (
    <BootMode>
      <SnapshotBoundary fallback={<BaySkeleton />}>
        <DashboardHome />
      </SnapshotBoundary>
    </BootMode>
  );
}
