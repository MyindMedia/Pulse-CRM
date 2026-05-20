"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ArrowUpRight, MoreHorizontal, Package, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ROOM_STATUS,
  ROOM_STATUSES,
  categoryMeta,
  type RoomStatus,
} from "@/components/studio/constants";

/** Equipment installed in a room, as returned by `api.rooms.list` rollup. */
export type RoomEquipment = {
  _id: Id<"equipment">;
  name: string;
  category: string;
  currentValueCents: number;
};

/** A room plus its installed-gear rollup, from `api.rooms.list`. */
export type RoomItem = {
  _id: Id<"rooms">;
  name: string;
  roomType?: string;
  hourlyRateCents?: number;
  status: string;
  condition?: string;
  lastServicedAt?: number;
  nextServiceAt?: number;
  notes?: string;
  heroImageUrl?: string;
  equipmentCount: number;
  equipmentValueCents: number;
};

/**
 * A single bookable room - status, rate, condition, a status menu, and the
 * inventory of equipment installed inside it. Pass `equipment` from a per-room
 * `api.rooms.get` / `api.equipment.forRoom` query; `undefined` shows a skeleton.
 */
export function RoomCard({
  room,
  equipment,
}: {
  room: RoomItem;
  equipment: RoomEquipment[] | undefined;
}) {
  const router = useRouter();
  const setStatus = useMutation(api.rooms.setStatus);
  const [pending, setPending] = React.useState(false);
  const status = ROOM_STATUS[room.status] ?? {
    label: room.status,
    tone: "neutral" as const,
  };

  async function changeStatus(next: RoomStatus) {
    if (next === room.status) return;
    setPending(true);
    try {
      await setStatus({ id: room._id, status: next });
      toast.success(`${room.name} marked ${ROOM_STATUS[next]?.label.toLowerCase()}.`);
    } catch {
      toast.error("Could not change status. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card
      onClick={() => router.push(`/studio/${room._id}`)}
      className={cn(
        "group flex flex-col overflow-hidden cursor-pointer",
        "transition-all duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-gold-dim hover:shadow-elev-3",
        "focus-within:border-gold-dim focus-within:shadow-elev-3",
        pending && "opacity-60",
      )}
    >
      {room.heroImageUrl && (
        <div className="relative aspect-[16/9] w-full overflow-hidden border-b border-hairline bg-coal-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={room.heroImageUrl}
            alt={`${room.name} hero`}
            className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            loading="lazy"
          />
          {/* Gold-tinted bottom fade so the room name reads cleanly on top */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ink/85 to-transparent" />
          {/* Subtle gold sheen on hover */}
          <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br from-gold/[0.08] via-transparent to-transparent" />
        </div>
      )}
      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-4">
        {/* Header - name, type, status menu */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-bone">
              {room.name}
            </p>
            <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              {room.roomType ?? "Room"}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Change status for ${room.name}`}
                disabled={pending}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Set status</DropdownMenuLabel>
              {ROOM_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s.value}
                  onSelect={() => changeStatus(s.value)}
                  disabled={s.value === room.status}
                >
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status + rate */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          {room.hourlyRateCents !== undefined && (
            <span className="font-mono text-xs text-ash">
              {money(room.hourlyRateCents)}
              <span className="text-ash-dim"> / hr</span>
            </span>
          )}
        </div>

        {/* Installed equipment inventory */}
        <div className="space-y-2 border-t border-hairline pt-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
              Installed gear
            </span>
            {room.equipmentCount > 0 && (
              <span className="font-mono text-[0.6875rem] tabular-nums text-ash">
                {room.equipmentCount}
                {" · "}
                <span className="text-bone">{money(room.equipmentValueCents)}</span>
              </span>
            )}
          </div>

          {equipment === undefined ? (
            <div className="space-y-1.5">
              {Array.from({ length: Math.min(room.equipmentCount || 1, 3) }).map(
                (_, i) => (
                  <div key={i} className="skeleton h-6 w-full rounded-sm" />
                ),
              )}
            </div>
          ) : equipment.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[0.6875rem] text-ash-dim">
              <Package className="size-3" />
              No equipment installed.
              <Link
                href="/inventory"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-gold hover:text-gold-bright"
              >
                Add from Inventory
                <ArrowUpRight className="size-3" />
              </Link>
            </p>
          ) : (
            <ul className="space-y-1">
              {equipment.map((item) => {
                const meta = categoryMeta(item.category);
                const Icon = meta.icon;
                return (
                  <li
                    key={item._id}
                    className="flex items-center gap-2 rounded-sm bg-coal-2 px-2 py-1.5"
                  >
                    <Icon className="size-3.5 shrink-0 text-ash-dim" />
                    <span className="min-w-0 flex-1 truncate text-xs text-bone">
                      {item.name}
                    </span>
                    <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                      {meta.label}
                    </span>
                    <span className="font-mono text-[0.6875rem] tabular-nums text-ash">
                      {money(item.currentValueCents, { compact: true })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Service notes */}
        <div className="mt-auto space-y-1.5 border-t border-hairline pt-3">
          {room.condition && (
            <p className="text-xs text-ash">
              <span className="text-ash-dim">Condition · </span>
              {room.condition}
            </p>
          )}
          {room.nextServiceAt !== undefined && (
            <p className="flex items-center gap-1.5 text-[0.6875rem] text-ash-dim">
              <Wrench className="size-3" />
              Next service {shortDate(room.nextServiceAt)}
            </p>
          )}
          {!room.condition && room.nextServiceAt === undefined && (
            <p className="text-[0.6875rem] text-ash-dim">No service notes.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
