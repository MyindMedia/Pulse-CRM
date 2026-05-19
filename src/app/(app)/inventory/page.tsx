"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Boxes,
  DoorOpen,
  Package,
  Plus,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { money } from "@/lib/format";
import {
  EQUIPMENT_CATEGORIES,
  type EquipmentCategory,
} from "@/components/studio/constants";
import {
  EquipmentTable,
  type EquipmentRow,
} from "@/components/inventory/equipment-table";
import {
  EquipmentDialog,
  type EditableEquipment,
} from "@/components/inventory/equipment-dialog";
import {
  InstallDialog,
  type InstallTarget,
} from "@/components/inventory/install-dialog";

/** Sentinel select values for the filter row. */
const ALL = "all";
const STORAGE = "storage";

export default function InventoryPage() {
  const [category, setCategory] = React.useState<string>(ALL);
  const [location, setLocation] = React.useState<string>(ALL);

  const [addOpen, setAddOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<EditableEquipment | undefined>(
    undefined,
  );
  const [editOpen, setEditOpen] = React.useState(false);
  const [installItem, setInstallItem] = React.useState<InstallTarget | null>(
    null,
  );
  const [installOpen, setInstallOpen] = React.useState(false);

  const summary = useQuery(api.equipment.summary);
  const rooms = useQuery(api.rooms.bookable);
  const items = useQuery(api.equipment.list, {
    category: category === ALL ? undefined : (category as EquipmentCategory),
    location: location === ALL ? undefined : location,
  }) as EquipmentRow[] | undefined;

  const loading = items === undefined;
  const filtering = category !== ALL || location !== ALL;
  const empty = !loading && items.length === 0;

  function handleEdit(item: EquipmentRow) {
    setEditItem({
      _id: item._id,
      name: item.name,
      category: item.category,
      purchaseCents: item.purchaseCents,
      currentValueCents: item.currentValueCents,
      serialNumber: item.serialNumber,
      condition: item.condition,
      notes: item.notes,
    });
    setEditOpen(true);
  }

  function handleInstall(item: EquipmentRow) {
    setInstallItem({ _id: item._id, name: item.name });
    setInstallOpen(true);
  }

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Assets"
        title="Inventory"
        description="Every console, mic, instrument and rig the studio owns — what it cost, what it is worth, and where it lives."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add equipment
          </Button>
        }
      />

      {/* Stat tiles */}
      {summary === undefined ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatTile
            label="Current value"
            value={money(summary.currentTotal, { compact: true })}
            icon={Wallet}
            accent
            hint={`${summary.count} ${summary.count === 1 ? "item" : "items"}`}
          />
          <StatTile
            label="Purchase value"
            value={money(summary.purchaseTotal, { compact: true })}
            icon={Package}
            hint="total cost new"
          />
          <StatTile
            label="Depreciation"
            value={money(summary.depreciation, { compact: true })}
            icon={TrendingDown}
            hint="lost since purchase"
          />
          <StatTile
            label="Installed"
            value={String(summary.installed)}
            icon={DoorOpen}
            hint="across the rooms"
          />
          <StatTile
            label="In storage"
            value={String(summary.inStorage)}
            icon={Boxes}
            hint={
              summary.maintenance > 0
                ? `${summary.maintenance} in maintenance`
                : "not installed"
            }
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-48">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {EQUIPMENT_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger aria-label="Filter by location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All locations</SelectItem>
              <SelectItem value={STORAGE}>In storage</SelectItem>
              {(rooms ?? []).map((r) => (
                <SelectItem key={r._id} value={r._id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtering && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategory(ALL);
              setLocation(ALL);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Table or empty state */}
      {empty && !filtering ? (
        <EmptyState
          icon={Package}
          title="No equipment tracked yet"
          description="Add the studio's gear — each console, mic, instrument and rig — so you can see what it cost and what it is worth."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add equipment
            </Button>
          }
        />
      ) : (
        <EquipmentTable
          items={items ?? []}
          loading={loading}
          filtering={filtering}
          onInstall={handleInstall}
          onEdit={handleEdit}
        />
      )}

      {!loading && !empty && (
        <p className="text-xs text-ash-dim">
          Showing {items.length} {items.length === 1 ? "item" : "items"}
          {filtering ? " for the current filters" : ""}.
        </p>
      )}

      <EquipmentDialog open={addOpen} onOpenChange={setAddOpen} />
      <EquipmentDialog
        item={editItem}
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditItem(undefined);
        }}
      />
      <InstallDialog
        item={installItem}
        open={installOpen}
        onOpenChange={(o) => {
          setInstallOpen(o);
          if (!o) setInstallItem(null);
        }}
      />
    </div>
  );
}
