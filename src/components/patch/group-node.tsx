"use client";

import * as React from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { zoneKind } from "./zone-kinds";

/* ============================================================
   A section on the patch canvas.

   The canvas equivalent of the strip of tape an engineer runs
   across the desk to mark off "monitor path" from "tracking
   path". It sits UNDER the gear, holds no ports and never
   reaches a run list.

   Two decisions are load-bearing:

   1. The body does not take pointer events. A section can be
      the size of a whole rack, and if its rectangle swallowed
      clicks you would lose marquee-select, right-click-to-add
      and pane panning across the biggest part of the canvas.
      Only the title tab is grabbable.
   2. Membership is geometric. Whatever sits inside the
      rectangle is in the section. Dragging the tab carries
      those devices along; drag one out and it is out. There is
      no membership to get out of step with where things are.
   ============================================================ */

/* Six colours, matching the sticky notes so the canvas has one colour
   vocabulary rather than two. The fill is deliberately a fifth of the way
   to the colour and no further: a section is often the size of a whole
   rack, and a solid pad that big stops being a background and starts
   competing with the gear standing on it. */
export const GROUP_COLORS = [
  { key: "amber", label: "Amber", fill: "#fdb9131f", border: "#8a6b1f", tab: "#4a3a17", text: "#f6dfa4" },
  { key: "green", label: "Green", fill: "#3ddc911c", border: "#2f6b45", tab: "#1a3b27", text: "#b8ecc9" },
  { key: "blue", label: "Blue", fill: "#5db4ff1c", border: "#2f5d8a", tab: "#1a2f44", text: "#bfdcf6" },
  { key: "red", label: "Red", fill: "#ff5d5d1c", border: "#7d3434", tab: "#412020", text: "#f4c3c3" },
  { key: "violet", label: "Violet", fill: "#c39bff1c", border: "#5b3f80", tab: "#332545", text: "#dcc9f6" },
  { key: "slate", label: "Slate", fill: "#8b8b951c", border: "#4a4e57", tab: "#26282f", text: "#d3d6dc" },
] as const;

export function groupColor(key: string) {
  return GROUP_COLORS.find((c) => c.key === key) ?? GROUP_COLORS[0];
}

/** Room for a couple of racks. A section you immediately have to resize is friction. */
export const GROUP_DEFAULT_SIZE = { width: 640, height: 420 };

/** Breathing room left around the selection when a section is drawn around it. */
export const GROUP_PADDING = { x: 36, y: 56 };

/** The class React Flow drags a section by. Only the title tab carries it. */
export const GROUP_DRAG_HANDLE = "patch-group-handle";

/**
 * What is plugged in inside a zone, and what leaves it.
 *
 * `leaving` is the number that matters in a multi-room studio: a run with
 * one end in here and the other end somewhere else has to physically cross
 * a wall, which means a tie line and a panel, not a patch cord.
 */
export type ZoneStatus = {
  devices: number;
  ports: number;
  patched: number;
  free: number;
  /** Runs with exactly one end inside this zone. */
  leaving: number;
  /** Of those, the ones that already run through a wall panel. */
  onTieLines: number;
};

export type GroupNodeData = {
  name: string;
  kind: string;
  color: string;
  width: number;
  height: number;
  /** Where things are, counted on the canvas rather than stored. */
  status: ZoneStatus;
  /** Room this zone stands for, resolved for display. Null when unbound. */
  roomName: string | null;
  canEdit: boolean;
  onRename: (name: string) => void;
};

export const GroupNode = React.memo(function GroupNode({
  data,
  selected,
}: NodeProps & { data: GroupNodeData }) {
  const palette = groupColor(data.color);
  const kind = zoneKind(data.kind);
  const KindIcon = kind.icon;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(data.name);

  // Re-seed when the stored name changes underneath, but never mid-type.
  const [seeded, setSeeded] = React.useState(data.name);
  if (!editing && seeded !== data.name) {
    setSeeded(data.name);
    setDraft(data.name);
  }

  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== data.name) data.onRename(next);
    else setDraft(data.name);
  }

  return (
    <>
      <NodeResizer
        isVisible={!!selected && data.canEdit}
        minWidth={160}
        minHeight={120}
        lineClassName="!border-transparent"
        // The wrapper refuses pointer events so the section cannot swallow
        // the canvas underneath it; the resize handles have to opt back in.
        handleClassName="!pointer-events-auto !size-2.5 !rounded-[2px] !border !border-white/40 !bg-white/70"
      />

      <div
        className={cn(
          "pointer-events-none relative rounded-[14px] border transition-colors",
          selected && "border-2",
        )}
        style={{
          width: data.width,
          height: data.height,
          background: palette.fill,
          borderColor: selected ? "var(--color-gold)" : palette.border,
        }}
      >
        {/* The title tab. Everything interactive about a section lives here:
            it is the only part that can be grabbed, clicked, renamed or
            right-clicked, which is what keeps the canvas underneath usable. */}
        <div
          className={cn(
            GROUP_DRAG_HANDLE,
            "nopan pointer-events-auto absolute -top-[13px] left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5",
            "rounded-t-[8px] rounded-b-[3px] border px-2 py-[3px] shadow-elev-2",
            data.canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          )}
          style={{
            background: palette.tab,
            borderColor: selected ? "var(--color-gold)" : palette.border,
            color: palette.text,
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (data.canEdit) setEditing(true);
          }}
        >
          <KindIcon className="size-3 shrink-0 opacity-80" />
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") commit();
                if (event.key === "Escape") {
                  setDraft(data.name);
                  setEditing(false);
                }
              }}
              className="nodrag w-40 bg-transparent text-[11px] font-semibold leading-tight outline-none"
              style={{ color: palette.text }}
            />
          ) : (
            <span className="truncate text-[11px] font-semibold leading-tight">
              {data.name}
            </span>
          )}

          {/* Two numbers, because two questions get asked of a zone all day:
              how much of it is in use, and how much of it has to reach
              another room. Everything else is in the properties panel. */}
          {data.status.ports > 0 && (
            <Tooltip
              label={`${data.status.patched} of ${data.status.ports} connectors in use`}
              hint={
                data.status.leaving > 0
                  ? `${data.status.leaving} run${data.status.leaving === 1 ? "" : "s"} cross the edge of this zone${
                      data.status.onTieLines > 0
                        ? `, ${data.status.onTieLines} of them on tie lines`
                        : " with no tie line recorded"
                    }.`
                  : "Nothing patched here leaves the zone."
              }
            >
              <span className="shrink-0 cursor-help font-meta text-[9px] uppercase tracking-wide opacity-70">
                {data.status.patched}/{data.status.ports}
                {data.status.leaving > 0 && ` · ${data.status.leaving} out`}
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </>
  );
});
