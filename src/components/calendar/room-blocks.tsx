"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { Check, Lock, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { money, longDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCapabilities } from "@/lib/use-capabilities";
import { startOfDay, toDateInputValue } from "./constants";

export type RoomBlock = {
  _id: Id<"roomBlocks">;
  roomId: Id<"rooms">;
  startTime: number;
  endTime: number;
  granularity: "day" | "week" | "month";
  label: string;
  artistId: Id<"artists"> | null;
  artistName: string | null;
  note: string | null;
  hourlyRateCents: number | null;
  valueCents: number | null;
};

/** Diagonal hatch on a muted ground: reads as "held", not as a session. */
const HATCH =
  "bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(255_255_255/0.06)_5px_10px)] bg-coal-2/60";

/** Switch state + permission in one place. */
export function useRoomBlocks(range: { from: number; to: number } | null, roomId?: string) {
  const { can } = useCapabilities();
  const enabled = useQuery(api.roomBlocks.enabled, {}) === true;
  const blocks = useQuery(
    api.roomBlocks.list,
    enabled && range
      ? { from: range.from, to: range.to, ...(roomId && roomId !== "all" ? { roomId: roomId as Id<"rooms"> } : {}) }
      : "skip",
  ) as RoomBlock[] | undefined;
  return { enabled, canEdit: enabled && can("rooms.edit"), blocks: blocks ?? [] };
}

/** A block's hatched band with its label; click to edit or remove. */
export function BlockBand({
  block,
  roomName,
  onOpen,
  compact,
}: {
  block: RoomBlock;
  roomName?: string;
  onOpen: (b: RoomBlock) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(block);
      }}
      title={`${block.label}${roomName ? ` · ${roomName}` : ""} (room blocked)`}
      className={cn(
        "flex w-full items-center gap-1.5 overflow-hidden rounded-sm border border-dashed border-graphite/70 text-left outline-none transition-colors hover:border-gold/50 focus-visible:ring-2 focus-visible:ring-gold/30",
        HATCH,
        compact ? "px-1.5 py-0.5" : "px-3 py-2",
      )}
    >
      <Lock className="size-3 shrink-0 text-steel/70" aria-hidden />
      <span className={cn("min-w-0 flex-1 truncate font-medium text-steel", compact ? "text-[0.6875rem]" : "text-sm")}>
        {block.label}
        {roomName ? <span className="text-steel/60"> · {roomName}</span> : null}
      </span>
    </button>
  );
}

