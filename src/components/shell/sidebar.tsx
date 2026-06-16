"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { useUser } from "@clerk/nextjs";
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
import { Building2, GripVertical } from "lucide-react";
import { NAV, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { PulseLogo } from "@/components/brand/pulse-logo";

/* The Pulse wordmark - the official gold pulse glyph + "PULSE" lockup.
 * Stretches across the full sidebar rail. */
function Wordmark() {
  // Two-thirds of the rail width - the source PNG is tightly cropped, so the
  // height follows automatically (h-auto on the img).
  return (
    <div className="w-2/3">
      <PulseLogo size="full" className="block" />
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
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.href,
  });

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

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useUser();
  // Hide nav features the agency has disabled for this sub-account.
  const org = useQuery(api.orgs.current);
  const disabledFeatures = org?.disabledFeatures;
  const items = React.useMemo(() => {
    const disabled = new Set(disabledFeatures ?? []);
    return NAV.filter((item) => !item.feature || !disabled.has(item.feature));
  }, [disabledFeatures]);

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
    <div className="flex h-full flex-col gap-6 py-5">
      <div className="px-4">
        <Wordmark />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ordered.map((i) => i.href)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-0.5">
              {ordered.map((item) => (
                <SortableNavItem
                  key={item.href}
                  item={item}
                  active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </nav>

      <div className="space-y-3 px-3">
        <Link
          href="/agency"
          onClick={onNavigate}
          className="group flex items-center gap-3 rounded-chrome border border-graphite/60 bg-coal/40 px-3 py-2 font-meta text-[0.7rem] uppercase tracking-[0.04em] text-steel transition-colors hover:border-gold hover:text-bone"
        >
          <Building2 className="size-[1.1rem] shrink-0 text-steel/70 transition-colors group-hover:text-gold" />
          Agency console
        </Link>
        <div className="px-2">
          <p className="chrome-meta text-steel/80">Pulse by Myind Sound</p>
          <p className="mt-0.5 font-meta text-[0.625rem] text-steel/60">v1.0 · Studio edition</p>
        </div>
      </div>
    </div>
  );
}
