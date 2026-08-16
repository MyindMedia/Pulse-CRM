"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
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

  const [seeded, setSeeded] = React.useState(port._id);
  if (seeded !== port._id) {
    setSeeded(port._id);
    setLabel(port.label);
  }

  async function save(patch: Record<string, unknown>) {
    try {
      await updatePort({ id: port._id as Id<"ports">, ...patch } as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that port.");
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
      toast.error(error instanceof Error ? error.message : "Could not remove that port.");
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-hairline bg-coal-2/40 p-2">
      <div className="flex items-center gap-1.5">
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
  ports,
  canEdit,
}: {
  deviceInstanceId: Id<"deviceInstances">;
  ports: PatchPort[];
  canEdit: boolean;
}) {
  const addPort = useMutation(api.patchManager.addPort);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const inputs = ports.filter((p) => p.direction === "input" || p.direction === "bidirectional");
  const outputs = ports.filter((p) => p.direction === "output" || p.direction === "bidirectional");

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
      toast.error(error instanceof Error ? error.message : "Could not add that port.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="overline">I/O</p>
        <span className="font-meta text-[9px] uppercase tracking-wide text-steel/70">
          {inputs.length} in · {outputs.length} out
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto font-meta text-[9px] uppercase tracking-wide text-steel transition-colors hover:text-gold"
        >
          {open ? "Done" : "Edit"}
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
              {inputs.map((port) => (
                <PortRow
                  key={port._id}
                  port={port}
                  canEdit={canEdit}
                  onDone={() => undefined}
                />
              ))}
            </div>
          )}

          {outputs.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-meta text-[9px] uppercase tracking-wider text-steel/60">
                Outputs
              </p>
              {outputs.map((port) => (
                <PortRow
                  key={port._id}
                  port={port}
                  canEdit={canEdit}
                  onDone={() => undefined}
                />
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={!canEdit || busy}
              onClick={() => void add("input")}
            >
              <Plus className="size-3.5" />
              Input
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              disabled={!canEdit || busy}
              onClick={() => void add("output")}
            >
              <Plus className="size-3.5" />
              Output
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
