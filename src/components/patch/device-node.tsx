"use client";

import * as React from "react";
import { Handle, Position, useConnection, type NodeProps } from "@xyflow/react";
import { AlertTriangle, ChevronDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { categoryMeta } from "@/components/studio/constants";
import {
  PATCH_CATEGORY_ICONS,
  PORT_COLLAPSE_LIMIT,
  capabilityMeta,
  connectorMeta,
  levelMeta,
} from "./constants";

export type PatchPort = {
  _id: string;
  label: string;
  direction: "input" | "output" | "bidirectional";
  signalLevel: string;
  connector: string;
  channelIndex?: number;
  capabilities: string[];
  state: {
    phantom?: boolean;
    pad?: boolean;
    polarity?: boolean;
    monoSum?: boolean;
    hpf?: boolean;
    impedance?: string;
  };
  bayRow?: "top" | "bottom";
  bayColumn?: number;
};

export type DeviceNodeData = {
  label: string;
  category: string;
  manufacturer: string;
  phantomSensitive: boolean;
  rackUnits?: number;
  ports: PatchPort[];
  /** Port ids with something patched into or out of them. */
  connectedPorts: Set<string>;
  equipment: {
    _id: string;
    name: string;
    serialNumber: string | null;
    condition: string | null;
    quantity: number;
  } | null;
  /** Photo of this unit, or of the model, resolved server-side. */
  photoUrl: string | null;
  /** True when the photo is of this unit rather than the catalog shot. */
  photoIsOwn: boolean;
  /** Dims everything not on the traced signal path. */
  traceDimmed: boolean;
  onOpenPort?: (portId: string) => void;
};

/** How this port relates to a cable currently being dragged. */
type DragRole = "idle" | "origin" | "target" | "incompatible";

/** One port row with its connection jack. */
function PortRow({
  port,
  side,
  connected,
  dragRole,
  onOpen,
}: {
  port: PatchPort;
  side: "left" | "right";
  connected: boolean;
  dragRole: DragRole;
  onOpen?: () => void;
}) {
  const level = levelMeta(port.signalLevel);
  const connector = connectorMeta(port.connector);
  const active = Object.entries(port.state).filter(([, value]) =>
    typeof value === "boolean" ? value : !!value,
  );

  // Phantom on a port is worth shouting about. Everything else is a quiet chip.
  const phantomOn = port.state.phantom === true;

  const others = active.filter(([key]) => key !== "phantom");

  return (
    <Tooltip
      side={side === "left" ? "left" : "right"}
      label={port.label}
      hint={
        <>
          {level.label} · {connector.label}
          {connected ? " · patched" : " · nothing plugged in"}
          {active.length > 0 && (
            <>
              <br />
              {active.map(([k]) => capabilityMeta(k).label).join(", ")} on
            </>
          )}
        </>
      }
    >
    <div
      className={cn(
        "group/port relative flex items-center gap-1 px-2 py-[3px] text-[10px] leading-tight",
        "cursor-crosshair transition-[background-color,opacity] hover:bg-gold/[0.07]",
        side === "right" && "flex-row-reverse text-right",
        dragRole === "target" && "bg-gold/[0.12]",
        dragRole === "incompatible" && "opacity-30",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.();
      }}
    >
      {/* The connector jack.
          The Handle is the WHOLE PORT ROW, not the dot. A 12px dot renders
          about four pixels across at the zoom a whole room is viewed at,
          which is not a target anyone can hit with a mouse. Grabbing
          anywhere on the row starts the cable; the dot is only the thing
          you look at. React Flow anchors the edge to the handle's centre,
          so the row is given the jack's own position explicitly. */}
      <Handle
        id={port._id}
        type={side === "left" ? "target" : "source"}
        position={side === "left" ? Position.Left : Position.Right}
        className={cn(
          "!absolute !inset-0 !h-auto !w-auto !min-w-0 !translate-x-0 !translate-y-0",
          "!rounded-none !border-0 !bg-transparent",
          "hover:!cursor-crosshair",
        )}
        // The visual dot sits on the card edge, so the edge must attach
        // there rather than to the middle of the row.
        style={{
          transform: "none",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
        }}
      />

      {/* The visible dot. Purely decorative: pointer events belong to the
          strip above so the two can never disagree about where the jack is. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 z-[6] size-3 -translate-y-1/2 rounded-full border-2 border-coal",
          "transition-[transform,box-shadow,opacity] duration-150",
          "group-hover/port:scale-[1.55]",
          side === "left" ? "-left-[6px]" : "-right-[6px]",
          dragRole === "target" && "scale-[1.7] animate-pulse",
          dragRole === "incompatible" && "opacity-20",
          dragRole === "origin" && "scale-[1.7]",
        )}
        style={{
          background: connected ? level.color : "#4a4a52",
          boxShadow:
            dragRole === "target"
              ? `0 0 0 4px ${level.color}55, 0 0 12px ${level.color}`
              : connected
                ? `0 0 0 2px ${level.color}22`
                : undefined,
        }}
      />

      {/* Level is carried by a colour bar rather than a text chip. It reads
          instantly and costs no horizontal room, which is what the label
          needs: a port called "Mic In 1" must never render as "M..". */}
      <span
        className="h-2.5 w-[2px] shrink-0 rounded-full"
        style={{ background: level.color, opacity: connected ? 1 : 0.4 }}
      />

      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium",
          connected ? "text-bone" : "text-ash",
        )}
      >
        {port.label}
      </span>

      {phantomOn && (
        <span className="shrink-0 rounded-[3px] bg-caution/25 px-1 font-meta text-[8px] font-semibold text-caution">
          48V
        </span>
      )}
      {/* Only the first extra toggle gets a chip. The rest are a count, so a
          port with four things switched on cannot squeeze out its own name. */}
      {others.slice(0, 1).map(([key]) => (
        <span
          key={key}
          className="shrink-0 rounded-[3px] bg-coal-3 px-1 font-meta text-[8px] font-semibold text-steel"
        >
          {capabilityMeta(key).short}
        </span>
      ))}
      {others.length > 1 && (
        <span className="shrink-0 font-meta text-[8px] font-semibold text-steel">
          +{others.length - 1}
        </span>
      )}
    </div>
    </Tooltip>
  );
}

