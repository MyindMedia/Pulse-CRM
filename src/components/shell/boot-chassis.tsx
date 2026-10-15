import * as React from "react";
import { Brackets } from "@/components/shell/page-header-slot";
import { ShellFrame } from "@/components/shell/shell-frame";

/* The boot preview's markup with no data and no app state: the chassis,
   skeleton rail, top bar and bay. Deliberately light (no nav table, no
   Convex, no cache) because the root loading boundary renders it on app
   routes, and that boundary ships with every page, public ones included.
   BootShell (boot-shell.tsx) fills the same frame with the cached dashboard.
   Icons are left out (empty keys of the same size) for the same reason. */

export function BootChassis({
  collapsed = false,
  title,
  titleRef,
  actionsRef,
  children,
}: {
  collapsed?: boolean;
  /** The nav label; a skeleton bar when unknown. */
  title?: string;
  titleRef?: (el: HTMLElement | null) => void;
  actionsRef?: (el: HTMLElement | null) => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <span role="status" className="sr-only">
        Opening your studio
      </span>
      <ShellFrame
        navCollapsed={collapsed}
        inert
        aria-hidden
        data-snapshot=""
        data-boot-shell=""
        rail={<BootRail collapsed={collapsed} />}
        topbar={<BootTopbar title={title} titleRef={titleRef} actionsRef={actionsRef} />}
        after={<BootTabBar />}
      >
        {children ?? <BaySkeleton />}
      </ShellFrame>
    </>
  );
}

function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={`block rounded-md bg-hairline-2/50 ${className ?? ""}`} />;
}

function BootRail({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <Bar className="h-8 w-28" />
      <div className="mt-4 flex flex-col gap-2.5">
        {Array.from({ length: 9 }, (_, i) => (
          <Bar key={i} className={collapsed ? "h-7 w-7" : "h-7 w-full"} />
        ))}
      </div>
    </div>
  );
}

/* The top bar chassis with the same slots the live one has, so the page's
   PageHeader (the greeting, the period keys) lands where it will stay. */
function BootTopbar({
  title,
  titleRef,
  actionsRef,
}: {
  title?: string;
  titleRef?: (el: HTMLElement | null) => void;
  actionsRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <header className="pl-card relative flex flex-wrap items-center gap-x-3 gap-y-3 px-4 py-3 lg:min-h-[76px] lg:flex-nowrap lg:gap-x-4 lg:px-6 lg:py-3">
      <Brackets />
      <span className="pl-icon-key grid lg:hidden">
        <span aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1 lg:max-w-[40%] lg:flex-initial">
        <div ref={titleRef} className="pl-title-slot" />
        <div className="pl-title-fallback min-w-0">
          {title ? (
            <h1 className="truncate font-sans text-[22px] font-extrabold leading-7 tracking-[-0.01em] text-bone lg:text-[26px] lg:leading-8">
              {title}
            </h1>
          ) : (
            <Bar className="h-7 w-40 lg:h-8" />
          )}
          <p className="truncate font-sans text-[11px] leading-4 text-steel">Updating</p>
        </div>
      </div>
      <span className="pl-search hidden min-w-[200px] flex-1 md:flex">
        <span aria-hidden className="size-4 shrink-0" />
        <span className="truncate">Search clients, sessions, invoices</span>
      </span>
      <div className="flex items-center gap-2 md:contents">
        <span className="pl-icon-key grid md:hidden">
          <span aria-hidden className="size-4" />
        </span>
        <span className="pl-icon-key grid" />
        {/* The account key's footprint: avatar and chevron, like ProfileMenu. */}
        <span className="pl-icon-key flex" data-wide="true">
          <span className="size-8 rounded-md bg-hairline-2/60" />
          <span aria-hidden className="size-3.5" />
        </span>
      </div>
      <div
        ref={actionsRef}
        className="pl-actions-slot order-last flex w-full flex-wrap items-center gap-2 lg:order-none lg:w-auto lg:flex-nowrap"
      />
    </header>
  );
}

function BootTabBar() {
  return (
    // Same element and classes as MobileTabBar, so Glass floats it the same way.
    <nav
      aria-label="Primary"
      className="theme-dark-island fixed inset-x-0 bottom-0 z-30 lg:hidden material-thick border-t border-hairline-2/60"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto min-h-[3.25rem] max-w-md" />
    </nav>
  );
}

/** The bay's shape with no data: the dashboard's first row of chassis. */
export function BaySkeleton() {
  return (
    <div aria-hidden className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-40">
        <div className="pl-card col-span-full min-h-[260px] opacity-60 xl:col-span-24" />
        <div className="pl-card col-span-full min-h-[260px] opacity-60 xl:col-span-16" />
      </div>
    </div>
  );
}
