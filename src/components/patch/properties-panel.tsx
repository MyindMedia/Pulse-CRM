"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Cable,
  ExternalLink,
  MousePointerSquareDashed,
  Trash2,
  Unplug,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { categoryMeta } from "@/components/studio/constants";
import { Tooltip } from "@/components/ui/tooltip";
import { capabilityMeta, connectorMeta, levelMeta } from "./constants";
import { CableColorField } from "./cable-color-field";
import { CableLabelFields, type CableLabelMode } from "./cable-label-fields";
import { PanelCollapseButton } from "./panel-rail";
import { NOTE_COLORS } from "./note-node";
import { PhotoUpload } from "@/components/ui/photo-upload";
import type { PatchPort } from "./device-node";

type DeviceSelection = {
  kind: "device";
  _id: Id<"deviceInstances">;
  label: string;
  notes?: string;
  normalling?: string;
  category: string;
  manufacturer: string;
  phantomSensitive: boolean;
  ports: PatchPort[];
  photoUrl: string | null;
  photoIsOwn: boolean;
  equipment: { _id: Id<"equipment">; name: string; serialNumber: string | null } | null;
  /** port id -> label of the phantom-sensitive device currently patched into it. */
  phantomRiskByPort: Record<string, string>;
};

type ConnectionSelection = {
  kind: "connection";
  _id: Id<"connections">;
  cableId?: Id<"equipment">;
  cableTag?: string;
  cableLabelMode?: CableLabelMode;
  cableTagSource?: string;
  cableTagTarget?: string;
  cableColor?: string;
  cableLengthFt?: number;
  notes?: string;
  sourceLabel: string;
  targetLabel: string;
};

type NoteSelection = {
  kind: "note";
  _id: Id<"patchAnnotations">;
  text: string;
  color: string;
};

export type PatchSelection = DeviceSelection | ConnectionSelection | NoteSelection | null;

/**
 * Impedance is a setting, not a switch, so it cycles through values rather
 * than flipping a boolean. Sending `true` here would fail server validation,
 * which is what a boolean-only toggle used to do on every press.
 */
const IMPEDANCE_CYCLE: (string | undefined)[] = [undefined, "hi-z", "lo-z", "1.2k", "300"];

function nextImpedance(current: string | undefined): string | undefined {
  const index = IMPEDANCE_CYCLE.findIndex((value) => value === current);
  return IMPEDANCE_CYCLE[(index + 1) % IMPEDANCE_CYCLE.length];
}

