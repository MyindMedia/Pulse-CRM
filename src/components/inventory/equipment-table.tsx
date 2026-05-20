"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  DoorOpen,
  ImageOff,
  MoreHorizontal,
  Package,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  categoryMeta,
  statusMeta,
  EQUIPMENT_STATUSES,
  type EquipmentStatus,
} from "@/components/studio/constants";

/** One row of the inventory table - `api.equipment.list` item shape. */
export type EquipmentRow = {
  _id: Id<"equipment">;
  name: string;
  category: string;
  status: string;
  installedInRoomId?: Id<"rooms">;
  purchaseCents: number;
  currentValueCents: number;
  serialNumber?: string;
  condition?: string;
  notes?: string;
  roomName: string | null;
  location: string;
  effectiveStatus: string;
  /** Uploaded display photo, or null when none is set. */
  photo: string | null;
};

const COLUMN_COUNT = 8;

/** A small square equipment thumbnail with a graceful fallback. */
function PhotoThumb({ photo, name }: { photo: string | null; name: string }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-hairline bg-ink-2">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={name} className="size-full object-cover" />
      ) : (
        <ImageOff className="size-3.5 text-ash-dim" />
      )}
    </span>
  );
}

/** A signed Δ value cell - current minus purchase, tinted by direction. */
function DeltaCell({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="font-mono tabular-nums text-ash-dim">-</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono tabular-nums",
        up ? "text-positive" : "text-critical",
      )}
    >
      {up ? (
        <ArrowUpRight className="size-3" />
      ) : (
        <ArrowDownRight className="size-3" />
      )}
      {money(Math.abs(delta), { compact: true })}
    </span>
  );
}

/** Inventory equipment table with per-row actions. */
export function EquipmentTable({
  items,
  loading,
  filtering,
  onInstall,
  onEdit,
}: {
  items: EquipmentRow[];
  loading: boolean;
  filtering: boolean;
  onInstall: (item: EquipmentRow) => void;
  onEdit: (item: EquipmentRow) => void;
}) {
  const moveToStorage = useMutation(api.equipment.moveToStorage);
  const setStatus = useMutation(api.equipment.setStatus);
  const remove = useMutation(api.equipment.remove);
  const [pendingId, setPendingId] = React.useState<Id<"equipment"> | null>(null);

  async function handleMoveToStorage(item: EquipmentRow) {
    setPendingId(item._id);
    try {
      await moveToStorage({ id: item._id });
      toast.success(`${item.name} moved to storage.`);
    } catch {
      toast.error("Could not move the item. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleSetStatus(item: EquipmentRow, status: EquipmentStatus) {
    if (status === item.status) return;
    setPendingId(item._id);
    try {
      await setStatus({ id: item._id, status });
      toast.success(
        `${item.name} marked ${statusMeta(status).label.toLowerCase()}.`,
      );
    } catch {
      toast.error("Could not change status. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleRemove(item: EquipmentRow) {
    setPendingId(item._id);
    try {
      await remove({ id: item._id });
      toast.success(`${item.name} deleted.`);
    } catch {
      toast.error("Could not delete the item. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>Name</TH>
          <TH>Category</TH>
          <TH>Location</TH>
          <TH className="text-right">Purchase</TH>
          <TH className="text-right">Current</TH>
          <TH className="text-right">Δ value</TH>
          <TH>Status</TH>
          <TH className="w-10" />
        </TR>
      </THead>
      <TBody>
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <TR key={i}>
              {Array.from({ length: COLUMN_COUNT }).map((__, j) => (
                <TD key={j}>
                  <Skeleton className="h-4 w-20" />
                </TD>
              ))}
            </TR>
          ))
        ) : items.length === 0 ? (
          <TR>
            <TD colSpan={COLUMN_COUNT} className="py-10 text-center text-ash-dim">
              {filtering
                ? "No equipment matches the current filters."
                : "No equipment tracked yet."}
            </TD>
          </TR>
        ) : (
          items.map((item) => {
            const meta = categoryMeta(item.category);
            const CategoryIcon = meta.icon;
            const st = statusMeta(item.effectiveStatus);
            const inStorage = item.location === "storage";
            const pending = pendingId === item._id;
            return (
              <TR key={item._id} className={cn(pending && "opacity-50")}>
                <TD>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PhotoThumb photo={item.photo} name={item.name} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-bone">
                        {item.name}
                      </p>
                      {item.serialNumber && (
                        <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                          SN {item.serialNumber}
                        </p>
                      )}
                    </div>
                  </div>
                </TD>
                <TD>
                  <span className="inline-flex items-center gap-1.5">
                    <CategoryIcon className="size-3.5 text-ash-dim" />
                    <Badge tone="neutral">{meta.label}</Badge>
                  </span>
                </TD>
                <TD>
                  {inStorage ? (
                    <Badge tone="caution">
                      <Boxes className="mr-1 size-3" />
                      Storage
                    </Badge>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-ash">
                      <DoorOpen className="size-3.5 text-ash-dim" />
                      {item.roomName ?? "Room"}
                    </span>
                  )}
                </TD>
                <TD className="text-right font-mono tabular-nums text-ash">
                  {money(item.purchaseCents)}
                </TD>
                <TD className="text-right font-mono tabular-nums font-medium text-bone">
                  {money(item.currentValueCents)}
                </TD>
                <TD className="text-right">
                  <DeltaCell delta={item.currentValueCents - item.purchaseCents} />
                </TD>
                <TD>
                  <Badge tone={st.tone} dot>
                    {st.label}
                  </Badge>
                  {!inStorage && (
                    <p className="mt-0.5 font-mono text-[0.5625rem] uppercase tracking-wide text-ash-dim">
                      follows room
                    </p>
                  )}
                </TD>
                <TD>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${item.name}`}
                        disabled={pending}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {inStorage ? (
                        <DropdownMenuItem onSelect={() => onInstall(item)}>
                          <DoorOpen className="size-4" />
                          Install in studio…
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() => handleMoveToStorage(item)}
                        >
                          <Boxes className="size-4" />
                          Move to storage
                        </DropdownMenuItem>
                      )}

                      {inStorage && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Set status</DropdownMenuLabel>
                          {EQUIPMENT_STATUSES.map((s) => (
                            <DropdownMenuItem
                              key={s.value}
                              onSelect={() => handleSetStatus(item, s.value)}
                              disabled={s.value === item.status}
                            >
                              {s.value === item.status
                                ? `${s.label} (current)`
                                : s.label}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}

                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onEdit(item)}>
                        <Package className="size-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        destructive
                        onSelect={() => handleRemove(item)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TD>
              </TR>
            );
          })
        )}
      </TBody>
    </Table>
  );
}
