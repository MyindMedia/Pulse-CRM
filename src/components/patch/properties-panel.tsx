"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  ArrowRight,
  Cable,
  Check,
  ExternalLink,
  HelpCircle,
  MousePointerSquareDashed,
  Slash,
  Trash2,
  Unplug,
  Waypoints,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
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
import { DEVICE_COLORS, capabilityMeta, connectorMeta, levelMeta } from "./constants";
import { CableColorField } from "./cable-color-field";
import { CableLabelFields, type CableLabelMode } from "./cable-label-fields";
import { PanelCollapseButton } from "./panel-rail";
import { PortEditor } from "./port-editor";
import { NOTE_COLORS } from "./note-node";
import { GROUP_COLORS } from "./group-node";
import { ZONE_KINDS, zoneKind } from "./zone-kinds";
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
  panelPhotoUrl: string | null;
  profileId: Id<"deviceProfiles">;
  specSource: "curated" | "ai" | "category" | "manual";
  specVerified: boolean;
  specNote: string | null;
  equipment: { _id: Id<"equipment">; name: string; serialNumber: string | null } | null;
  /** port id -> label of the phantom-sensitive device currently patched into it. */
  phantomRiskByPort: Record<string, string>;
  /** Card colour on the canvas, or undefined for the house style. */
  color?: string | null;
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

type GroupSelection = {
  kind: "group";
  _id: Id<"patchGroups">;
  name: string;
  /** Zone kind: control room, vocal booth, wall panel, and so on. */
  zoneKind: string;
  roomId: Id<"rooms"> | null;
  rooms: { _id: Id<"rooms">; name: string; roomType: string | null }[];
  color: string;
  /** Counted from where things sit, not from a stored member list. */
  status: {
    devices: number;
    ports: number;
    patched: number;
    free: number;
    leaving: number;
    onTieLines: number;
  };
  /** Runs with one end in this zone and the other end somewhere else. */
  crossing: {
    _id: string;
    from: string;
    to: string;
    toZone: string | null;
    tie: boolean;
    fit: string | null;
  }[];
  /** Connectors in this zone with nothing in them. */
  free: { device: string; port: string }[];
};