/** One hardware toggle, rendered only when the profile declares it. */
function PortToggle({
  port,
  capability,
  phantomRisk,
  disabled,
}: {
  port: PatchPort;
  capability: string;
  /** Label of the phantom-sensitive device this port currently feeds, if any. */
  phantomRisk: string | null;
  disabled?: boolean;
}) {
  const setPortState = useMutation(api.patchManager.setPortState);
  const [pending, setPending] = React.useState(false);
  const meta = capabilityMeta(capability);

  const isImpedance = capability === "impedance";
  const impedanceValue = port.state.impedance;
  const on = isImpedance
    ? !!impedanceValue
    : port.state[capability as keyof PatchPort["state"]] === true;

  // Phantom power travels down the cable into whatever is plugged in. The
  // thing at risk is the microphone on the other end, not this preamp, so
  // the warning has to follow the connection rather than read a flag on the
  // device being edited.
  const risky = capability === "phantom" && !!phantomRisk && !on;

  async function toggle() {
    if (
      risky &&
      !window.confirm(
        `${phantomRisk} is patched into this input and is flagged phantom sensitive. ` +
          "Sending 48V can permanently damage a ribbon microphone. Turn it on anyway?",
      )
    ) {
      return;
    }
    setPending(true);
    try {
      if (isImpedance) {
        await setPortState({ id: port._id as Id<"ports">, impedance: nextImpedance(impedanceValue) });
      } else {
        await setPortState({ id: port._id as Id<"ports">, [capability]: !on } as never);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change that.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Tooltip
      label={
        <span className={risky ? "text-critical" : undefined}>
          {meta.label}
          {!isImpedance && (on ? " · on" : " · off")}
          {isImpedance && impedanceValue ? ` · ${impedanceValue}` : ""}
        </span>
      }
      hint={
        risky
          ? `${phantomRisk} is patched into this input and can be damaged by 48V.`
          : isImpedance
            ? `${meta.hint}. Click to cycle through the settings.`
            : meta.hint
      }
    >
    <span className="inline-flex">
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || pending}
      aria-pressed={!isImpedance ? on : undefined}
      aria-label={meta.label}
      className={cn(
        "rounded-[4px] border px-1.5 py-0.5 font-meta text-[9px] font-semibold uppercase transition-colors disabled:opacity-40",
        on
          ? capability === "phantom"
            ? "border-caution/50 bg-caution/20 text-caution"
            : "border-gold-dim/60 bg-gold/15 text-gold-bright"
          : risky
            ? "border-critical/50 text-critical hover:bg-critical/10"
            : "border-graphite/50 text-steel hover:border-gold-dim/50 hover:text-bone",
      )}
    >
      {isImpedance && impedanceValue ? impedanceValue : meta.short}
    </button>
    </span>
    </Tooltip>
  );
}

function DeviceProperties({
  selection,
  onDeleted,
  canEdit,
}: {
  selection: DeviceSelection;
  onDeleted: () => void;
  canEdit: boolean;
}) {
  const updateDevice = useMutation(api.patchManager.updateDevice);
  const removeDevice = useMutation(api.patchManager.removeDevice);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const setDevicePhoto = useMutation(api.patchManager.setDevicePhoto);
  const clearDevicePhoto = useMutation(api.patchManager.clearDevicePhoto);

  const [label, setLabel] = React.useState(selection.label);
  const [notes, setNotes] = React.useState(selection.notes ?? "");

  // Re-seed the form when a different device is selected. Adjusting state
  // during render is the supported pattern for this; a ref compare is not.
  const [seededId, setSeededId] = React.useState(selection._id);
  if (seededId !== selection._id) {
    setSeededId(selection._id);
    setLabel(selection.label);
    setNotes(selection.notes ?? "");
  }

  const meta = categoryMeta(selection.category);
  const isPatchbay = selection.category === "patchbay";

  async function save() {
    if (!label.trim()) {
      toast.error("A device needs a name.");
      return;
    }
    try {
      await updateDevice({ id: selection._id, label: label.trim(), notes });
      toast.success("Saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${selection.label} and pull every cable on it?`)) return;
    try {
      await removeDevice({ id: selection._id });
      toast.success(`${selection.label} removed.`);
      onDeleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove.");
    }
  }

  const togglablePorts = selection.ports.filter((p) => p.capabilities.length > 0);

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-start gap-2">
        <meta.icon className="mt-0.5 size-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-bone">{selection.label}</p>
          <p className="truncate font-meta text-[10px] uppercase tracking-wide text-steel">
            {selection.manufacturer || meta.label}
          </p>
        </div>
      </div>

      {/* A photo of the unit as it sits in the rack. The catalog shot from
          inventory shows through until someone takes a real one, which is
          why the caption says which of the two you are looking at. */}
      <PhotoUpload
        photo={selection.photoUrl}
        generateUploadUrl={generateUploadUrl}
        onStorageId={(storageId) => setDevicePhoto({ id: selection._id, storageId })}
        onClear={
          selection.photoIsOwn ? () => clearDevicePhoto({ id: selection._id }) : undefined
        }
        hint={
          selection.photoUrl && !selection.photoIsOwn
            ? "Catalog photo from inventory. Upload one of this actual unit."
            : "A photo of this unit in the rack, so the map matches the room."
        }
      />

      {/* The inventory link, made obvious and clickable. */}
      {selection.equipment ? (
        <Link
          href="/inventory"
          className="flex items-center gap-2 rounded-md border border-hairline-2 bg-coal-2/60 px-2.5 py-2 transition-colors hover:border-gold-dim/60"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-meta text-[9px] uppercase tracking-wide text-steel">
              Inventory asset
            </span>
            <span className="block truncate text-xs text-bone">
              {selection.equipment.name}
              {selection.equipment.serialNumber ? ` · ${selection.equipment.serialNumber}` : ""}
            </span>
          </span>
          <ExternalLink className="size-3 shrink-0 text-steel" />
        </Link>
      ) : (
        <p className="rounded-md border border-caution/30 bg-caution/10 px-2.5 py-2 text-[11px] text-caution">
          Not linked to an inventory asset. This device is a sketch.
        </p>
      )}

      <Field label="Label" htmlFor="patch-device-label">
        <Input
          id="patch-device-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={save}
          disabled={!canEdit}
          className="h-9 text-xs"
        />
      </Field>

      {isPatchbay && (
        <Field
          label="Normalling"
          hint="Recorded on the bay and printed on the patch list. Implied normal connections are not drawn on the canvas yet."
        >
          <Select
            value={selection.normalling ?? "none"}
            onValueChange={async (value) => {
              try {
                await updateDevice({
                  id: selection._id,
                  normalling: value as "full" | "half" | "none",
                });
              } catch {
                toast.error("Could not change normalling.");
              }
            }}
            disabled={!canEdit}
          >
            <SelectTrigger className="h-9 text-xs">
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

      <Field label="Notes" htmlFor="patch-device-notes">
        <Textarea
          id="patch-device-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={save}
          disabled={!canEdit}
          placeholder="Channel 2 intermittent. Do not repatch without telling Marcus."
          className="min-h-16 text-xs"
        />
      </Field>

      {togglablePorts.length > 0 && (
        <div className="space-y-2">
          <p className="overline">Port controls</p>
          {selection.phantomSensitive && (
            <p className="flex items-start gap-1.5 rounded-md border border-caution/30 bg-caution/10 px-2 py-1.5 text-[10px] text-caution">
              <Zap className="mt-px size-3 shrink-0" />
              This device is phantom sensitive. 48V can damage it.
            </p>
          )}
          {Object.keys(selection.phantomRiskByPort).length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-critical/40 bg-critical/10 px-2 py-1.5 text-[10px] text-critical">
              <Zap className="mt-px size-3 shrink-0" />
              A phantom sensitive device is patched into{" "}
              {Object.keys(selection.phantomRiskByPort).length === 1 ? "an input" : "inputs"} on this
              unit. Check before sending 48V.
            </p>
          )}
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {togglablePorts.map((port) => (
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
                    {levelMeta(port.signalLevel).short} · {connectorMeta(port.connector).short}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {port.capabilities.map((capability) => (
                    <PortToggle
                      key={capability}
                      port={port}
                      capability={capability}
                      phantomRisk={selection.phantomRiskByPort[port._id] ?? null}
                      disabled={!canEdit}
                    />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit && (
        <Button variant="danger" size="sm" className="w-full" onClick={remove}>
          <Trash2 className="size-3.5" />
          Remove from canvas
        </Button>
      )}
    </div>
  );
}

function ConnectionProperties({
  selection,
  onDeleted,
  canEdit,
}: {
  selection: ConnectionSelection;
  onDeleted: () => void;
  canEdit: boolean;
}) {
  const updateConnection = useMutation(api.patchManager.updateConnection);
  const disconnect = useMutation(api.patchManager.disconnect);
  const unassign = useMutation(api.patchCables.unassign);
  const suggestions = useQuery(api.patchCables.suggestFor, { connectionId: selection._id }) as
    | { _id: Id<"equipment">; name: string; lengthFt: number | null; free: number }[]
    | undefined;

  const [tag, setTag] = React.useState(selection.cableTag ?? "");
  const [labelMode, setLabelMode] = React.useState<CableLabelMode>(
    selection.cableLabelMode ?? "single",
  );
  const [sourceTag, setSourceTag] = React.useState(selection.cableTagSource ?? "");
  const [targetTag, setTargetTag] = React.useState(selection.cableTagTarget ?? "");

  const [seededId, setSeededId] = React.useState(selection._id);
  if (seededId !== selection._id) {
    setSeededId(selection._id);
    setTag(selection.cableTag ?? "");
    setLabelMode(selection.cableLabelMode ?? "single");
    setSourceTag(selection.cableTagSource ?? "");
    setTargetTag(selection.cableTagTarget ?? "");
  }

  // Saving all four together keeps the mode and the strings consistent:
  // switching to per-end and typing one field must not leave a stale
  // single label showing in the middle of the cable.
  function saveLabels(next?: Partial<{
    mode: CableLabelMode;
    tag: string;
    sourceTag: string;
    targetTag: string;
  }>) {
    const mode = next?.mode ?? labelMode;
    void patchField({
      cableLabelMode: mode,
      cableTag: mode === "single" ? (next?.tag ?? tag).trim() || undefined : undefined,
      cableTagSource:
        mode === "perEnd" ? (next?.sourceTag ?? sourceTag).trim() || undefined : undefined,
      cableTagTarget:
        mode === "perEnd" ? (next?.targetTag ?? targetTag).trim() || undefined : undefined,
    });
  }

  async function patchField(fields: Record<string, unknown>) {
    try {
      await updateConnection({ id: selection._id, ...fields } as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    }
  }

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="overline">Cable run</p>
        <p className="mt-1 text-xs text-bone">{selection.sourceLabel}</p>
        <p className="my-0.5 font-meta text-[10px] text-gold">to</p>
        <p className="text-xs text-bone">{selection.targetLabel}</p>
      </div>

      <Field label="Cable from stock" hint="Only stock whose ends match, with a spare free.">
        <Select
          value={selection.cableId ?? "none"}
          onValueChange={async (value) => {
            if (value === "none") {
              await unassign({ connectionId: selection._id });
              return;
            }
            await patchField({ cableId: value });
          }}
          disabled={!canEdit}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Nothing assigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nothing assigned</SelectItem>
            {(suggestions ?? []).map((option) => (
              <SelectItem key={option._id} value={option._id}>
                {option.name}
                {option.lengthFt ? ` · ${option.lengthFt}ft` : ""} · {option.free} free
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {suggestions !== undefined && suggestions.length === 0 && !selection.cableId && (
        <p className="rounded-md border border-caution/30 bg-caution/10 px-2 py-1.5 text-[10px] text-caution">
          No matching cable free in stock. Add one from the cable manager.
        </p>
      )}

      <CableLabelFields
        mode={labelMode}
        onModeChange={(mode) => {
          setLabelMode(mode);
          saveLabels({ mode });
        }}
        tag={tag}
        onTagChange={setTag}
        sourceTag={sourceTag}
        onSourceTagChange={setSourceTag}
        targetTag={targetTag}
        onTargetTagChange={setTargetTag}
        sourceName={selection.sourceLabel}
        targetName={selection.targetLabel}
        disabled={!canEdit}
        onCommit={saveLabels}
      />

      <Field label="Jacket colour" hint="Overrides the stock colour for this run only.">
        <CableColorField
          value={selection.cableColor}
          onChange={(color) => patchField({ cableColor: color })}
          disabled={!canEdit}
        />
      </Field>

      {canEdit && (
        <div className="space-y-2">
          {selection.cableId && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => unassign({ connectionId: selection._id })}
            >
              <Cable className="size-3.5" />
              Release the cable, keep the run
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            className="w-full"
            onClick={async () => {
              await disconnect({ id: selection._id });
              onDeleted();
            }}
          >
            <Unplug className="size-3.5" />
            Pull this connection
          </Button>
        </div>
      )}
    </div>
  );
}

/** A sticky note has three things worth editing and nothing else. */
function NoteProperties({
  selection,
  onDeleted,
  canEdit,
}: {
  selection: NoteSelection;
  onDeleted: () => void;
  canEdit: boolean;
}) {
  const updateNote = useMutation(api.patchManager.updateNote);
  const removeNote = useMutation(api.patchManager.removeNote);

  const [text, setText] = React.useState(selection.text);
  const [seededId, setSeededId] = React.useState(selection._id);
  if (seededId !== selection._id) {
    setSeededId(selection._id);
    setText(selection.text);
  }

  async function save(patch: { text?: string; color?: string }) {
    try {
      await updateNote({ id: selection._id, ...patch });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    }
  }

  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="overline">Note</p>
        <p className="mt-1 text-[11px] text-steel">
          Anything about this rig that is not a connection. It never appears on a
          run list and never counts as gear.
        </p>
      </div>

      <Field label="Text">
        <Textarea
          value={text}
          disabled={!canEdit}
          rows={5}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void save({ text })}
          placeholder="Console channel 7 crackles above +6"
          className="text-xs"
        />
      </Field>

      <div>
        <p className="overline mb-1.5">Colour</p>
        <div className="flex flex-wrap gap-1.5">
          {NOTE_COLORS.map((colour) => (
            <Tooltip key={colour.key} label={colour.label}>
              <button
                type="button"
                disabled={!canEdit}
                aria-label={colour.label}
                aria-pressed={selection.color === colour.key}
                onClick={() => void save({ color: colour.key })}
                className={cn(
                  "size-7 rounded-md border-2 transition-transform disabled:opacity-40",
                  selection.color === colour.key
                    ? "scale-110 border-gold"
                    : "border-transparent hover:scale-105",
                )}
                style={{ background: colour.bg, borderColor: selection.color === colour.key ? undefined : colour.border }}
              />
            </Tooltip>
          ))}
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-critical hover:bg-critical/10"
        disabled={!canEdit}
        onClick={async () => {
          try {
            await removeNote({ id: selection._id });
            onDeleted();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not remove.");
          }
        }}
      >
        <Trash2 className="size-3.5" />
        Remove note
      </Button>
    </div>
  );
}

export function PropertiesPanel({
  selection,
  onDeleted,
  canEdit,
  onCollapse,
}: {
  selection: PatchSelection;
  onDeleted: () => void;
  canEdit: boolean;
  /** Fold the panel away. Omitted where the panel cannot be collapsed. */
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-hairline bg-coal-2/40">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
        <p className="overline">
          {selection?.kind === "connection"
            ? "Connection"
            : selection?.kind === "note"
              ? "Note"
              : selection
                ? "Device"
                : "Properties"}
        </p>
        {onCollapse && (
          <PanelCollapseButton
            side="right"
            label="Properties"
            shortcut="]"
            onCollapse={onCollapse}
            className="ml-auto"
          />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selection && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MousePointerSquareDashed className="size-6 text-steel/50" />
            <p className="text-xs text-steel">
              Select a device, a cable or a note to edit it.
            </p>
            <p className="text-[10px] text-steel/60">
              Drag from a port dot to another port to patch.
            </p>
          </div>
        )}
        {selection?.kind === "device" && (
          <DeviceProperties selection={selection} onDeleted={onDeleted} canEdit={canEdit} />
        )}
        {selection?.kind === "connection" && (
          <ConnectionProperties selection={selection} onDeleted={onDeleted} canEdit={canEdit} />
        )}
        {selection?.kind === "note" && (
          <NoteProperties selection={selection} onDeleted={onDeleted} canEdit={canEdit} />
        )}
      </div>
    </div>
  );
}
