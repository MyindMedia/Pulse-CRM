"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ExternalLink, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { Field, Input, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { categoryMeta } from "@/components/studio/constants";
import { capabilityMeta, connectorMeta, levelMeta } from "./constants";
import type { PatchPort } from "./device-node";

export type EditableDevice = {
  _id: Id<"deviceInstances">;
  label: string;
  notes?: string;
  normalling?: string;
  category: string;
  manufacturer: string;
  phantomSensitive: boolean;
  ports: PatchPort[];
  equipment: { _id: Id<"equipment">; name: string; serialNumber: string | null } | null;
};

type PaletteRow = {
  _id: Id<"equipment">;
  name: string;
  category: string;
  available: number;
};

/**
 * Edit a placed device from any list, not only by selecting it on the
 * canvas. A row you can read but not change sends people back to the
 * canvas to hunt for the same box they are already looking at.
 */
export function DeviceEditDialog({
  device,
  patchSpaceId,
  onOpenChange,
  canEdit,
}: {
  device: EditableDevice | null;
  patchSpaceId: Id<"patchSpaces">;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}) {
  const updateDevice = useMutation(api.patchManager.updateDevice);
  const removeDevice = useMutation(api.patchManager.removeDevice);
  const setPortState = useMutation(api.patchManager.setPortState);

  // Only needed when the device is unlinked, so it can be pointed at a
  // real asset without leaving the list.
  const palette = useQuery(
    api.patchManager.palette,
    device && !device.equipment ? { patchSpaceId, scope: "all" } : "skip",
  ) as PaletteRow[] | undefined;

  const [label, setLabel] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const [seed, setSeed] = React.useState<string | null>(null);
  if (device && device._id !== seed) {
    setSeed(device._id);
    setLabel(device.label);
    setNotes(device.notes ?? "");
  }

  if (!device) return null;
  const meta = categoryMeta(device.category);
  const isPatchbay = device.category === "patchbay";
  const togglable = device.ports.filter((p) => p.capabilities.length > 0);

  async function save() {
    if (!device) return;
    if (!label.trim()) {
      toast.error("A device needs a name.");
      return;
    }
    setSaving(true);
    try {
      await updateDevice({ id: device._id, label: label.trim(), notes });
      toast.success("Saved.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!device) return;
    if (!window.confirm(`Remove ${device.label} and pull every cable on it?`)) return;
    try {
      await removeDevice({ id: device._id });
      toast.success(`${device.label} removed.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove.");
    }
  }

  return (
    <Dialog open={!!device} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <meta.icon className="size-4 shrink-0 text-gold" />
            {device.label}
          </DialogTitle>
          <DialogDescription>
            {device.manufacturer || meta.label}
            {device.equipment?.serialNumber ? ` · ${device.equipment.serialNumber}` : ""}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {device.equipment ? (
            <Link
              href="/inventory"
              className="flex items-center gap-2 rounded-md border border-hairline-2 bg-coal-2/60 px-2.5 py-2 transition-colors hover:border-gold-dim/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-meta text-[9px] uppercase tracking-wide text-steel">
                  Inventory asset
                </span>
                <span className="block truncate text-xs text-bone">{device.equipment.name}</span>
              </span>
              <ExternalLink className="size-3 shrink-0 text-steel" />
            </Link>
          ) : (
            <Field
              label="Link to inventory"
              hint="This device is a sketch. Point it at a real asset so the patch map and the asset register agree."
            >
              <Select
                value="none"
                onValueChange={async (value) => {
                  if (value === "none") return;
                  try {
                    await updateDevice({
                      id: device._id,
                      equipmentId: value as Id<"equipment">,
                    });
                    toast.success("Linked to inventory.");
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Could not link that.",
                    );
                  }
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {(palette ?? [])
                    .filter((row) => row.available > 0)
                    .map((row) => (
                      <SelectItem key={row._id} value={row._id}>
                        {row.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Label">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={!canEdit}
              placeholder="Rack 2 - Neve 1073 #3"
            />
          </Field>

          {isPatchbay && (
            <Field
              label="Normalling"
              hint="Recorded on the bay and printed on the patch list. Implied normal connections are not drawn on the canvas yet."
            >
              <Select
                value={device.normalling ?? "none"}
                onValueChange={async (value) => {
                  try {
                    await updateDevice({
                      id: device._id,
                      normalling: value as "full" | "half" | "none",
                    });
                  } catch {
                    toast.error("Could not change normalling.");
                  }
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full normal</SelectItem>
                  <SelectItem value="half">Half normal</SelectItem>
                  <SelectItem value="none">Open (non-normalled)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={!canEdit}
              placeholder="Channel 2 intermittent. Do not repatch without telling Marcus."
              className="min-h-16"
            />
          </Field>

          {togglable.length > 0 && (
            <div className="space-y-2">
              <p className="overline">Port controls</p>
              {device.phantomSensitive && (
                <p className="flex items-start gap-1.5 rounded-md border border-caution/30 bg-caution/10 px-2 py-1.5 text-[10px] text-caution">
                  <Zap className="mt-px size-3 shrink-0" />
                  This device is phantom sensitive. 48V can damage it.
                </p>
              )}
              <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                {togglable.map((port) => (
                  <div
                    key={port._id}
                    className="flex items-center gap-2 rounded-md border border-hairline bg-coal-2/40 px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-bone">{port.label}</span>
                      <span
                        className="block font-meta text-[9px] uppercase tracking-wide"
                        style={{ color: levelMeta(port.signalLevel).color }}
                      >
                        {levelMeta(port.signalLevel).short} ·{" "}
                        {connectorMeta(port.connector).short}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      {port.capabilities
                        .filter((c) => c !== "impedance")
                        .map((capability) => {
                          const on =
                            port.state[capability as keyof PatchPort["state"]] === true;
                          return (
                            <button
                              key={capability}
                              type="button"
                              disabled={!canEdit}
                              title={capabilityMeta(capability).label}
                              onClick={async () => {
                                try {
                                  await setPortState({
                                    id: port._id as Id<"ports">,
                                    [capability]: !on,
                                  } as never);
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error ? error.message : "Could not change.",
                                  );
                                }
                              }}
                              className={cn(
                                "rounded-[4px] border px-1.5 py-0.5 font-meta text-[9px] font-semibold uppercase transition-colors disabled:opacity-40",
                                on
                                  ? capability === "phantom"
                                    ? "border-caution/50 bg-caution/20 text-caution"
                                    : "border-gold-dim/60 bg-gold/15 text-gold-bright"
                                  : "border-graphite/50 text-steel hover:text-bone",
                              )}
                            >
                              {capabilityMeta(capability).short}
                            </button>
                          );
                        })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter className="justify-between">
          {canEdit ? (
            <Button variant="danger" size="sm" onClick={remove}>
              <Trash2 className="size-3.5" />
              Remove from canvas
            </Button>
          ) : (
            <Badge tone="caution">Read only</Badge>
          )}
          <span className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {canEdit && (
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving" : "Save changes"}
              </Button>
            )}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
