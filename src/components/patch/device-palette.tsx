"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Boxes, MapPin, Package, Plus, Search, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";
import { PanelCollapseButton } from "./panel-rail";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { categoryMeta } from "@/components/studio/constants";
import { WALL_PANEL_CATEGORY } from "./constants";
import { Tooltip } from "@/components/ui/tooltip";

export type PaletteItem = {
  _id: Id<"equipment">;
  name: string;
  category: string;
  serialNumber: string | null;
  condition: string | null;
  status: string;
  inThisRoom: boolean;
  quantity: number;
  placed: number;
  available: number;
};

export type PaletteProfile = {
  _id: Id<"deviceProfiles">;
  name: string;
  manufacturer: string;
  category: string;
  scope: string;
  portCount: number;
  inputCount: number;
  outputCount: number;
};

/**
 * The palette is the studio's own inventory, not a parallel catalog.
 * Every row is a gear asset the studio owns, annotated with how many
 * units are already on this canvas, so you cannot document patching a
 * seventh preamp when you own six.
 *
 * The second tab holds generic profiles: patchbays, DIs, snakes. Gear
 * that does not live in inventory because nobody depreciates a DI box.
 */
export function DevicePalette({
  patchSpaceId,
  onPlaceEquipment,
  onPlaceProfile,
  onCreateCustom,
  onCollapse,
  disabled,
}: {
  patchSpaceId: Id<"patchSpaces">;
  onPlaceEquipment: (item: PaletteItem) => void;
  onPlaceProfile: (profile: PaletteProfile) => void;
  onCreateCustom: () => void;
  /** Fold the palette away. Omitted where the panel cannot be collapsed. */
  onCollapse?: () => void;
  disabled?: boolean;
}) {
  const [tab, setTab] = React.useState<"inventory" | "generic">("inventory");
  const [q, setQ] = React.useState("");
  const [scope, setScope] = React.useState<"room" | "all">("room");

  const items = useQuery(api.patchManager.palette, {
    patchSpaceId,
    q: q.trim() || undefined,
    scope,
  }) as PaletteItem[] | undefined;

  const profiles = useQuery(api.patchManager.profiles, {
    q: q.trim() || undefined,
  }) as PaletteProfile[] | undefined;

  // Generic tab shows the gear that is not an inventory asset: bays,
  // DI boxes, snakes, headphone amps.
  const generic = React.useMemo(
    () => (profiles ?? []).filter((p) => p.manufacturer === "Generic" || p.scope === "studio"),
    [profiles],
  );

  const loading = tab === "inventory" ? items === undefined : profiles === undefined;

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-hairline bg-coal-2/40">
      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-2 pt-2">
        {(
          [
            { key: "inventory", label: "Inventory", icon: Boxes },
            { key: "generic", label: "Generic", icon: Package },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <Tooltip
            key={key}
            side="bottom"
            label={key === "inventory" ? "Your inventory" : "Generic gear"}
            hint={
              key === "inventory"
                ? "Real assets the studio owns. Placing one spends a unit."
                : "Patchbays, DI boxes, snakes and headphone amps, plus anything you have built yourself."
            }
          >
            <button
              type="button"
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-t-md px-2.5 py-1.5 font-meta text-[10px] uppercase tracking-wide transition-colors",
                tab === key
                  ? "bg-coal text-gold shadow-[inset_0_-2px_0_0_var(--color-gold)]"
                  : "text-steel hover:text-bone",
              )}
            >
              <Icon className="size-3" />
              {label}
            </button>
          </Tooltip>
        ))}
        {onCollapse && (
          <PanelCollapseButton
            side="left"
            label="Inventory"
            shortcut="["
            onCollapse={onCollapse}
            className="ml-auto mb-1.5"
          />
        )}
      </div>

      {/* Search */}
      <div className="shrink-0 space-y-2 border-b border-hairline p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-steel" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder={tab === "inventory" ? "Search your gear" : "Search patchbays, DIs"}
            className="h-8 pl-8 text-xs"
            aria-label="Search devices"
          />
        </div>
        {tab === "inventory" && (
          <div className="flex items-center gap-1">
            {(
              [
                { key: "room", label: "This room", icon: MapPin },
                { key: "all", label: "Everywhere", icon: Warehouse },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <Tooltip
                key={key}
                side="bottom"
                label={key === "room" ? "Gear in this room" : "All your gear"}
                hint={
                  key === "room"
                    ? "What is installed here, plus anything sitting in storage."
                    : "Every asset the studio owns, including gear installed in other rooms."
                }
              >
                <button
                  type="button"
                  aria-pressed={scope === key}
                  onClick={() => setScope(key)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 font-meta text-[9px] uppercase tracking-wide transition-colors",
                    scope === key
                      ? "border-gold-dim/60 bg-gold/10 text-gold-bright"
                      : "border-graphite/50 text-steel hover:text-bone",
                  )}
                >
                  <Icon className="size-2.5" />
                  {label}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading && (
          <div className="space-y-1.5 p-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        )}

        {!loading && tab === "inventory" && items!.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-steel">
            {q
              ? "No gear matches that."
              : scope === "room"
                ? "No gear installed in this room yet. Try Everywhere."
                : "No gear in inventory yet."}
          </p>
        )}

        {!loading &&
          tab === "inventory" &&
          items!.map((item) => {
            const meta = categoryMeta(item.category);
            const Icon = meta.icon;
            const exhausted = item.available <= 0;
            return (
              <Tooltip
                key={item._id}
                side="right"
                label={item.name}
                hint={
                  exhausted
                    ? `All ${item.quantity} already placed. Raise the quantity in inventory to place another.`
                    : `${meta.label} · ${item.inThisRoom ? "installed in this room" : "in storage"}${
                        item.serialNumber ? ` · ${item.serialNumber}` : ""
                      }. Click or drag onto the canvas. ${item.available} of ${item.quantity} free.`
                }
              >
              {/* A disabled button fires no pointer events, so the tooltip
                  needs a wrapper. Otherwise the row that most needs an
                  explanation is the one row with none. */}
              <span className="mb-1 block">
              <button
                type="button"
                disabled={disabled || exhausted}
                draggable={!disabled && !exhausted}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/pulse-patch",
                    JSON.stringify({ kind: "equipment", id: item._id }),
                  );
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPlaceEquipment(item)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                  exhausted
                    ? "cursor-not-allowed border-transparent opacity-40"
                    : "cursor-grab border-transparent hover:border-gold-dim/50 hover:bg-gold/[0.06] active:cursor-grabbing",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-steel group-hover:text-gold" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-bone">{item.name}</span>
                  <span className="block truncate font-meta text-[9px] uppercase tracking-wide text-steel">
                    {meta.label}
                    {item.inThisRoom ? " · in room" : " · storage"}
                  </span>
                </span>
                {item.quantity > 1 && (
                  <span
                    className={cn(
                      "shrink-0 rounded-[3px] px-1 font-meta text-[9px] font-semibold",
                      exhausted ? "bg-coal-3 text-steel" : "bg-coal-3 text-ash",
                    )}
                  >
                    {item.available}/{item.quantity}
                  </span>
                )}
              </button>
              </span>
              </Tooltip>
            );
          })}

        {!loading &&
          tab === "generic" &&
          generic.map((profile) => (
            <Tooltip
              key={profile._id}
              side="right"
              label={profile.name}
              hint={
                profile.category === WALL_PANEL_CATEGORY
                  ? `${profile.manufacturer} · ${profile.portCount} connectors, each usable in either direction. Click or drag onto the canvas.`
                  : `${profile.manufacturer} · ${profile.inputCount} inputs, ${profile.outputCount} outputs. Click or drag onto the canvas.`
              }
            >
            <button
              type="button"
              disabled={disabled}
              draggable={!disabled}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  "application/pulse-patch",
                  JSON.stringify({ kind: "profile", id: profile._id }),
                );
                event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onPlaceProfile(profile)}
              className="group mb-1 flex w-full cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-gold-dim/50 hover:bg-gold/[0.06] active:cursor-grabbing"
            >
              <Package className="size-3.5 shrink-0 text-steel group-hover:text-gold" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-bone">{profile.name}</span>
                <span className="block truncate font-meta text-[9px] uppercase tracking-wide text-steel">
                  {/* A hole in a plate is one hole. Counting it as an input
                      AND an output, which is what a bidirectional jack does
                      everywhere else, would claim a 4-way panel has eight. */}
                  {profile.category === WALL_PANEL_CATEGORY
                    ? `${profile.portCount} connectors`
                    : `${profile.inputCount} in · ${profile.outputCount} out`}
                </span>
              </span>
              {profile.scope === "studio" && (
                <span className="shrink-0 rounded-[3px] bg-gold/15 px-1 font-meta text-[9px] font-semibold text-gold-bright">
                  Yours
                </span>
              )}
            </button>
            </Tooltip>
          ))}
      </div>

      {/* The escape hatch. First-class, not buried in settings, because
          the seed library will never cover a real studio's odd gear. */}
      <div className="shrink-0 border-t border-hairline p-2">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={onCreateCustom}
          disabled={disabled}
        >
          <Plus className="size-3.5" />
          Build a custom device
        </Button>
      </div>
    </div>
  );
}
