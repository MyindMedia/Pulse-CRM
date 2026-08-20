"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { useOptionalUser } from "@/lib/use-optional-clerk";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@convex/_generated/api";
import { Building2, GripVertical, Lock, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/lib/use-capabilities";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { PoweredByPulse } from "@/components/brand/powered-by-pulse";
import { Tooltip } from "@/components/ui/tooltip";
import { minTierFor } from "@convex/lib/entitlements";
import { PLAN_LIMITS, priceLabel, type CapabilityKey } from "@convex/lib/plans";

/* The rail mark. On the Label (white-label) tier this is the studio's own
 * logo with "Powered by Pulse" underneath; every tier below renders the Pulse
 * wordmark. BrandLockup owns that decision so both branches stay in one place. */
function Wordmark() {
  return <BrandLockup />;
}

/* Features this workspace has not bought yet.
 *
 * They are listed rather than hidden: a studio that cannot see Payroll exists
 * never asks for it. Each row names the tier that unlocks it and its price, so
 * the upgrade decision is one click and zero questions. Rows are inert links
 * to Settings, never to the feature itself - the route guard and the server
 * would both refuse anyway.
 *
 * Only tier locks appear here. A feature the agency switched off stays fully
 * hidden, because that is an operator decision, not a paywall. */
function LockedFeatures({ onNavigate }: { onNavigate?: () => void }) {
  const org = useQuery(api.orgs.current);
  const locked = org?.tierLockedFeatures ?? [];
  const agencyOff = React.useMemo(
    () => new Set((org?.disabledFeatures ?? []).filter((k) => !locked.includes(k))),
    [org?.disabledFeatures, locked],
  );

  const rows = React.useMemo(() => {
    return NAV.filter(
      (item) => item.feature && locked.includes(item.feature) && !agencyOff.has(item.feature),
    ).map((item) => {
      const need = minTierFor(item.feature as CapabilityKey);
      return { item, need };
    });
  }, [locked, agencyOff]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-3 px-2">
      <p className="px-1 font-meta text-[0.5625rem] uppercase tracking-[0.12em] text-steel/50">
        Locked on your plan
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {rows.map(({ item, need }) => (
          <li key={item.href} className="list-none">
            <Tooltip
              label={
                need
                  ? `${PLAN_LIMITS[need].label} (${priceLabel(need)}/mo) unlocks ${item.label}`
                  : `${item.label} is not on your plan`
              }
              side="right"
            >
              <Link
                href="/settings"
                onClick={onNavigate}
                className="group flex min-h-9 items-center gap-3 rounded-chrome px-3 py-1.5 font-meta text-[0.7rem] uppercase tracking-[0.04em] text-steel/45 transition-colors hover:bg-coal/40 hover:text-steel"
              >
                <item.icon className="size-[1.1rem] shrink-0 text-steel/35 transition-colors group-hover:text-steel/60" />
                <span className="truncate">{item.label}</span>
                <Lock className="ml-auto size-3 shrink-0 text-steel/35 transition-colors group-hover:text-gold" />
              </Link>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Footer credit. A white-labeled workspace shows its own name here, with the
 * Powered by Pulse line kept underneath - the lockup is a condition of the
 * tier, not a toggle. */
function SidebarCredit() {
  const org = useQuery(api.orgs.current);
  const theme = useQuery(api.theme.get);
  if (theme?.active) {
    return (
      <>
        <p className="chrome-meta text-steel/80">
          {theme.appName || org?.name || "Studio"}
        </p>
        <PoweredByPulse className="mt-0.5" size="xs" />
      </>
    );
  }
  return (
    <>
      <p className="chrome-meta text-steel/80">Pulse by Myind Sound</p>
      <p className="mt-0.5 font-meta text-[0.625rem] text-steel/60">
        {org?.tierLabel ? `v1.0 · ${org.tierLabel}` : "v1.0 · Studio edition"}
      </p>
    </>
  );
}

/** Apply a saved order (list of hrefs) to the visible nav items. Items not in
    the saved order keep their default NAV position and sort after known ones. */
function applyOrder(items: NavItem[], order: string[] | null): NavItem[] {
  if (!order || order.length === 0) return items;
  const rank = new Map(order.map((href, i) => [href, i]));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.href) ? rank.get(a.href)! : Number.POSITIVE_INFINITY;
    const rb = rank.has(b.href) ? rank.get(b.href)! : Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return NAV.indexOf(a) - NAV.indexOf(b);
  });
}

/** A single draggable nav row: the link navigates, the grip handle drags. */
function SortableNavItem({
  item,
  active,
  onNavigate,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.href,
    // There is nowhere to grab in a 72px rail, and reordering something you
    // cannot read the name of is not a thing anyone wants to do.
    disabled: collapsed,
  });

  // Collapsed, the icon has to carry the whole meaning, so the name it lost
  // comes back as a tooltip rather than disappearing.
  if (collapsed) {
    return (
      <li ref={setNodeRef} className="list-none">
        <Tooltip label={item.label} side="right">
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-h-11 items-center justify-center rounded-chrome border transition-colors duration-200 ease-out active:scale-[0.98]",
              active
                ? "border-gold/50 bg-gold/12 text-bone"
                : "border-transparent text-steel hover:bg-coal/60 hover:text-bone",
            )}
          >
            <item.icon
              className={cn(
                "size-[1.15rem] shrink-0 transition-colors",
                active ? "text-gold" : "text-steel/70 group-hover:text-steel",
              )}
            />
            <span className="sr-only">{item.label}</span>
          </Link>
        </Tooltip>
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative list-none", isDragging && "z-10 opacity-60")}
    >
      <div
        className={cn(
          "group flex min-h-11 items-center gap-2 rounded-chrome pr-1.5 font-meta text-[0.7rem] uppercase tracking-[0.04em] " +
            "transition-[background-color,color,border-color] duration-200 ease-out border",
          active
            ? "border-gold/50 bg-gold/12 text-bone"
            : "border-transparent text-steel hover:bg-coal/60 hover:text-bone",
        )}
      >
        <Link
          href={item.href}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 active:scale-[0.98]"
        >
          <item.icon
            className={cn(
              "size-[1.1rem] shrink-0 transition-colors",
              active ? "text-gold" : "text-steel/70 group-hover:text-steel",
            )}
          />
          <span className="truncate">{item.label}</span>
        </Link>
        {active && (
          <span className="size-1.5 shrink-0 rounded-full bg-gold transition-opacity group-hover:opacity-0" />
        )}
        <button
          type="button"
          aria-label={`Reorder ${item.label}`}
          {...attributes}
          {...listeners}
          className={cn(
            "absolute right-1.5 grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-steel/50 " +
              "pointer-events-none opacity-0 transition-opacity hover:text-steel active:cursor-grabbing " +
              "focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
          )}
        >
          <GripVertical className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: {
  onNavigate?: () => void;
  /** Desktop rail only. The mobile drawer always renders in full. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const pathname = usePathname();
  const { user } = useOptionalUser();
  const { can, loaded: capsLoaded, kind } = useCapabilities();
  // Agency mode is for AGENCY members only - sub-account (studio) users must
  // never see the console entry. `kind` comes from the server's resolveViewer
  // (agency_member vs studio_member), and stays null while loading so the
  // link never flashes for a studio viewer. Route access is enforced
  // server-side regardless; this hides the door.
  const isAgencyViewer = kind === "agency_member";
  // Hide nav features the agency has disabled for this sub-account, and items
  // the viewer's role can't access (financials/exec/settings). Capability-gated
  // items stay hidden until caps load so a lower tier never sees them flash.
  const org = useQuery(api.orgs.current);
  const disabledFeatures = org?.disabledFeatures;
  const items = React.useMemo(() => {
    const disabled = new Set(disabledFeatures ?? []);
    return NAV.filter((item) => {
      if (item.feature && disabled.has(item.feature)) return false;
      if (item.capability && (!capsLoaded || !can(item.capability))) return false;
      return true;
    });
  }, [disabledFeatures, can, capsLoaded]);

  // Per-user nav order, persisted in localStorage. Null until hydrated so the
  // first paint matches the server (default NAV order) and avoids a mismatch.
  const storageKey = user ? `pulse:nav-order:${user.id}` : null;
  const [order, setOrder] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      setOrder(raw ? (JSON.parse(raw) as string[]) : null);
    } catch {
      setOrder(null);
    }
  }, [storageKey]);

  const ordered = React.useMemo(() => applyOrder(items, order), [items, order]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const hrefs = ordered.map((i) => i.href);
    const next = arrayMove(hrefs, hrefs.indexOf(String(active.id)), hrefs.indexOf(String(over.id)));
    setOrder(next);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage full or unavailable - order still applies for this session */
      }
    }
  }

  return (
    <div className={cn("flex h-full flex-col gap-6 py-5", collapsed && "gap-4")}>
      <div
        className={cn(
          "flex items-center gap-2",
          collapsed ? "flex-col px-2" : "px-4",
        )}
      >
        {collapsed ? (
          <Link href="/dashboard" aria-label="Home" className="block">
            <BrandLockup collapsed />
          </Link>
        ) : (
          <Wordmark />
        )}
        {onToggleCollapsed && (
          <Tooltip
            label={collapsed ? "Expand navigation" : "Collapse navigation"}
            shortcut="cmd+\\"
            side="right"
          >
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!collapsed}
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-chrome border border-transparent text-steel/70",
                "transition-colors hover:border-hairline-2 hover:bg-coal/60 hover:text-bone",
                !collapsed && "ml-auto",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </button>
          </Tooltip>
        )}
      </div>

      <nav className={cn("min-h-0 flex-1 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
        {/* A stable id keeps dnd-kit's generated aria ids deterministic. Without
            it the counter differs between the server render and the client one
            and React reports a hydration mismatch on every nav item. */}
        <DndContext
          id="sidebar-nav"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ordered.map((i) => i.href)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5">
              {ordered.map((item) => (
                <SortableNavItem
                  key={item.href}
                  item={item}
                  active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  onNavigate={onNavigate}
                  collapsed={collapsed}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </nav>

      <div className={cn("space-y-3", collapsed ? "px-2" : "px-3")}>
        {isAgencyViewer &&
          (collapsed ? (
            <Tooltip label="Agency console" side="right">
              <Link
                href="/agency"
                onClick={onNavigate}
                className="group flex items-center justify-center rounded-chrome border border-graphite/60 bg-coal/40 py-2 text-steel transition-colors hover:border-gold hover:text-bone"
              >
                <Building2 className="size-[1.1rem] shrink-0 text-steel/70 transition-colors group-hover:text-gold" />
                <span className="sr-only">Agency console</span>
              </Link>
            </Tooltip>
          ) : (
            <Link
              href="/agency"
              onClick={onNavigate}
              className="group flex items-center gap-3 rounded-chrome border border-graphite/60 bg-coal/40 px-3 py-2 font-meta text-[0.7rem] uppercase tracking-[0.04em] text-steel transition-colors hover:border-gold hover:text-bone"
            >
              <Building2 className="size-[1.1rem] shrink-0 text-steel/70 transition-colors group-hover:text-gold" />
              Agency console
            </Link>
          ))}
        {!collapsed && <LockedFeatures onNavigate={onNavigate} />}
        {!collapsed && (
          <div className="px-2">
            <SidebarCredit />
          </div>
        )}
      </div>
    </div>
  );
}
