"use client";

import * as React from "react";
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, LayoutGrid, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Section } from "@/components/ui/page";
import { ArrivalPrepCard } from "@/components/dashboard/arrival-prep-card";
import { useOptionalUser } from "@/lib/use-optional-clerk";
import {
  type DashboardLayout,
  hideKey,
  normalizeLayout,
  reorderVisible,
  showKey,
  visibleKeys,
} from "@/lib/dashboard-layout";
import {
  DASHBOARD_WIDGETS,
  DEFAULT_HIDDEN,
  SPAN_CLASS,
  WIDGET_KEYS,
  type DashboardWidgetDef,
} from "@/components/dashboard/widget-registry";

const BY_KEY = new Map(DASHBOARD_WIDGETS.map((w) => [w.key, w]));

/** One tile in edit mode: drag anywhere on the frame to reorder; the X hides
 *  it. The widget's own controls are inert while editing so drags can't
 *  accidentally click into charts or buttons. */
function SortableWidget({
  def,
  onRemove,
}: {
  def: DashboardWidgetDef;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: def.key,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        SPAN_CLASS[def.span],
        "relative cursor-grab rounded-chrome ring-1 ring-gold/40 ring-offset-2 ring-offset-ink",
        isDragging && "z-20 cursor-grabbing opacity-80 shadow-elev-4",
      )}
      {...attributes}
      {...listeners}
    >
      <div className="pointer-events-none select-none">
        {def.titled === false ? def.render() : <Section title={def.title}>{def.render()}</Section>}
      </div>
      <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-gold/40 bg-coal-2/95 px-1.5 py-0.5 font-meta text-[0.625rem] uppercase tracking-wide text-gold backdrop-blur">
        <GripVertical className="size-3" />
        {def.title}
      </span>
      <button
        type="button"
        aria-label={`Remove ${def.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        className="absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-md border border-graphite/60 bg-coal-2/95 text-steel backdrop-blur transition-colors hover:border-critical/50 hover:text-critical"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The customizable dashboard grid. Widgets come from the registry; the user's
 * order + hidden set persists per user (same localStorage pattern as the
 * sidebar's nav order). Customize -> drag tiles to reorder, X to remove,
 * Add widget to bring anything back, Reset for the default layout.
 */
export function CustomizableDashboard() {
  const { user } = useOptionalUser();
  const storageKey = `pulse:dash-layout:${user?.id ?? "anon"}`;

  const [layout, setLayout] = React.useState<DashboardLayout>(() =>
    normalizeLayout(null, WIDGET_KEYS, DEFAULT_HIDDEN),
  );
  const [editing, setEditing] = React.useState(false);

  // Hydrate the saved layout after mount (matches the sidebar pattern so the
  // first paint agrees with the server render).
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setLayout(
        normalizeLayout(raw ? (JSON.parse(raw) as Partial<DashboardLayout>) : null, WIDGET_KEYS, DEFAULT_HIDDEN),
      );
    } catch {
      setLayout(normalizeLayout(null, WIDGET_KEYS, DEFAULT_HIDDEN));
    }
  }, [storageKey]);

  const apply = (next: DashboardLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage unavailable - layout still applies for this session */
    }
  };

  const visible = visibleKeys(layout);
  const hiddenDefs = layout.hidden
    .map((k) => BY_KEY.get(k))
    .filter((w): w is DashboardWidgetDef => Boolean(w));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = arrayMove(visible, visible.indexOf(String(active.id)), visible.indexOf(String(over.id)));
    apply(reorderVisible(layout, next));
  }

  return (
    <div className="space-y-4">
      {/* Layout toolbar */}
      <div className="flex items-center justify-end gap-2">
        {editing ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={hiddenDefs.length === 0}>
                  <Plus className="size-3.5" />
                  Add widget
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Available widgets</DropdownMenuLabel>
                {hiddenDefs.map((w) => (
                  <DropdownMenuItem key={w.key} onSelect={() => apply(showKey(layout, w.key))}>
                    <div className="min-w-0">
                      <p className="text-sm text-bone">{w.title}</p>
                      <p className="truncate text-xs text-steel/70">{w.blurb}</p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                try {
                  localStorage.removeItem(storageKey);
                } catch {
                  /* nothing to clear */
                }
                setLayout(normalizeLayout(null, WIDGET_KEYS, DEFAULT_HIDDEN));
              }}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
            <Button size="sm" onClick={() => setEditing(false)}>
              <Check className="size-3.5" />
              Done
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <LayoutGrid className="size-3.5" />
            Customize layout
          </Button>
        )}
      </div>

      {/* PINNED: Arrival prep always leads the dashboard - the front desk's
          next-client alert + checklist stays above every custom layout. */}
      <Section title="Arrival prep">
        <ArrivalPrepCard />
      </Section>

      {/* The grid */}
      {editing ? (
        <DndContext
          id="dashboard-tiles"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={visible} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {visible.map((key) => {
                const def = BY_KEY.get(key);
                if (!def) return null;
                return <SortableWidget key={key} def={def} onRemove={() => apply(hideKey(layout, key))} />;
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((key) => {
            const def = BY_KEY.get(key);
            if (!def) return null;
            return (
              <div key={key} className={SPAN_CLASS[def.span]}>
                {def.titled === false ? def.render() : <Section title={def.title}>{def.render()}</Section>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
