"use client";

import { AppShell } from "@/components/shell/app-shell";

/* The authenticated app. The shell lives in src/components/shell/app-shell.tsx;
   this layout stays a synchronous client component on purpose: an async
   layout here suspends under the root loading boundary, and the full-screen
   logo loader would flash before the shell on every cold load. Who is signed
   in (for the boot cache) comes down from the root layout, which awaits it
   anyway. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
