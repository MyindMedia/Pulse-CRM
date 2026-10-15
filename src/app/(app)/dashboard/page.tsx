"use client";

import { DashboardHome } from "@/components/dashboard/dashboard-home";

/* The page body lives in src/components/dashboard/dashboard-home.tsx so the
   boot preview (src/components/shell/boot-shell.tsx) can render the same
   component from the cached snapshot while the session is confirmed. */
export default function DashboardPage() {
  return <DashboardHome />;
}
