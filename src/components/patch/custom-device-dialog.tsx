"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plus, Trash2, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EQUIPMENT_CATEGORIES } from "@/components/studio/constants";
import { CAPABILITIES, CONNECTORS, SIGNAL_LEVELS } from "./constants";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { Tooltip } from "@/components/ui/tooltip";

type DraftPort = {
  key: string;
  label: string;
  direction: "input" | "output" | "bidirectional";
  signalLevel: string;
  connector: string;
  capabilities: string[];
};

let portKey = 0;
const nextKey = () => `p${portKey++}`;

function blankPort(direction: DraftPort["direction"] = "input"): DraftPort {
  return {
    key: nextKey(),
    label: direction === "input" ? "In" : "Out",
    direction,
    signalLevel: "line",
    connector: "xlr",
    capabilities: [],
  };
}

/**
 * Build a device the library has never heard of. The PRD is explicit that
 * this has to be genuinely fast, ideally under a minute, because the seed
 * set will never cover a real studio's odd gear. So the quick-add row
 * matters more than the per-port editor: most gear is "8 mic inputs and
 * 8 line outputs" and that should be two clicks, not sixteen rows typed.
 */
export function CustomDeviceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (profileId: Id<"deviceProfiles">) => void;
}) {
  const createProfile = useMutation(api.patchManager.createProfile);

  const [name, setName] = React.useState("");
  const [manufacturer, setManufacturer] = React.useState("");
  const [category, setCategory] = React.useState("outboard");
  const [ports, setPorts] = React.useState<DraftPort[]>([blankPort("input"), blankPort("output")]);
  const [bulkCount, setBulkCount] = React.useState("8");
  const [saving, setSaving] = React.useState(false);

  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setName("");
      setManufacturer("");
      setCategory("outboard");
      setPorts([blankPort("input"), blankPort("output")]);
      setBulkCount("8");
    }
  }

  function addRun(direction: DraftPort["direction"], level: string, connector: string) {
    const count = Math.min(64, Math.max(1, Number(bulkCount) || 1));
    const prefix = direction === "input" ? "In" : "Out";
    setPorts((prev) => [
      ...prev,
      ...Array.from({ length: count }, (_, i) => ({
        key: nextKey(),
        label: `${prefix} ${i + 1}`,
        direction,
        signalLevel: level,
        connector,
        capabilities: level === "mic" && direction === "input" ? ["phantom", "pad"] : [],
      })),
    ]);
  }

  function update(key: string, patch: Partial<DraftPort>) {
    setPorts((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  async function submit() {
    if (!name.trim()) {
      toast.error("Give the device a name.");
      return;
    }
    if (ports.length === 0) {
      toast.error("A device needs at least one port.");
      return;
    }
    setSaving(true);
    try {
      const id = await createProfile({
        name: name.trim(),
        manufacturer: manufacturer.trim() || "Studio",
        category,
        portTemplate: ports.map((p, index) => ({
          label: p.label.trim() || `Port ${index + 1}`,
          direction: p.direction,
          signalLevel: p.signalLevel,
          connector: p.connector,
          channelIndex: index + 1,
          capabilities: p.capabilities,
        })) as never,
      });
      toast.success(`${name.trim()} added to your device library.`);
      onOpenChange(false);
      onCreated?.(id as Id<"deviceProfiles">);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save that device."));
    } finally {
      setSaving(false);
    }
  }

  const inputCount = ports.filter((p) => p.direction !== "output").length;
  const outputCount = ports.filter((p) => p.direction !== "input").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Build a custom device</DialogTitle>
          <DialogDescription>
            Anything the library does not carry. It stays in your studio&apos;s library for next time.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" htmlFor="cd-name" className="sm:col-span-2">
              <Input
                id="cd-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Custom 8-channel summing box"
                autoFocus
              />
            </Field>
            <Field label="Manufacturer" htmlFor="cd-mfr">
              <Input
                id="cd-mfr"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
                placeholder="Studio"
              />
            </Field>
          </div>

          <Field label="Category">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EQUIPMENT_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {/* The fast path. Most gear is runs of identical channels. */}
          <div className="rounded-chrome border border-hairline-2 bg-coal-2/50 p-3">
            <p className="overline mb-2 flex items-center gap-1.5">
              <Wand2 className="size-3" />
              Add a run of channels
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={1}
                max={64}
                value={bulkCount}
                onChange={(event) => setBulkCount(event.target.value)}
                className="h-8 w-16 text-xs"
                aria-label="How many channels"
              />
              <Tooltip label="Add mic inputs" hint="XLR, mic level, with phantom and pad switched on as capabilities.">
                <Button variant="secondary" size="sm" onClick={() => addRun("input", "mic", "xlr")}>
                  Mic inputs
                </Button>
              </Tooltip>
              <Tooltip label="Add line inputs" hint="Balanced TRS at line level.">
                <Button variant="secondary" size="sm" onClick={() => addRun("input", "line", "trs")}>
                  Line inputs
                </Button>
              </Tooltip>
              <Tooltip label="Add line outputs" hint="XLR at line level.">
                <Button variant="secondary" size="sm" onClick={() => addRun("output", "line", "xlr")}>
                  Line outputs
                </Button>
              </Tooltip>
              <Tooltip label="Add DB25 outputs" hint="One port per channel. A DB25 is one connector and eight ports.">
                <Button variant="secondary" size="sm" onClick={() => addRun("output", "line", "db25")}>
                  DB25 outputs
                </Button>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="overline">
              Ports · {inputCount} in, {outputCount} out
            </p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPorts((prev) => [...prev, blankPort("input")])}
              >
                <Plus className="size-3.5" />
                Input
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPorts((prev) => [...prev, blankPort("output")])}
              >
                <Plus className="size-3.5" />
                Output
              </Button>
            </div>
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {ports.map((port) => (
              <div
                key={port.key}
                className="grid grid-cols-[1fr_88px_92px_92px_auto] items-center gap-1.5 rounded-md border border-hairline bg-coal-2/40 p-1.5"
              >
                <Input
                  value={port.label}
                  onChange={(event) => update(port.key, { label: event.target.value })}
                  className="h-8 text-xs"
                  aria-label="Port label"
                />
                <Select
                  value={port.direction}
                  onValueChange={(value) =>
                    update(port.key, { direction: value as DraftPort["direction"] })
                  }
                >
                  <SelectTrigger className="h-8 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="input">Input</SelectItem>
                    <SelectItem value="output">Output</SelectItem>
                    <SelectItem value="bidirectional">Both</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={port.signalLevel}
                  onValueChange={(value) => update(port.key, { signalLevel: value })}
                >
                  <SelectTrigger className="h-8 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIGNAL_LEVELS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={port.connector}
                  onValueChange={(value) => update(port.key, { connector: value })}
                >
                  <SelectTrigger className="h-8 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONNECTORS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.short}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Tooltip label="Remove this port">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setPorts((prev) => prev.filter((p) => p.key !== port.key))}
                    aria-label={`Remove ${port.label}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </Tooltip>

                {/* Capability chips, on the port that has them. */}
                <div className="col-span-5 flex flex-wrap gap-1 pl-1">
                  {CAPABILITIES.map((capability) => {
                    const on = port.capabilities.includes(capability.value);
                    return (
                      <Tooltip
                        key={capability.value}
                        label={capability.label}
                        hint={capability.hint}
                      >
                      <button
                        type="button"
                        aria-label={capability.label}
                        aria-pressed={on}
                        onClick={() =>
                          update(port.key, {
                            capabilities: on
                              ? port.capabilities.filter((c) => c !== capability.value)
                              : [...port.capabilities, capability.value],
                          })
                        }
                        className={cn(
                          "rounded-[4px] border px-1.5 py-px font-meta text-[9px] font-semibold uppercase transition-colors",
                          on
                            ? "border-gold-dim/60 bg-gold/15 text-gold-bright"
                            : "border-graphite/50 text-steel hover:text-bone",
                        )}
                      >
                        {capability.short}
                      </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving" : "Save and place"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
