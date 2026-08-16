"use client";

import * as React from "react";
import { useMutation } from "convex/react";
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { FileSearch, GripVertical, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { orderAfterDrag } from "./port-order";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { connectorMeta, levelMeta } from "./constants";
import type { PatchPort } from "./device-node";
import { SpecSheetDialog } from "./spec-sheet-dialog";

/* ============================================================
   Adding and correcting the jacks on a placed device.

   Ports are copied onto a device when it is placed, never read
   live from a shared template - so editing here changes THIS
   unit in THIS room and cannot rewrite a patch someone else
   documented. That is the whole reason the copy exists, and it
   is what makes hand-editing safe enough to offer.
   ============================================================ */

/** The connectors worth offering, newest vocabulary only. */
const CONNECTORS = [
  "xlr3",
  "xlr5",
  "trs",
  "ts",
  "trs_mini",
  "bantam",
  "db25",
  "speakon",
  "banana",
  "rca",
  "bnc",
  "wordclock_bnc",
  "midi_din",
  "rj45",
  "usb_a",
  "usb_b",
  "usb_b_mini",
  "usb_b_micro",
  "usb_c",
  "thunderbolt",
  "adat_optical",
  "spdif_optical",
  "spdif_coax",
] as const;

const LEVELS = ["mic", "line", "instrument", "speaker", "digital", "control"] as const;

/** A sensible starting point per direction, so adding a jack is one click. */
const DEFAULTS = {
  input: { connector: "xlr3", signalLevel: "mic", label: "Input" },
  output: { connector: "trs", signalLevel: "line", label: "Output" },
} as const;

function PortRow({
  port,
  canEdit,
  onDone,
}: {
  port: PatchPort;
  canEdit: boolean;
  onDone: () => void;
}) {
  const updatePort = useMutation(api.patchManager.updatePort);
  const removePort = useMutation(api.patchManager.removePort);
  const [label, setLabel] = React.useState(port.label);

  // The row drags by its grip only. Dragging from the label field would
  // fight the caret, and dragging from a select would eat the click.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: port._id,
    disabled: !canEdit,
  });

  const [seeded, setSeeded] = React.useState(port._id);
  if (seeded !== port._id) {
    setSeeded(port._id);
    setLabel(port.label);
  }

  async function save(patch: Record<string, unknown>) {
    try {
      await updatePort({ id: port._id as Id<"ports">, ...patch } as never);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save that port."));
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Remove ${port.label}? Any cable patched into it is pulled at the same time.`,
      )
    ) {
      return;
    }
    try {
      await removePort({ id: port._id as Id<"ports"> });
      onDone();
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove that port."));
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "space-y-1.5 rounded-md border border-hairline bg-coal-2/40 p-2",
        isDragging && "z-10 opacity-70 shadow-elev-2",
      )}
    >
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`Reorder ${port.label}`}
          disabled={!canEdit}
          {...attributes}
          {...listeners}
          className={cn(
            "shrink-0 cursor-grab touch-none rounded p-0.5 text-steel/50",
            "transition-colors hover:text-steel active:cursor-grabbing",
            "disabled:cursor-default disabled:opacity-40",
          )}
        >
          <GripVertical className="size-3.5" />
        </button>
        <Input
          value={label}
          disabled={!canEdit}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => {
            const next = label.trim();
            if (!next) {
              setLabel(port.label);
              return;
            }
            if (next !== port.label) void save({ label: next });
          }}
          className="h-7 flex-1 text-[11px]"
          placeholder="Mic In 1"
        />
        <Tooltip label="Remove this port">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!canEdit}
            aria-label={`Remove ${port.label}`}
            onClick={remove}
            className="shrink-0 text-steel hover:text-critical"
          >
            <X className="size-3.5" />
          </Button>
        </Tooltip>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Select
          value={port.connector}
          disabled={!canEdit}
          onValueChange={(value) => void save({ connector: value })}
        >
          <SelectTrigger className="h-7 text-[10px]" aria-label="Connector">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONNECTORS.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {connectorMeta(c).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={port.signalLevel}
          disabled={!canEdit}
          onValueChange={(value) => void save({ signalLevel: value })}
        >
          <SelectTrigger className="h-7 text-[10px]" aria-label="Signal level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l} className="text-xs">
                {levelMeta(l).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function PortEditor({
  deviceInstanceId,
  deviceLabel,
  ports,
  canEdit,
  hasPanelPhoto,
}: {
  deviceInstanceId: Id<"deviceInstances">;
  deviceLabel: string;
  ports: PatchPort[];
  canEdit: boolean;
  hasPanelPhoto: boolean;
}) {
  const addPort = useMutation(api.patchManager.addPort);
  const reorderPorts = useMutation(api.patchManager.reorderPorts);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  // Open by default. The whole reason this exists is that a device's I/O is
  // often wrong on arrival, so hiding the fix behind a disclosure just makes
  // people believe the wrong list.
  const [open, setOpen] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const inputs = ports.filter((p) => p.direction === "input" || p.direction === "bidirectional");
  const outputs = ports.filter((p) => p.direction === "output" || p.direction === "bidirectional");

  const sensors = useSensors(
    // A few pixels of slop so a click on the grip still reads as a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /*
   * Order is one sequence across the whole device, so a drag has to send
   * every port back, exactly once.
   *
   * Concatenating the two columns does NOT do that: a bidirectional jack -
   * a word clock socket, an RJ45, anything that is both - appears in the
   * inputs list AND the outputs list, so joining them sends it twice and
   * the server rightly refuses the whole ordering. Rebuilding from the real
   * port list instead guarantees a permutation whatever a jack's direction.
   */
  async function onDragEnd(event: DragEndEvent, group: "inputs" | "outputs") {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const orderedIds = orderAfterDrag(ports, group, String(active.id), String(over.id));

    try {
      await reorderPorts({
        deviceInstanceId,
        orderedIds: orderedIds as Id<"ports">[],
      });
    } catch (error) {
      toast.error(errorMessage(error, "Could not reorder those."));
    }
  }

  async function add(direction: "input" | "output") {
    setBusy(true);
    try {
      const preset = DEFAULTS[direction];
      // Number the new jack after the ones already facing that way, so a
      // second input lands as "Input 2" rather than a duplicate name.
      const siblings = direction === "input" ? inputs.length : outputs.length;
      await addPort({
        deviceInstanceId,
        label: `${preset.label} ${siblings + 1}`,
        direction,
        signalLevel: preset.signalLevel,
        connector: preset.connector,
        capabilities: [],
      });
    } catch (error) {
      toast.error(errorMessage(error, "Could not add that port."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="overline">Inputs &amp; outputs</p>
        <span className="font-meta text-[9px] uppercase tracking-wide text-steel/70">
          {inputs.length} in · {outputs.length} out
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto font-meta text-[9px] uppercase tracking-wide text-steel transition-colors hover:text-gold"
        >
          {open ? "Hide" : "Edit I/O"}
        </button>
      </div>

      {open && (
        <>
          <p className="text-[10px] leading-snug text-steel/80">
            These jacks belong to this unit in this room. Editing them cannot change
            another studio&apos;s patch.
          </p>

          {ports.length === 0 && (
            <p className="rounded-md border border-caution/30 bg-caution/10 px-2.5 py-2 text-[11px] text-caution">
              This device has no ports yet. Add the jacks that are on its panel.
            </p>
          )}

          {inputs.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-meta text-[9px] uppercase tracking-wider text-steel/60">
                Inputs
              </p>
              {/* A stable id keeps dnd-kit's generated aria ids deterministic;
                  without one the counter differs between the server and the
                  client render and React reports a hydration mismatch. */}
              <DndContext
                id="patch-port-inputs"
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => void onDragEnd(event, "inputs")}
              >
                <SortableContext
                  items={inputs.map((p) => p._id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1.5">
                    {inputs.map((port) => (
                      <PortRow
                        key={port._id}
                        port={port}
                        canEdit={canEdit}
                        onDone={() => undefined}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {outputs.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-meta text-[9px] uppercase tracking-wider text-steel/60">
                Outputs
              </p>
              {/* A stable id keeps dnd-kit's generated aria ids deterministic;
                  without one the counter differs between the server and the
                  client render and React reports a hydration mismatch. */}
              <DndContext
                id="patch-port-outputs"
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => void onDragEnd(event, "outputs")}
              >
                <SortableContext
                  items={outputs.map((p) => p._id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1.5">
                    {outputs.map((port) => (
                      <PortRow
                        key={port._id}
                        port={port}
                        canEdit={canEdit}
                        onDone={() => undefined}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* Reading the manual beats typing twenty jacks by hand, so this
              sits above the manual add buttons rather than under them. */}
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            disabled={!canEdit}
            onClick={() => setSheetOpen(true)}
          >
            <FileSearch className="size-3.5" />
            Configure from a spec sheet
          </Button>

          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={!canEdit || busy}
              onClick={() => void add("input")}
            >
              <Plus className="size-3.5" />
              Add input
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={!canEdit || busy}
              onClick={() => void add("output")}
            >
              <Plus className="size-3.5" />
              Add output
            </Button>
          </div>

          <SpecSheetDialog
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            deviceInstanceId={deviceInstanceId}
            deviceLabel={deviceLabel}
            ports={ports}
            hasPanelPhoto={hasPanelPhoto}
          />
        </>
      )}
    </div>
  );
}