export const DeviceNode = React.memo(function DeviceNode({
  id,
  data,
  selected,
}: NodeProps & { data: DeviceNodeData }) {
  const [expanded, setExpanded] = React.useState(false);

  // While a cable is being dragged, every port on every card has to say
  // whether it is somewhere this cable can land. Guessing, dragging, and
  // getting a rejected connection is how people stop trusting a canvas.
  const connection = useConnection();
  const dragging = connection.inProgress;
  const fromHandleId = connection.fromHandle?.id ?? null;
  const fromNodeId = connection.fromNode?.id ?? null;

  const roleFor = React.useCallback(
    (port: PatchPort): DragRole => {
      if (!dragging) return "idle";
      if (port._id === fromHandleId) return "origin";
      // React Flow drags source to target, so a drag that started at an
      // output can only land on an input, and never back on its own device.
      const isOutput = port.direction === "output" || port.direction === "bidirectional";
      const isInput = port.direction === "input" || port.direction === "bidirectional";
      const startedAtOutput = connection.fromHandle?.type === "source";
      const wants = startedAtOutput ? isInput : isOutput;
      if (!wants || fromNodeId === id) return "incompatible";
      return "target";
    },
    [dragging, fromHandleId, fromNodeId, connection.fromHandle?.type, id],
  );

  const inputs = data.ports.filter(
    (p) => p.direction === "input" || p.direction === "bidirectional",
  );
  const outputs = data.ports.filter(
    (p) => p.direction === "output" || p.direction === "bidirectional",
  );

  const total = data.ports.length;
  const collapsible = total > PORT_COLLAPSE_LIMIT;
  // A collapsed card hides ports. During a drag that is a dead end, so
  // the card opens itself for the duration.
  const showAll = expanded || !collapsible || dragging;

  // When collapsed, lead with the ports that actually have cable on them.
  // A 96-point bay with four things patched should show those four.
  const trim = (list: PatchPort[]) => {
    if (showAll) return list;
    const connected = list.filter((p) => data.connectedPorts.has(p._id));
    const rest = list.filter((p) => !data.connectedPorts.has(p._id));
    return [...connected, ...rest].slice(0, Math.ceil(PORT_COLLAPSE_LIMIT / 2));
  };

  const shownInputs = trim(inputs);
  const shownOutputs = trim(outputs);
  const hidden = total - shownInputs.length - shownOutputs.length;

  const meta = categoryMeta(data.category);
  const Icon = PATCH_CATEGORY_ICONS[data.category] ?? meta.icon ?? Package;

  return (
    <div
      className={cn(
        "w-[264px] overflow-hidden rounded-chrome border bg-coal/95 backdrop-blur-sm",
        "transition-[border-color,box-shadow,opacity] duration-150",
        selected
          ? "border-gold shadow-[0_0_0_1px_var(--color-gold),0_12px_32px_-12px_rgba(253,185,19,0.45)]"
          : "border-hairline-2 shadow-elev-2 hover:border-gold-dim/70",
        data.traceDimmed && "opacity-25",
        // A card with nowhere for this cable to land gets out of the way.
        dragging && fromNodeId === id && "ring-1 ring-gold/40",
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-hairline bg-coal-2/80 px-2.5 py-2">
        {/* A photo of the real unit beats an icon for finding the right box in
            a dark rack, so it takes the icon's slot when one exists. */}
        {data.photoUrl ? (
          <Tooltip
            label={data.photoIsOwn ? "Photo of this unit" : "Catalog photo"}
            hint={
              data.photoIsOwn
                ? "Taken in this room. Shown on the card so the map matches the rack."
                : "From the inventory record. Add a photo of the actual unit in the properties panel."
            }
          >
            <img
              src={data.photoUrl}
              alt=""
              draggable={false}
              className={cn(
                "mt-px size-7 shrink-0 cursor-help rounded-[5px] border object-cover",
                data.photoIsOwn ? "border-gold-dim/60" : "border-hairline-2",
              )}
            />
          </Tooltip>
        ) : (
          <Icon className="mt-px size-3.5 shrink-0 text-gold" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-semibold leading-tight text-bone">
            {data.label}
          </p>
          <p className="truncate font-meta text-[9px] uppercase tracking-wide text-steel">
            {data.manufacturer || meta.label}
            {data.equipment?.serialNumber ? ` · ${data.equipment.serialNumber}` : ""}
          </p>
        </div>
        {data.phantomSensitive && (
          <Tooltip
            label="Phantom sensitive"
            hint="A ribbon or similar. 48V arriving down the cable can destroy it."
          >
            <span className="cursor-help">
              <AlertTriangle className="mt-px size-3 shrink-0 text-caution" />
            </span>
          </Tooltip>
        )}
        {/* A sketched device is worth flagging, but quietly. A loud badge on
            most cards trains the eye to ignore it. */}
        {!data.equipment && (
          <Tooltip
            label="Not in inventory"
            hint="A sketched device. Link it to a gear asset so the patch map and the asset register agree."
          >
            <span className="mt-1 size-1.5 shrink-0 cursor-help rounded-full bg-caution/70" />
          </Tooltip>
        )}
      </div>

      {/* Ports, inputs left and outputs right */}
      <div className="grid grid-cols-2 gap-x-1 py-1">
        <div className="min-w-0 border-r border-hairline">
          {shownInputs.length > 0 && (
            <p className="px-2 pb-0.5 pt-1 font-meta text-[8px] uppercase tracking-wider text-steel/60">
              In
            </p>
          )}
          {shownInputs.map((port) => (
            <PortRow
              key={port._id}
              port={port}
              side="left"
              connected={data.connectedPorts.has(port._id)}
              dragRole={roleFor(port)}
              onOpen={() => data.onOpenPort?.(port._id)}
            />
          ))}
        </div>
        <div className="min-w-0">
          {shownOutputs.length > 0 && (
            <p className="px-2 pb-0.5 pt-1 text-right font-meta text-[8px] uppercase tracking-wider text-steel/60">
              Out
            </p>
          )}
          {shownOutputs.map((port) => (
            <PortRow
              key={port._id}
              port={port}
              side="right"
              connected={data.connectedPorts.has(port._id)}
              dragRole={roleFor(port)}
              onOpen={() => data.onOpenPort?.(port._id)}
            />
          ))}
        </div>
      </div>

      {collapsible && (
        <Tooltip
          label={expanded ? "Show fewer ports" : "Show every port"}
          hint={
            expanded
              ? undefined
              : "Collapsed cards lead with the ports that have cable on them."
          }
        >
        <button
          type="button"
          aria-label={expanded ? "Collapse ports" : `Show ${hidden} more ports`}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          className="flex w-full items-center justify-center gap-1 border-t border-hairline bg-coal-2/60 py-1 font-meta text-[9px] uppercase tracking-wide text-steel transition-colors hover:bg-coal-3 hover:text-bone"
        >
          <ChevronDown className={cn("size-2.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? "Collapse" : `${hidden} more port${hidden === 1 ? "" : "s"}`}
        </button>
        </Tooltip>
      )}
    </div>
  );
});