/** Blocks as a list of bands, for the day / week / agenda views and room page. */
export function BlocksStrip({
  blocks,
  roomNames,
  onOpen,
}: {
  blocks: RoomBlock[];
  roomNames: Record<string, string>;
  onOpen: (b: RoomBlock) => void;
}) {
  if (blocks.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Blocked rooms">
      <h3 className="overline">Blocked rooms</h3>
      <ul className="space-y-1.5">
        {blocks.map((b) => (
          <li key={b._id} className="space-y-0.5">
            <BlockBand block={b} roomName={roomNames[b.roomId]} onOpen={onOpen} />
            <p className="px-1 font-meta text-[0.6875rem] text-steel/70">
              {longDate(b.startTime)} to {longDate(b.endTime - 1)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const GRAN_LABEL = { day: "Day", week: "Week", month: "Month" } as const;
const NO_CLIENT = "none";

function GranularityPicker({
  value,
  onChange,
}: {
  value: RoomBlock["granularity"];
  onChange: (g: RoomBlock["granularity"]) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Block length" className="inline-flex gap-1 rounded-md border border-graphite/50 bg-coal p-1">
      {(["day", "week", "month"] as const).map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          onClick={() => onChange(g)}
          className={cn(
            "rounded-sm px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold/30",
            value === g ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone",
          )}
        >
          {GRAN_LABEL[g]}
        </button>
      ))}
    </div>
  );
}

function BlockForm({
  block,
  defaultRoomId,
  defaultDate,
  onDone,
}: {
  block?: RoomBlock | null;
  defaultRoomId?: string;
  defaultDate?: number;
  onDone: () => void;
}) {
  const rooms = useQuery(api.rooms.bookable);
  const artists = useQuery(api.artists.list, {});
  const create = useMutation(api.roomBlocks.create);
  const update = useMutation(api.roomBlocks.update);
  const remove = useMutation(api.roomBlocks.remove);
  const { role } = useCapabilities();

  const [initDate] = React.useState(() =>
    toDateInputValue(block ? block.startTime : (defaultDate ?? startOfDay(Date.now()))),
  );
  const [roomId, setRoomId] = React.useState<string>(block?.roomId ?? defaultRoomId ?? "");
  const [gran, setGran] = React.useState<RoomBlock["granularity"]>(block?.granularity ?? "day");
  const [startDate, setStartDate] = React.useState(initDate);
  const [endDate, setEndDate] = React.useState(block ? toDateInputValue(block.endTime - 1) : initDate);
  const [label, setLabel] = React.useState(block?.label ?? "");
  const [artistId, setArtistId] = React.useState<string>(block?.artistId ?? NO_CLIENT);
  const [note, setNote] = React.useState(block?.note ?? "");
  const [busy, setBusy] = React.useState(false);
  const [conflict, setConflict] = React.useState<string | null>(null);

  const preview = useQuery(
    api.roomBlocks.preview,
    roomId && startDate && endDate
      ? { roomId: roomId as Id<"rooms">, granularity: gran, startDate, endDate }
      : "skip",
  );

  async function save(force?: boolean) {
    setBusy(true);
    setConflict(null);
    try {
      if (block) {
        await update({
          id: block._id,
          roomId: roomId as Id<"rooms">,
          granularity: gran,
          startDate,
          endDate,
          label,
          artistId: artistId === NO_CLIENT ? null : (artistId as Id<"artists">),
          note,
          force,
        });
        toast.success("Block updated.");
      } else {
        await create({
          roomId: roomId as Id<"rooms">,
          granularity: gran,
          startDate,
          endDate,
          label,
          artistId: artistId === NO_CLIENT ? undefined : (artistId as Id<"artists">),
          note: note || undefined,
          force,
        });
        toast.success("Room blocked.");
      }
      onDone();
    } catch (e) {
      const msg =
        e instanceof ConvexError && typeof e.data === "string"
          ? e.data
          : e instanceof Error
            ? e.message.replace(/^[\s\S]*Uncaught ConvexError:\s*/, "")
            : "Could not save.";
      if (/already booked/i.test(msg)) setConflict(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!block) return;
    setBusy(true);
    try {
      await remove({ id: block._id });
      toast.success("Block removed. The room is open again.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <Field label="Room">
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick a room" />
            </SelectTrigger>
            <SelectContent>
              {(rooms ?? []).map((r) => (
                <SelectItem key={r._id} value={r._id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Length" hint="Day, week and month snap to whole days, weeks or months.">
          <GranularityPicker value={gran} onChange={setGran} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End">
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Label" hint="A client name, or Maintenance">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Maintenance" />
        </Field>
        <Field label="Client (optional)">
          <Select value={artistId} onValueChange={setArtistId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CLIENT}>No client</SelectItem>
              {(artists ?? []).map((a) => (
                <SelectItem key={a._id} value={a._id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {preview && (
          <div className="flex items-center justify-between rounded-md border border-graphite/50 bg-coal-2 px-3 py-2 text-sm">
            <span className="text-steel">
              {longDate(preview.startTime)} to {longDate(preview.endTime - 1)} · {preview.hours}h
            </span>
            {preview.valueCents !== null && (
              <span className="font-meta font-semibold text-gold-bright">
                {money(preview.valueCents)} blocked value
              </span>
            )}
          </div>
        )}
        {conflict && (
          <div role="alert" className="space-y-2 rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-bone">
            <p>{conflict}</p>
            {role === "owner" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void save(true)}>
                Block anyway
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="mt-6 flex items-center justify-between gap-2">
        {block ? (
          <Button variant="ghost" onClick={() => void del()} disabled={busy}>
            <Trash2 className="size-4" />
            Remove block
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={() => void save()} disabled={busy || !roomId || !label.trim() || !startDate || !endDate}>
          <Check className="size-4" />
          {block ? "Save" : "Block room"}
        </Button>
      </div>
    </>
  );
}

/** Create dialog. Reset the form on every open by keying on `open`. */
export function BlockRoomDialog({
  open,
  onOpenChange,
  defaultRoomId,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultRoomId?: string;
  defaultDate?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-4 text-gold" />
            Block room
          </DialogTitle>
          <DialogDescription>
            Hold a room for a day, week or month. It shows as unavailable on your booking page and in
            internal booking.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {open && (
            <BlockForm
              defaultRoomId={defaultRoomId}
              defaultDate={defaultDate}
              onDone={() => onOpenChange(false)}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Edit / remove sheet for an existing block. */
export function BlockSheet({
  block,
  canEdit,
  onClose,
}: {
  block: RoomBlock | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={block !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="sm">
        {block && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Lock className="size-4 text-gold" />
                {block.label}
              </SheetTitle>
              <SheetDescription>
                Room blocked {longDate(block.startTime)} to {longDate(block.endTime - 1)}
                {block.valueCents !== null ? ` · ${money(block.valueCents)} blocked value` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {canEdit ? (
                <BlockForm key={block._id} block={block} onDone={onClose} />
              ) : (
                <p className="text-sm text-steel">
                  {block.artistName ? `${block.artistName}. ` : ""}
                  {block.note ?? "Only owners and managers can change a block."}
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Group blocks by the local days they cover, for the month grid. */
export function blocksByDay(blocks: RoomBlock[], days: number[]): Map<number, RoomBlock[]> {
  const out = new Map<number, RoomBlock[]>();
  for (const d of days) {
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const hit = blocks.filter((b) => b.startTime < next.getTime() && b.endTime > d);
    if (hit.length) out.set(d, hit);
  }
  return out;
}

/** Self-contained mount for the studio room page: this room's blocks for the
 *  next 90 days, a Block room button, and the edit sheet. Renders nothing
 *  while the studio switch is off. */
export function RoomBlocksSection({ roomId, roomName }: { roomId: string; roomName: string }) {
  const [range] = React.useState(() => {
    const from = startOfDay(Date.now());
    return { from, to: from + 90 * 86_400_000 };
  });
  const { enabled, canEdit, blocks } = useRoomBlocks(range, roomId);
  const [open, setOpen] = React.useState(false);
  const [openBlock, setOpenBlock] = React.useState<RoomBlock | null>(null);
  if (!enabled) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-grotesk text-lg font-semibold tracking-tight text-bone">Blocked dates</h2>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Lock className="size-4" />
            Block room
          </Button>
        )}
      </div>
      {blocks.length === 0 ? (
        <p className="text-sm text-steel/70">No blocks in the next 90 days.</p>
      ) : (
        <BlocksStrip blocks={blocks} roomNames={{ [roomId]: roomName }} onOpen={setOpenBlock} />
      )}
      <BlockRoomDialog open={open} onOpenChange={setOpen} defaultRoomId={roomId} />
      <BlockSheet block={openBlock} canEdit={canEdit} onClose={() => setOpenBlock(null)} />
    </section>
  );
}
