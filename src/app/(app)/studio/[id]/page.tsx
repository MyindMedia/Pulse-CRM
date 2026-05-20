"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  CalendarClock,
  DollarSign,
  DoorOpen,
  MoreHorizontal,
  Music4,
  Package,
  Pencil,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { money, longDate, timeOfDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ROOM_STATUS,
  ROOM_STATUSES,
  EQUIPMENT_STATUSES,
  categoryMeta,
  statusMeta,
  type RoomStatus,
  type EquipmentStatus,
} from "@/components/studio/constants";
import {
  EquipmentDialog,
  type EditableEquipment,
} from "@/components/inventory/equipment-dialog";
import {
  InstallDialog,
  type InstallTarget,
} from "@/components/inventory/install-dialog";

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Sunday-anchored start of the current calendar week. */
function startOfWeek(ts: number): number {
  const start = startOfDay(ts);
  const dow = new Date(start).getDay();
  return start - dow * DAY_MS;
}

export default function StudioDetailPage() {
  const params = useParams<{ id: string }>();
  const roomId = params.id as Id<"rooms">;

  const detail = useQuery(api.rooms.get, { id: roomId });
  const storage = useQuery(api.equipment.storage);

  // Stable "now" snapshot for the week range — keeps render pure.
  const [nowMs] = React.useState(() => Date.now());
  const weekStart = React.useMemo(() => startOfWeek(nowMs), [nowMs]);
  const weekEnd = weekStart + 7 * DAY_MS - 1;
  const weekSessions = useQuery(api.sessions.inRange, {
    from: weekStart,
    to: weekEnd,
  });

  const setRoomStatus = useMutation(api.rooms.setStatus);
  const moveToStorage = useMutation(api.equipment.moveToStorage);
  const setEquipStatus = useMutation(api.equipment.setStatus);
  const removeEquip = useMutation(api.equipment.remove);
  const installEquip = useMutation(api.equipment.install);

  const [addOpen, setAddOpen] = React.useState(false);
  const [installOpen, setInstallOpen] = React.useState(false);
  const [installTarget, setInstallTarget] = React.useState<InstallTarget | null>(null);
  const [editing, setEditing] = React.useState<EditableEquipment | undefined>();
  const [pending, setPending] = React.useState<Id<"equipment"> | null>(null);

  if (detail === undefined) {
    return (
      <div className="space-y-8">
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 text-sm text-ash hover:text-gold-bright"
        >
          <ArrowLeft className="size-4" />
          All studios
        </Link>
        <Skeleton className="h-72 w-full rounded-xl" />
        <SkeletonCards cards={4} />
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="space-y-6">
        <Link
          href="/studio"
          className="inline-flex items-center gap-1.5 text-sm text-ash hover:text-gold-bright"
        >
          <ArrowLeft className="size-4" />
          All studios
        </Link>
        <EmptyState
          icon={DoorOpen}
          title="Studio not found"
          description="That room may have been retired. Check the studio list."
        />
      </div>
    );
  }

  const room = detail;
  const roomSessions = (weekSessions ?? []).filter((s) => s.roomId === room._id);
  const roomStatus = ROOM_STATUS[room.status as RoomStatus] ?? {
    label: room.status,
    tone: "neutral" as const,
  };
  const equipmentValueCents = detail.equipmentValueCents ?? 0;

  async function changeRoomStatus(next: RoomStatus) {
    if (next === room.status) return;
    try {
      await setRoomStatus({ id: room._id, status: next });
      toast.success(`${room.name} marked ${ROOM_STATUS[next]?.label.toLowerCase()}.`);
    } catch {
      toast.error("Could not change room status.");
    }
  }

  async function changeEquipStatus(id: Id<"equipment">, status: EquipmentStatus, name: string) {
    setPending(id);
    try {
      await setEquipStatus({ id, status });
      toast.success(`${name} marked ${statusMeta(status).label.toLowerCase()}.`);
    } catch {
      toast.error("Could not change status.");
    } finally {
      setPending(null);
    }
  }

  async function handleMoveToStorage(id: Id<"equipment">, name: string) {
    setPending(id);
    try {
      await moveToStorage({ id });
      toast.success(`${name} moved to storage.`);
    } catch {
      toast.error("Could not move that item.");
    } finally {
      setPending(null);
    }
  }

  async function handleRemove(id: Id<"equipment">, name: string) {
    setPending(id);
    try {
      await removeEquip({ id });
      toast.success(`${name} deleted.`);
    } catch {
      toast.error("Could not delete that item.");
    } finally {
      setPending(null);
    }
  }

  function openInstallFor(item: InstallTarget) {
    setInstallTarget(item);
    setInstallOpen(true);
  }

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/studio"
        className="inline-flex items-center gap-1.5 text-sm text-ash hover:text-gold-bright"
      >
        <ArrowLeft className="size-4" />
        All studios
      </Link>

      {/* Hero band */}
      {room.heroImageUrl && (
        <div className="relative overflow-hidden rounded-xl border border-hairline shadow-elev-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={room.heroImageUrl}
            alt={`${room.name} interior`}
            className="aspect-[21/9] w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
          <div className="absolute bottom-4 left-6 right-6 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="overline">{room.roomType ?? "Room"}</p>
              <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight text-bone drop-shadow sm:text-4xl">
                {room.name}
              </h1>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Badge tone={roomStatus.tone} dot>
                {roomStatus.label}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon-sm" aria-label="Room actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Set room status</DropdownMenuLabel>
                  {ROOM_STATUSES.map((s) => (
                    <DropdownMenuItem
                      key={s.value}
                      onSelect={() => changeRoomStatus(s.value)}
                      disabled={s.value === room.status}
                    >
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Installed gear"
          value={String(room.equipment.length)}
          icon={Package}
          hint={room.equipment.length === 0 ? "Empty" : `${money(equipmentValueCents)} value`}
        />
        <StatTile
          label="Hourly rate"
          value={room.hourlyRateCents !== undefined ? money(room.hourlyRateCents) : "—"}
          icon={DollarSign}
          hint={room.minimumHours ? `${room.minimumHours}h minimum` : undefined}
        />
        <StatTile
          label="Sessions this week"
          value={String(roomSessions.length)}
          icon={CalendarClock}
          hint={roomSessions.length === 0 ? "No bookings" : "Sun – Sat"}
        />
        <StatTile
          label="Deposit"
          value={room.depositPct !== undefined ? `${room.depositPct}%` : "—"}
          icon={Wrench}
          hint={room.condition ?? undefined}
        />
      </div>

      {/* This week's sessions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-tight text-bone">
            This week
          </h2>
          <Link
            href="/calendar"
            className="text-xs text-ash hover:text-gold-bright"
          >
            Open calendar →
          </Link>
        </div>
        {weekSessions === undefined ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : roomSessions.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No sessions booked this week"
            description="Book a session against this room from the calendar."
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {roomSessions
              .sort((a, b) => a.startTime - b.startTime)
              .map((s) => (
                <li
                  key={s._id}
                  className="rounded-lg border border-hairline bg-coal p-3 shadow-elev-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-bone">
                        {s.title ?? s.serviceType}
                      </p>
                      <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
                        {s.serviceType}
                        {s.artistName ? ` · ${s.artistName}` : ""}
                      </p>
                    </div>
                    <Badge tone="neutral" dot>
                      {s.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="mt-2 font-mono text-xs text-ash">
                    {longDate(s.startTime)} · {timeOfDay(s.startTime)}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Installed equipment */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold tracking-tight text-bone">
            Installed gear
          </h2>
          <div className="flex items-center gap-2">
            {storage && storage.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Boxes className="size-4" />
                    Install from storage
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel>{storage.length} in storage</DropdownMenuLabel>
                  {storage.map((s) => (
                    <DropdownMenuItem
                      key={s._id}
                      onSelect={async () => {
                        setPending(s._id);
                        try {
                          await installEquip({ id: s._id, roomId: room._id });
                          toast.success(`${s.name} installed in ${room.name}.`);
                        } catch {
                          toast.error("Could not install.");
                        } finally {
                          setPending(null);
                        }
                      }}
                    >
                      <Package className="size-4" />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="font-mono text-[0.625rem] text-ash-dim">
                        {categoryMeta(s.category).label}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add new gear
            </Button>
          </div>
        </div>
        {room.equipment.length === 0 ? (
          <EmptyState
            icon={Music4}
            title="No gear installed yet"
            description="Add a new piece of equipment, or install something out of storage."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {room.equipment.map((item) => {
              const meta = categoryMeta(item.category);
              const Icon = meta.icon;
              const st = statusMeta(item.status as EquipmentStatus);
              const isPending = pending === item._id;
              return (
                <li
                  key={item._id}
                  className={cn(
                    "rounded-lg border border-hairline bg-coal p-4 shadow-elev-1 transition-shadow hover:shadow-elev-2",
                    isPending && "opacity-50",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-hairline bg-ink-2">
                      {item.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.photoUrl}
                          alt={item.name}
                          className="size-full object-cover"
                        />
                      ) : (
                        <Icon className="size-4 text-ash-dim" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-bone">
                          {item.name}
                        </p>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${item.name}`}
                              disabled={isPending}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                setEditing({
                                  _id: item._id,
                                  name: item.name,
                                  category: item.category,
                                  purchaseCents: item.purchaseCents,
                                  currentValueCents: item.currentValueCents,
                                  serialNumber: item.serialNumber,
                                  condition: item.condition,
                                  notes: item.notes,
                                })
                              }
                            >
                              <Pencil className="size-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => handleMoveToStorage(item._id, item.name)}
                            >
                              <Boxes className="size-4" />
                              Move to storage
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Set status</DropdownMenuLabel>
                            {EQUIPMENT_STATUSES.map((s) => (
                              <DropdownMenuItem
                                key={s.value}
                                onSelect={() =>
                                  changeEquipStatus(item._id, s.value, item.name)
                                }
                                disabled={s.value === item.status}
                              >
                                {s.value === item.status
                                  ? `${s.label} (current)`
                                  : s.label}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onSelect={() => handleRemove(item._id, item.name)}
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">
                          <Icon className="size-3" />
                          {meta.label}
                        </Badge>
                        <Badge tone={st.tone} dot>
                          {st.label}
                        </Badge>
                      </div>
                      <p className="mt-1.5 font-mono text-[0.6875rem] tabular-nums text-ash">
                        {money(item.currentValueCents)}
                        <span className="text-ash-dim">
                          {" · "}
                          paid {money(item.purchaseCents)}
                        </span>
                      </p>
                      {item.condition && (
                        <p className="mt-1 text-xs text-ash-dim">{item.condition}</p>
                      )}
                    </div>
                  </div>
                  {/* Hover-quick action: open the install picker if user wants
                      to move this piece to a different room. */}
                  {item.installedInRoomId === room._id && (
                    <button
                      type="button"
                      onClick={() =>
                        openInstallFor({ _id: item._id, name: item.name })
                      }
                      className="mt-3 inline-flex items-center gap-1 text-[0.6875rem] text-ash-dim hover:text-gold"
                    >
                      <DoorOpen className="size-3" />
                      Move to another room
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Add new equipment — the dialog already has a "install in" picker;
          we just preselect this room as a default via its initial form. */}
      <EquipmentDialog open={addOpen} onOpenChange={setAddOpen} />

      {/* Edit equipment */}
      <EquipmentDialog
        item={editing}
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      />

      {/* Install from storage / move within rooms */}
      <InstallDialog
        item={installTarget}
        open={installOpen}
        onOpenChange={(open) => {
          setInstallOpen(open);
          if (!open) setInstallTarget(null);
        }}
      />
    </div>
  );
}
