"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Boxes,
  DoorOpen,
  Package,
  Plus,
  Wallet,
  Cpu,
  Sofa,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/shell/app-motion";
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
  ASSET_CLASSES,
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
  const [assetClass, setAssetClass] = React.useState<string>(ALL);

  const [addOpen, setAddOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<EditableEquipment | undefined>(
    undefined,
  );
  const [editOpen, setEditOpen] = React.useState(false);
  const [installItem, setInstallItem] = React.useState<InstallTarget | null>(
    null,
  );
  const [installOpen, setInstallOpen] = React.useState(false);

  // Bulk selection.
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = React.useState(false);
  const bulkAssign = useMutation(api.equipment.bulkAssign);
  const bulkUpdate = useMutation(api.equipment.bulkUpdate);
  const bulkRemove = useMutation(api.equipment.bulkRemove);

  // Filter setters that also clear the selection (the visible set changes).
  function setCategoryAndClear(v: string) { setCategory(v); setSelected(new Set()); }
  function setLocationAndClear(v: string) { setLocation(v); setSelected(new Set()); }
  function setAssetClassAndClear(v: string) { setAssetClass(v); setSelected(new Set()); }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function runBulk(fn: () => Promise<unknown>, msg: string) {
    setBulkPending(true);
    try {
      await fn();
      toast.success(msg);
      clearSelection();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk action failed.");
    } finally {
      setBulkPending(false);
    }
  }

  const summary = useQuery(api.equipment.summary);
  const rooms = useQuery(api.rooms.bookable);
  const items = useQuery(api.equipment.list, {
    category: category === ALL ? undefined : (category as EquipmentCategory),
    location: location === ALL ? undefined : location,
    assetClass: assetClass === ALL ? undefined : assetClass,
  }) as EquipmentRow[] | undefined;

  const loading = items === undefined;
  const filtering = category !== ALL || location !== ALL || assetClass !== ALL;
  const empty = !loading && items.length === 0;

  function handleEdit(item: EquipmentRow) {
    setEditItem({
      _id: item._id,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
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
        description="Every console, mic, instrument and rig the studio owns - what it cost, what it is worth, and where it lives."
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
        <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatTile
            label="Total value"
            value={<CountUp to={summary.currentTotal} format={(n) => money(n, { compact: true })} />}
            icon={Wallet}
            accent
            hint={`${summary.count} ${summary.count === 1 ? "item" : "items"}`}
          />
          <StatTile
            label="Gear value"
            value={<CountUp to={summary.gearCurrent} format={(n) => money(n, { compact: true })} />}
            icon={Cpu}
            hint={`${summary.gearCount} hardware items`}
          />
          <StatTile
            label="Furniture value"
            value={<CountUp to={summary.furnitureCurrent} format={(n) => money(n, { compact: true })} />}
            icon={Sofa}
            hint={`${summary.furnitureCount} furniture & space`}
          />
          <StatTile
            label="Installed"
            value={<CountUp to={summary.installed} />}
            icon={DoorOpen}
            hint="assigned to rooms"
          />
          <StatTile
            label="In storage"
            value={<CountUp to={summary.inStorage} />}
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
          <Select value={assetClass} onValueChange={setAssetClassAndClear}>
            <SelectTrigger aria-label="Filter by class">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All assets</SelectItem>
              {ASSET_CLASSES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select value={category} onValueChange={setCategoryAndClear}>
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
          <Select value={location} onValueChange={setLocationAndClear}>
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
              setAssetClass(ALL);
              clearSelection();
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Bulk edit / assign bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-gold-dim/50 bg-obsidian/95 px-3 py-2 shadow-elev-2 backdrop-blur">
          <span className="text-sm font-medium text-bone">
            {selected.size} selected
          </span>
          <span className="mx-1 h-4 w-px bg-hairline" />

          {/* Assign to room / storage */}
          <Select
            value=""
            onValueChange={(v) => {
              const ids = [...selected] as Id<"equipment">[];
              if (v === STORAGE) {
                runBulk(() => bulkAssign({ ids }), `${ids.length} moved to storage`);
              } else {
                const room = (rooms ?? []).find((r) => r._id === v);
                runBulk(
                  () => bulkAssign({ ids, roomId: v as Id<"rooms"> }),
                  `${ids.length} assigned to ${room?.name ?? "room"}`,
                );
              }
            }}
            disabled={bulkPending}
          >
            <SelectTrigger className="h-8 w-auto gap-1 text-xs">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STORAGE}>Storage</SelectItem>
              {(rooms ?? []).map((r) => (
                <SelectItem key={r._id} value={r._id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Set category */}
          <Select
            value=""
            onValueChange={(v) => {
              const ids = [...selected] as Id<"equipment">[];
              runBulk(() => bulkUpdate({ ids, category: v as EquipmentCategory }), `Category updated for ${ids.length}`);
            }}
            disabled={bulkPending}
          >
            <SelectTrigger className="h-8 w-auto gap-1 text-xs">
              <SelectValue placeholder="Set category…" />
            </SelectTrigger>
            <SelectContent>
              {EQUIPMENT_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Set status */}
          <Select
            value=""
            onValueChange={(v) => {
              const ids = [...selected] as Id<"equipment">[];
              runBulk(() => bulkUpdate({ ids, status: v as "available" | "in_use" | "maintenance" | "retired" }), `Status updated for ${ids.length}`);
            }}
            disabled={bulkPending}
          >
            <SelectTrigger className="h-8 w-auto gap-1 text-xs">
              <SelectValue placeholder="Set status…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="in_use">In use</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            disabled={bulkPending}
            onClick={() => {
              const ids = [...selected] as Id<"equipment">[];
              if (!window.confirm(`Remove ${ids.length} item(s) from inventory? This can't be undone.`)) return;
              runBulk(() => bulkRemove({ ids }), `${ids.length} removed`);
            }}
            className="text-critical hover:text-critical"
          >
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection} disabled={bulkPending}>
            Clear
          </Button>
        </div>
      )}

      {/* Table or empty state */}
      {empty && !filtering ? (
        <EmptyState
          icon={Package}
          title="No equipment tracked yet"
          description="Add the studio's gear - each console, mic, instrument and rig - so you can see what it cost and what it is worth."
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
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
        />
      )}

      {!loading && !empty && (
        <p className="text-xs text-steel/70">
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