export type PatchSelection =
  | DeviceSelection
  | ConnectionSelection
  | NoteSelection
  | GroupSelection
  | null;

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
      toast.error(errorMessage(error, "Could not change that."));
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
  const verifySpec = useMutation(api.patchSpecs.verifySpec);
  const setDevicePhoto = useMutation(api.patchManager.setDevicePhoto);
  const clearDevicePhoto = useMutation(api.patchManager.clearDevicePhoto);
  const setPanelPhoto = useMutation(api.patchManager.setDevicePanelPhoto);
  const setDeviceColor = useMutation(api.patchManager.setDeviceColor);
  const clearPanelPhoto = useMutation(api.patchManager.clearDevicePanelPhoto);

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
      toast.error(errorMessage(error, "Could not save."));
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${selection.label} and pull every cable on it?`)) return;
    try {
      await removeDevice({ id: selection._id });
      toast.success(`${selection.label} removed.`);
      onDeleted();
    } catch (error) {
      toast.error(errorMessage(error, "Could not remove."));
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

      {/* Two photos, two jobs. The front is how you find the box; the back is
          what you want open beside you while patching. Kept apart so the card
          never shows cable spaghetti and the patching reference never gets
          overwritten by a nicer front shot. */}
      <div className="space-y-3">
        <div>
          <p className="overline mb-1.5">Device photo</p>
          <PhotoUpload
            photo={selection.photoUrl}
            generateUploadUrl={generateUploadUrl}
            onStorageId={(storageId) => setDevicePhoto({ id: selection._id, storageId })}
            onClear={
              selection.photoIsOwn ? () => clearDevicePhoto({ id: selection._id }) : undefined
            }
            hint={
              selection.photoUrl && !selection.photoIsOwn
                ? "Catalog photo from inventory. Upload the actual unit to tell it apart."
                : "The front of this unit. Shown on its card, so you can spot it in a rack."
            }
          />
        </div>

        <div>
          <p className="overline mb-1.5">Rear panel</p>
          <PhotoUpload
            photo={selection.panelPhotoUrl}
            generateUploadUrl={generateUploadUrl}
            onStorageId={(storageId) => setPanelPhoto({ id: selection._id, storageId })}
            onClear={
              selection.panelPhotoUrl
                ? () => clearPanelPhoto({ id: selection._id })
                : undefined
            }
            hint="Where the jacks are. Open this while patching instead of crawling behind the rack."
          />
        </div>
      </div>

      {/* Where these ports came from. Shown only while it is still a guess,
          so a confirmed rig carries no permanent nag. */}
      {!selection.specVerified &&
        (selection.specSource === "ai" || selection.specSource === "category") && (
          <div className="space-y-2 rounded-chrome border border-info/30 bg-info/8 p-3">
            <div className="flex items-start gap-2">
              <HelpCircle className="mt-0.5 size-3.5 shrink-0 text-info" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-bone">
                  These {selection.ports.length} port
                  {selection.ports.length === 1 ? "" : "s"} are a guess
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-steel">
                  {selection.specSource === "ai"
                    ? selection.specNote
                      ? `Looked up from the model name: ${selection.specNote}.`
                      : "Looked up from the model name, not read off the panel."
                    : "A generic template for this kind of gear, not this model's real panel."}{" "}
                  To fix the list, use{" "}
                  <span className="text-bone">Configure from a spec sheet</span> below.
                  Confirming only silences this notice.
                </p>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                disabled={!canEdit}
                onClick={async () => {
                  try {
                    await verifySpec({ profileId: selection.profileId });
                    toast.success("Ports confirmed.");
                  } catch (error) {
                    toast.error(errorMessage(error, "Could not confirm."));
                  }
                }}
              >
                <Check className="size-3.5" />
                Ports are correct
              </Button>
            </div>
          </div>
        )}

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

      {/* Card colour. Worth having because a room already colour-codes
          itself - the monitor path, the rig going back on Friday - and the
          canvas is a poor map if it cannot say what the room says. */}
      <div>
        <p className="overline mb-1.5">Card colour</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {DEVICE_COLORS.map((colour) => (
            <Tooltip key={colour.value} label={colour.label}>
              <button
                type="button"
                disabled={!canEdit}
                aria-label={colour.label}
                aria-pressed={selection.color === colour.value}
                onClick={() =>
                  void setDeviceColor({ ids: [selection._id], color: colour.value }).catch(
                    (error) => toast.error(errorMessage(error, "Could not change the colour.")),
                  )
                }
                className={cn(
                  "size-7 rounded-md border-2 transition-transform disabled:opacity-40",
                  selection.color === colour.value
                    ? "scale-110 border-gold"
                    : "border-transparent hover:scale-105",
                )}
                style={{
                  background: `${colour.hex}33`,
                  borderColor:
                    selection.color === colour.value ? undefined : `${colour.hex}99`,
                }}
              />
            </Tooltip>
          ))}
          <Tooltip label="No colour" hint="Back to the house style.">
            <button
              type="button"
              disabled={!canEdit}
              aria-label="No colour"
              aria-pressed={!selection.color}
              onClick={() =>
                void setDeviceColor({ ids: [selection._id], color: null }).catch((error) =>
                  toast.error(errorMessage(error, "Could not change the colour.")),
                )
              }
              className={cn(
                "flex size-7 items-center justify-center rounded-md border-2 bg-coal-2 transition-transform disabled:opacity-40",
                !selection.color ? "scale-110 border-gold" : "border-hairline-2 hover:scale-105",
              )}
            >
              <Slash className="size-3 text-steel" />
            </button>
          </Tooltip>
        </div>
        {selection.color && (
          <p className="mt-1.5 text-[10px] text-steel">
            Shown on the card and in the minimap. Right-click a selection of cards to
            paint them all at once.
          </p>
        )}
      </div>

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

      {/* Add and correct the jacks on this unit. Lives above the toggles
          because a port has to exist before its 48V switch means anything. */}
      <PortEditor
        deviceInstanceId={selection._id}
        deviceLabel={selection.label}
        ports={selection.ports}
        canEdit={canEdit}
        hasPanelPhoto={!!selection.panelPhotoUrl}
      />

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
      toast.error(errorMessage(error, "Could not save."));
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
      toast.error(errorMessage(error, "Could not save."));
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
            toast.error(errorMessage(error, "Could not remove."));
          }
        }}
      >
        <Trash2 className="size-3.5" />
        Remove note
      </Button>
    </div>
  );
}

function GroupProperties({
  selection,
  onDeleted,
  canEdit,
}: {
  selection: GroupSelection;
  onDeleted: () => void;
  canEdit: boolean;
}) {
  const updateGroup = useMutation(api.patchManager.updateGroup);
  const removeGroup = useMutation(api.patchManager.removeGroup);

  const [name, setName] = React.useState(selection.name);
  const [seededId, setSeededId] = React.useState(selection._id);
  if (seededId !== selection._id) {
    setSeededId(selection._id);
    setName(selection.name);
  }

  async function save(patch: {
    name?: string;
    kind?: string;
    roomId?: Id<"rooms"> | null;
    color?: string;
  }) {
    try {
      await updateGroup({ id: selection._id, ...patch });
    } catch (error) {
      toast.error(errorMessage(error, "Could not save."));
    }
  }

  const zone = zoneKind(selection.zoneKind);
  const ZoneIcon = zone.icon;
  const { status } = selection;

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-start gap-2">
        <ZoneIcon className="mt-0.5 size-4 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-bone">{selection.name}</p>
          <p className="truncate font-meta text-[10px] uppercase tracking-wide text-steel">
            {zone.label}
            {status.devices > 0 && ` · ${status.devices} device${status.devices === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {/* The four numbers worth having on screen at once. Free connectors get
          their own tile because "what have I got left in the booth" is the
          question that gets asked at 2am with a client waiting. */}
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: "Connectors", value: status.ports, tone: "text-bone" },
          { label: "Patched", value: status.patched, tone: "text-positive" },
          { label: "Free", value: status.free, tone: "text-bone" },
          {
            label: "Leaving zone",
            value: status.leaving,
            tone: status.leaving > 0 ? "text-gold" : "text-steel",
          },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-md border border-hairline bg-coal-2/40 px-2 py-1.5"
          >
            <p className={cn("text-sm font-semibold tabular-nums", tile.tone)}>{tile.value}</p>
            <p className="font-meta text-[9px] uppercase tracking-wide text-steel">
              {tile.label}
            </p>
          </div>
        ))}
      </div>

      <p className="rounded-md border border-hairline bg-coal-2/40 px-2.5 py-2 text-[11px] leading-snug text-steel">
        Whatever sits inside the rectangle belongs to this zone. Drag it by its tab and
        everything standing on it comes along. A run that leaves the zone crosses a wall,
        which is what tie lines and wall panels are for.
      </p>

      <Field label="Name" htmlFor="patch-group-name">
        <Input
          id="patch-group-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void save({ name })}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={!canEdit}
          placeholder="Monitor path"
          className="h-9 text-xs"
        />
      </Field>

      <Field
        label="Kind"
        hint="What kind of place this is. It decides nothing on its own; it is how the map says a run has to cross a wall."
      >
        <Select
          value={selection.zoneKind}
          onValueChange={(value) => void save({ kind: value })}
          disabled={!canEdit}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ZONE_KINDS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <p className="-mt-2 text-[10px] leading-snug text-steel/80">{zone.hint}</p>

      {/* Binding a zone to a room is what stops the canvas and the asset
          register having two names for one place. Offered on every kind,
          because a studio that calls its booth a rack is not wrong. */}
      <Field
        label="Room"
        hint="The room in inventory this zone stands for. Gear installed there is understood to live here."
      >
        <Select
          value={selection.roomId ?? "none"}
          onValueChange={(value) =>
            void save({ roomId: value === "none" ? null : (value as Id<"rooms">) })
          }
          disabled={!canEdit}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Not a room" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not a room</SelectItem>
            {selection.rooms.map((room) => (
              <SelectItem key={room._id} value={room._id}>
                {room.name}
                {room.roomType ? ` · ${room.roomType}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div>
        <p className="overline mb-1.5">Colour</p>
        <div className="flex flex-wrap gap-1.5">
          {GROUP_COLORS.map((colour) => (
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
                style={{
                  background: colour.tab,
                  borderColor: selection.color === colour.key ? undefined : colour.border,
                }}
              />
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Everything that has to cross a wall. Read from this zone outwards,
          whichever way the signal actually runs, because the question being
          asked is always "what does THIS room need to reach". */}
      {selection.crossing.length > 0 && (
        <div className="space-y-1.5">
          <p className="overline">
            Leaves this zone · {selection.crossing.length}
          </p>
          {selection.crossing.some((run) => !run.tie) && (
            <p className="flex items-start gap-1.5 rounded-md border border-caution/30 bg-caution/10 px-2 py-1.5 text-[10px] leading-snug text-caution">
              <Waypoints className="mt-px size-3 shrink-0" />
              {selection.crossing.filter((run) => !run.tie).length} of these cross the edge of
              the zone on a loose cable. If they really run between rooms, patch them through
              a wall panel so the tie line is documented.
            </p>
          )}
          <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
            {selection.crossing.map((run) => (
              <div
                key={run._id}
                className="rounded-md border border-hairline bg-coal-2/40 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-bone">
                    {run.from}
                  </span>
                  {run.tie ? (
                    <Tooltip
                      label="Tie line"
                      hint="Permanent wiring in the wall. Nobody patches this; it is already there."
                    >
                      <span className="shrink-0 cursor-help rounded-[3px] bg-info/20 px-1 font-meta text-[8px] font-semibold text-info">
                        TIE
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="shrink-0 rounded-[3px] bg-coal-3 px-1 font-meta text-[8px] font-semibold text-steel">
                      CABLE
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-steel">
                  <ArrowRight className="size-2.5 shrink-0" />
                  {run.to}
                  {run.toZone && <span className="text-steel/70">· {run.toZone}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What is left. A patch map that cannot answer "have I got a spare
          XLR in the booth" is a picture, not a tool. */}
      {selection.free.length > 0 && (
        <div className="space-y-1.5">
          <p className="overline">Free in this zone · {selection.free.length}</p>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {selection.free.slice(0, 40).map((slot, index) => (
              <div
                key={`${slot.device}-${slot.port}-${index}`}
                className="flex items-center gap-2 rounded-md border border-hairline bg-coal-2/30 px-2 py-1"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-steel/50" />
                <span className="min-w-0 flex-1 truncate text-[10px] text-steel">
                  {slot.device}
                </span>
                <span className="shrink-0 text-[10px] text-bone">{slot.port}</span>
              </div>
            ))}
          </div>
          {selection.free.length > 40 && (
            <p className="text-[10px] text-steel/70">
              and {selection.free.length - 40} more, not listed
            </p>
          )}
        </div>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full text-critical hover:bg-critical/10"
        disabled={!canEdit}
        onClick={async () => {
          try {
            await removeGroup({ id: selection._id });
            onDeleted();
          } catch (error) {
            toast.error(errorMessage(error, "Could not ungroup."));
          }
        }}
      >
        <Trash2 className="size-3.5" />
        Ungroup
      </Button>
      <p className="-mt-2 text-[10px] text-steel">
        Takes the section away. Every device standing on it stays exactly where it is.
      </p>
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
              : selection?.kind === "group"
                ? "Section"
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
              Select a device, a cable, a note or a section to edit it.
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
        {selection?.kind === "group" && (
          <GroupProperties selection={selection} onDeleted={onDeleted} canEdit={canEdit} />
        )}
      </div>
    </div>
  );
}
