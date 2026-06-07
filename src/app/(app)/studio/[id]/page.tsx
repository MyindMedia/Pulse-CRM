"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  Calendar as CalendarIcon,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  DollarSign,
  DoorOpen,
  MoreHorizontal,
  Music4,
  Package,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhotoUpload } from "@/components/ui/photo-upload";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { relativeTime } from "@/lib/format";

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

  // Stable "now" snapshot for the week range - keeps render pure.
  const [nowMs] = React.useState(() => Date.now());
  const weekStart = React.useMemo(() => startOfWeek(nowMs), [nowMs]);
  const weekEnd = weekStart + 7 * DAY_MS - 1;
  const weekSessions = useQuery(api.sessions.inRange, {
    from: weekStart,
    to: weekEnd,
  });

  const setRoomStatus = useMutation(api.rooms.setStatus);
  const setRoomAuto = useMutation(api.rooms.setAutoStatus);
  const genRoomPhotoUrl = useMutation(api.rooms.generateUploadUrl);
  const setRoomPhoto = useMutation(api.rooms.setPhoto);
  const clearRoomPhoto = useMutation(api.rooms.clearPhoto);
  const moveToStorage = useMutation(api.equipment.moveToStorage);
  const setEquipStatus = useMutation(api.equipment.setStatus);
  const removeEquip = useMutation(api.equipment.remove);
  const installEquip = useMutation(api.equipment.install);

  // External calendar sync (read-only iCal / Google / Apple / Outlook)
  const calendars = useQuery(api.externalCalendars.listForRoom, { roomId });
  const externalWeekEvents = useQuery(api.externalCalendars.eventsInRange, {
    roomId,
    from: weekStart,
    to: weekEnd,
  });
  const addCalendar = useMutation(api.externalCalendars.add);
  const removeCalendar = useMutation(api.externalCalendars.remove);
  const syncCalendar = useAction(api.externalCalendarsActions.sync);
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [icalUrl, setIcalUrl] = React.useState("");
  const [icalLabel, setIcalLabel] = React.useState("");
  const [connectSubmitting, setConnectSubmitting] = React.useState(false);
  const [syncingCalendarId, setSyncingCalendarId] =
    React.useState<Id<"externalCalendars"> | null>(null);

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
    try {
      await setRoomStatus({ id: room._id, status: next });
      toast.success(`${room.name} pinned to ${ROOM_STATUS[next]?.label.toLowerCase()}.`);
    } catch {
      toast.error("Could not change room status.");
    }
  }

  async function releaseRoomToAuto() {
    try {
      await setRoomAuto({ id: room._id });
      toast.success(`${room.name} back on auto status.`);
    } catch {
      toast.error("Could not release override.");
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

  async function handleConnectCalendar(e: React.FormEvent) {
    e.preventDefault();
    const url = icalUrl.trim();
    if (!url) {
      toast.error("Paste an iCal URL first.");
      return;
    }
    setConnectSubmitting(true);
    try {
      const id = await addCalendar({
        roomId: room._id,
        icalUrl: url,
        label: icalLabel.trim() || undefined,
      });
      setIcalUrl("");
      setIcalLabel("");
      setConnectOpen(false);
      // Kick off the initial sync; non-blocking, fires + forgets.
      setSyncingCalendarId(id);
      const result = await syncCalendar({ id });
      setSyncingCalendarId(null);
      if (result.ok) {
        toast.success(
          `Calendar connected. Imported ${"count" in result ? result.count : 0} events.`,
        );
      } else {
        toast.error(`Connected, but sync failed: ${result.error ?? "unknown"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not connect.");
    } finally {
      setConnectSubmitting(false);
    }
  }

  async function handleSync(id: Id<"externalCalendars">) {
    setSyncingCalendarId(id);
    try {
      const result = await syncCalendar({ id });
      if (result.ok) {
        toast.success(
          `Synced. Imported ${"count" in result ? result.count : 0} events.`,
        );
      } else {
        toast.error(`Sync failed: ${result.error ?? "unknown"}`);
      }
    } finally {
      setSyncingCalendarId(null);
    }
  }

  async function handleRemoveCalendar(id: Id<"externalCalendars">, label: string) {
    if (!confirm(`Remove "${label}" feed? Its imported events will be deleted.`)) return;
    try {
      await removeCalendar({ id });
      toast.success(`Removed ${label}.`);
    } catch {
      toast.error("Could not remove.");
    }
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

      {/* Room photo upload (camera / library) */}
      <PhotoUpload
        photo={room.heroUrl}
        generateUploadUrl={genRoomPhotoUrl}
        onStorageId={(storageId) => setRoomPhoto({ id: room._id, storageId })}
        onClear={() => clearRoomPhoto({ id: room._id })}
        hint="Shown on the room card and your public booking page. Camera or library on mobile."
      />

      {/* Hero band */}
      {room.heroUrl && (
        <div className="relative overflow-hidden rounded-xl border border-hairline shadow-elev-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={room.heroUrl}
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
              <span
                className={cn(
                  "font-mono text-[0.6875rem] uppercase tracking-wide",
                  room.statusSource === "manual" ? "text-gold" : "text-ash",
                )}
                title={
                  room.statusSource === "manual"
                    ? "Status pinned by staff; the calendar won't change it."
                    : "Status follows the live calendar."
                }
              >
                {room.statusSource === "manual" ? "Manual" : "Auto"}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon-sm" aria-label="Room actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    {room.statusSource === "manual" ? "Pinned (manual)" : "Set room status"}
                  </DropdownMenuLabel>
                  {room.statusSource === "manual" && (
                    <DropdownMenuItem onSelect={releaseRoomToAuto}>
                      Back to auto
                    </DropdownMenuItem>
                  )}
                  {ROOM_STATUSES.map((s) => (
                    <DropdownMenuItem
                      key={s.value}
                      onSelect={() => changeRoomStatus(s.value)}
                      disabled={s.value === room.status && room.statusSource === "manual"}
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
          value={room.hourlyRateCents !== undefined ? money(room.hourlyRateCents) : "-"}
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
          value={room.depositPct !== undefined ? `${room.depositPct}%` : "-"}
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
        ) : roomSessions.length === 0 && (externalWeekEvents ?? []).length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No sessions booked this week"
            description="Book a session against this room from the calendar."
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {/* External (synced) events render first, visually muted */}
            {(externalWeekEvents ?? [])
              .slice()
              .sort((a, b) => a.startTime - b.startTime)
              .map((e) => (
                <li
                  key={e._id}
                  className="rounded-lg border border-dashed border-hairline-2 bg-coal-2/40 p-3 shadow-elev-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-bone">{e.title}</p>
                      <p className="flex items-center gap-1 font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
                        <Plug className="size-3" />
                        external · blocked
                      </p>
                    </div>
                    <Badge tone="neutral">SYNC</Badge>
                  </div>
                  <p className="mt-2 font-mono text-xs text-ash">
                    {longDate(e.startTime)} · {timeOfDay(e.startTime)}
                  </p>
                </li>
              ))}
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
          <ul className="overflow-hidden rounded-lg border border-hairline">
            {room.equipment.map((item) => {
              const meta = categoryMeta(item.category);
              const Icon = meta.icon;
              const st = statusMeta(item.status as EquipmentStatus);
              const isPending = pending === item._id;
              return (
                <li
                  key={item._id}
                  className={cn(
                    "flex items-center gap-3 border-b border-hairline-2 bg-coal px-3 py-2.5 last:border-0 hover:bg-coal/50",
                    isPending && "opacity-50",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-hairline bg-ink-2">
                    {item.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.photoUrl} alt={item.name} className="size-full object-cover" />
                    ) : (
                      <Icon className="size-4 text-ash-dim" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-bone">{item.name}</p>
                    {item.condition && (
                      <p className="truncate text-[0.6875rem] text-ash-dim">{item.condition}</p>
                    )}
                  </div>
                  <span className="hidden sm:inline-flex">
                    <Badge tone="neutral">
                      <Icon className="size-3" />
                      {meta.label}
                    </Badge>
                  </span>
                  <Badge tone={st.tone} dot>
                    {st.label}
                  </Badge>
                  <span className="hidden w-24 shrink-0 text-right font-mono text-xs tabular-nums text-bone md:block">
                    {money(item.currentValueCents)}
                    <span className="block text-[0.625rem] text-ash-dim">
                      paid {money(item.purchaseCents)}
                    </span>
                  </span>
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
                      <DropdownMenuItem onSelect={() => openInstallFor({ _id: item._id, name: item.name })}>
                        <DoorOpen className="size-4" />
                        Move to another room
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleMoveToStorage(item._id, item.name)}>
                        <Boxes className="size-4" />
                        Move to storage
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Set status</DropdownMenuLabel>
                      {EQUIPMENT_STATUSES.map((s) => (
                        <DropdownMenuItem
                          key={s.value}
                          onSelect={() => changeEquipStatus(item._id, s.value, item.name)}
                          disabled={s.value === item.status}
                        >
                          {s.value === item.status ? `${s.label} (current)` : s.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => handleRemove(item._id, item.name)}>
                        <Trash2 className="size-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Synced external calendars (Google / Apple / Outlook / .ics) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-bone">
              Synced calendars
            </h2>
            <p className="text-xs text-ash-dim">
              Import an outside calendar so Pulse won&apos;t double-book against it.
            </p>
          </div>
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <CalendarPlus className="size-4" />
            Connect calendar
          </Button>
        </div>
        {calendars === undefined ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : calendars.length === 0 ? (
          <EmptyState
            icon={CalendarIcon}
            title="No external calendars yet"
            description="Paste a Google / Apple / Outlook iCal URL to block out external bookings."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {calendars.map((cal) => {
              const syncing = syncingCalendarId === cal._id;
              return (
                <li
                  key={cal._id}
                  className="rounded-lg border border-hairline bg-coal p-4 shadow-elev-1"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <Plug className="size-4 text-gold" />
                      <p className="truncate text-sm font-medium text-bone">{cal.label}</p>
                    </div>
                    <Badge tone="neutral">{cal.source}</Badge>
                  </div>
                  <p className="mt-2 truncate font-mono text-[0.6875rem] text-ash-dim">
                    {cal.icalUrl}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-[0.6875rem] text-ash">
                      {cal.lastSyncAt ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="size-3 text-positive" />
                          Synced {relativeTime(cal.lastSyncAt)}
                          {typeof cal.eventCount === "number" && (
                            <span className="text-ash-dim">
                              {" · "}
                              {cal.eventCount} events
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-ash-dim">Not synced yet</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleSync(cal._id)}
                        disabled={syncing}
                        aria-label="Refresh"
                      >
                        <RefreshCw
                          className={cn("size-4", syncing && "animate-spin")}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleRemoveCalendar(cal._id, cal.label)}
                        aria-label="Remove"
                      >
                        <Unplug className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {cal.lastError && (
                    <p className="mt-2 text-[0.6875rem] text-critical">{cal.lastError}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Connect-iCal dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Connect an external calendar</DialogTitle>
            <DialogDescription>
              Paste an iCal URL. Google Calendar: Settings &rarr; &quot;Integrate calendar&quot;
              &rarr; &quot;Secret address in iCal format&quot;. Apple, Outlook, Calendly all
              expose a similar URL.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form onSubmit={handleConnectCalendar} className="space-y-4" id="connect-cal-form">
              <Field label="iCal URL">
                <Input
                  type="url"
                  required
                  placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                  value={icalUrl}
                  onChange={(e) => setIcalUrl(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Label (optional)">
                <Input
                  type="text"
                  placeholder="Studio A bookings"
                  value={icalLabel}
                  onChange={(e) => setIcalLabel(e.target.value)}
                />
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setConnectOpen(false)}
              disabled={connectSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="connect-cal-form"
              disabled={connectSubmitting || !icalUrl.trim()}
            >
              {connectSubmitting ? "Connecting..." : "Connect + sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add new equipment - the dialog already has a "install in" picker;
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
