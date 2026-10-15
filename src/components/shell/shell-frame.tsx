import * as React from "react";
import { Brackets } from "@/components/shell/page-header-slot";
import { AmbientLight } from "@/components/shell/ambient-light";

/* The app chassis geometry, shared by the live shell (src/components/shell/
   app-shell.tsx) and the boot preview (boot-chassis.tsx), so the preview a
   cold load paints and the live app that replaces it sit on exactly the same
   pixels: no layout jump at the swap. Kit 6.1: a 232px rail 24px in from the
   edges, then the top bar and the page in the main column. Plain class
   strings (no cn helper): the root loading boundary renders this on every
   page, so it stays light. */
export function ShellFrame({
  navCollapsed,
  rail,
  banners,
  topbar,
  children,
  after,
  className,
  ...rest
}: {
  navCollapsed: boolean;
  rail: React.ReactNode;
  banners?: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
  after?: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div className={`pulse-hw relative min-h-dvh bg-ink${className ? ` ${className}` : ""}`} {...rest}>
      {/* Room light: dim warm pools drifting across the void */}
      <AmbientLight />

      {/* Desktop rail: its own chassis on the void, 24px in from the edges
          (kit 6.1, measured from pulse-overview.png). */}
      <aside
        className={`pl-card pl-side fixed! bottom-6 left-6 top-6 z-20 hidden lg:block transition-[width] duration-200 ease-out ${
          navCollapsed ? "w-[4.5rem]" : "w-[232px]"
        }`}
      >
        <Brackets />
        {rail}
      </aside>

      {/* Main column: the top bar chassis, then the page. Spec 6.1: a 232px
          rail and the same 24px gap as between chassis, so content starts at
          280 (120 when folded) and the rail's slabs never paint over it. */}
      <div
        className={`relative z-10 flex min-h-dvh flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] transition-[padding] duration-200 ease-out lg:pr-8 lg:pt-6 ${
          navCollapsed ? "lg:pl-[120px]" : "lg:pl-[280px]"
        }`}
      >
        {/* Shell notices get a solid backing, so their tints sit on the
            void and never on the room light. Empty when none show. */}
        <div className="mb-4 overflow-hidden rounded-chrome bg-ink empty:hidden">{banners}</div>
        {topbar}
        <main className="flex-1 pb-28 pt-6 lg:pb-8">
          {/* Module bay: every page sits in its own dark container, so the
              room light shows around it and never through a section. */}
          <div className="pl-bay">{children}</div>
        </main>
      </div>

      {after}
    </div>
  );
}
