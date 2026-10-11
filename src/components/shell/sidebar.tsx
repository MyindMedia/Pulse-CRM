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
import { Building2, GripVertical, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV, NAV_GROUPS, type NavGroup, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/lib/use-capabilities";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { Tooltip } from "@/components/ui/tooltip";
import { minTierFor } from "@convex/lib/entitlements";
import { PLAN_LIMITS, priceLabel, type CapabilityKey, type TierKey } from "@convex/lib/plans";

/* The sidebar is its own chassis (kit section 4, "Sidebar (web)"): the
 * logo with the signature's emboss and a short yellow bar, then the nav in
 * labelled sections. Each row is an LED and a name; the active row is a key
 * pushed into the panel, with yellow text and a lit LED. The plan sits in a
 * well under the nav. The chassis itself (ground, slabs, brackets) is drawn
 * by the layout's <aside>. */

/* Features this workspace has not bought yet.
 *
 * They are listed rather than hidden: a studio that cannot see Payroll exists
 * never asks for it. Each row is dimmed and carries the initial of the tier
 * that unlocks it (G for Growth, M for Max); the tooltip names the tier and
 * its price, so the upgrade decision is one click and zero questions. Rows
 * link to Settings > Billing, never to the feature itself - the route guard
 * and the server would both refuse anyway. A studio can hide the list from
 * Settings > Billing.
 *
 * Only tier locks appear here. A feature the agency switched off stays fully
 * hidden, because that is an operator decision, not a paywall. */
function LockedFeatures({ onNavigate }: { onNavigate?: () => void }) {
  const org = useQuery(api.orgs.current);
  const locked = org?.hideLockedFeatures ? [] : org?.tierLockedFeatures ?? [];
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
    <div>
      <p className="pl-label px-4 pb-2 pt-6">Locked on your plan</p>
      <ul className="space-y-0.5">
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
                href="/settings?tab=billing"
                onClick={onNavigate}
                data-locked="true"
                className="pl-nav-item group"
              >
                <span className="pl-led" aria-hidden />
                <span className="truncate">{item.label}</span>
                <TierBadge tier={need} />
              </Link>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* The small square on a locked row: the initial of the tier that unlocks it. */
function TierBadge({ tier }: { tier: TierKey | null }) {
  const label = tier ? PLAN_LIMITS[tier].label : null;
  return (
    <span
      className="ml-auto grid size-4 shrink-0 place-items-center rounded-[4px] border border-steel/30 font-grotesk text-[0.5625rem] font-bold leading-none text-steel/55 transition-colors group-hover:border-gold group-hover:text-gold"
      aria-label={label ? `Unlocks on ${label}` : "Not on your plan"}
    >
      {label ? label.charAt(0) : "?"}
    </span>
  );
}

/* The plan, in a well under the nav: the tier and how big the studio is. */
function PlanWell() {
  const org = useQuery(api.orgs.current);
  const rooms = useQuery(api.rooms.list);
  const staff = useQuery(api.members.list);
  if (!org?.tierLabel) return null;
  const size =
    rooms !== undefined && staff !== undefined
      ? `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}, ${staff.length} staff`
      : null;
  return (
    <div className="pl-well mx-4 mt-6 px-3 py-3">
      <p className="font-sans text-[10.5px] uppercase leading-[14px] tracking-[0.04em] text-steel">Plan</p>
      <p className="mt-0.5 font-sans text-[15px] font-bold leading-5 text-bone">{org.tierLabel}</p>
      {size && <p className="mt-0.5 font-sans text-xs leading-4 text-mist">{size}</p>}
    </div>
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
            data-active={active}
            className="pl-nav-item group justify-center px-0!"
          >
            <item.icon
              className={cn(
                "size-[1.1rem] shrink-0 transition-colors",
                active ? "text-gold" : "text-steel group-hover:text-bone",
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
      className={cn("group/row relative list-none", isDragging && "z-10 opacity-60")}
    >
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        data-active={active}
        className="pl-nav-item group pr-9!"
      >
        <span className="pl-led" data-on={active} aria-hidden />
        <span className="truncate">{item.label}</span>
      </Link>
      <button
        type="button"
        aria-label={`Reorder ${item.label}`}
        {...attributes}
        {...listeners}
        className={cn(
          "absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 cursor-grab touch-none place-items-center rounded text-steel/60 " +
            "pointer-events-none opacity-0 transition-opacity hover:text-steel active:cursor-grabbing " +
            "focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100",
        )}
      >
        <GripVertical className="size-3.5" />
      </button>
    </li>
  );
}

/** One labelled section of the nav. Rows reorder within their own section. */
function NavSection({
  group,
  label,
  items,
  pathname,
  collapsed,
  onNavigate,
  onReorder,
}: {
  group: NavGroup;
  label: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
  onReorder: (group: NavGroup, hrefs: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const hrefs = items.map((i) => i.href);
    onReorder(group, arrayMove(hrefs, hrefs.indexOf(String(active.id)), hrefs.indexOf(String(over.id))));
  }

  return (
    <div>
      {collapsed ? (
        <div className="mx-auto my-3 h-px w-6 bg-hairline" aria-hidden />
      ) : (
        <p className="pl-label px-4 pb-2 pt-6">{label}</p>
      )}
      {/* A stable id per section keeps dnd-kit's generated aria ids
          deterministic, so the server and client renders agree. */}
      <DndContext
        id={`sidebar-nav-${group}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.href)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {items.map((item) => (
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
    </div>
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
  // The console is the Pulse team's: the server also checks WHICH agency.
  const agencyAccess = useQuery(api.agency.access, kind === "agency_member" ? {} : "skip");
  const isAgencyViewer = kind === "agency_member" && agencyAccess?.allowed === true;
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

  const sections = React.useMemo(() => {
    const ordered = applyOrder(items, order);
    return NAV_GROUPS.map((g) => ({ ...g, items: ordered.filter((i) => i.group === g.key) })).filter(
      (g) => g.items.length > 0,
    );
  }, [items, order]);

  // A move inside one section: rebuild the whole saved order section by
  // section, so every other section keeps its arrangement.
  function handleReorder(group: NavGroup, hrefs: string[]) {
    const next = sections.flatMap((s) => (s.key === group ? hrefs : s.items.map((i) => i.href)));
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
    <div className="flex h-full flex-col">
      <div className={cn("shrink-0", collapsed ? "flex flex-col items-center gap-3 px-2 pt-6" : "px-[33px] pt-6")}>
        <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
          {collapsed ? (
            <Link href="/dashboard" aria-label="Home" className="pl-emboss block">
              <BrandLockup collapsed />
            </Link>
          ) : (
            <BrandLockup className="pl-emboss min-w-0 flex-1" wordmarkClassName="w-[100px] flex-none" />
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
                  "grid size-7 shrink-0 place-items-center rounded-[4px] text-steel transition-colors hover:bg-coal hover:text-bone",
                  !collapsed && "ml-auto",
                )}
              >
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
            </Tooltip>
          )}
        </div>
        {!collapsed && <span className="pl-bar mt-3 w-[72px]" aria-hidden />}
      </div>

      <nav className={cn("min-h-0 flex-1 overflow-y-auto pb-6", collapsed ? "px-2" : "px-[17px]")}>
        {sections.map((s) => (
          <NavSection
            key={s.key}
            group={s.key}
            label={s.label}
            items={s.items}
            pathname={pathname}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onReorder={handleReorder}
          />
        ))}

        {!collapsed && <LockedFeatures onNavigate={onNavigate} />}

        {isAgencyViewer &&
          (collapsed ? (
            <div className="mt-4">
              <Tooltip label="Agency console" side="right">
                <Link href="/agency" onClick={onNavigate} className="pl-nav-item group justify-center px-0!">
                  <Building2 className="size-[1.1rem] shrink-0 text-steel transition-colors group-hover:text-gold" />
                  <span className="sr-only">Agency console</span>
                </Link>
              </Tooltip>
            </div>
          ) : (
            <div className="mt-6 px-4">
              <Link
                href="/agency"
                onClick={onNavigate}
                data-variant="secondary"
                className="pl-key flex h-[34px] items-center justify-center gap-2 px-3"
              >
                <Building2 className="size-3.5 shrink-0" />
                Agency console
              </Link>
            </div>
          ))}

        {!collapsed && <PlanWell />}
      </nav>
    </div>
  );
}
