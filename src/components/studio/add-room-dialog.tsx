"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Switch } from "@/components/ui/toggle";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ROOM_TYPES } from "@/components/studio/constants";

type FormState = {
  name: string;
  roomType: string;
  rate: string;
  condition: string;
  minimumHours: string;
  depositPct: string;
  bookable: boolean;
};

const BLANK: FormState = {
  name: "",
  roomType: "",
  rate: "",
  condition: "",
  minimumHours: "",
  depositPct: "",
  bookable: true,
};

/** The room as the studio page already has it - enough to prefill an edit. */
export type EditableRoom = {
  _id: Id<"rooms">;
  name: string;
  roomType?: string;
  hourlyRateCents?: number;
  condition?: string;
  minimumHours?: number;
  depositPct?: number;
  bookable?: boolean;
};

function dollars(cents?: number): string {
  return typeof cents === "number" ? String(cents / 100) : "";
}

/** A room type is either one of the common presets or free-typed. */
const CUSTOM = "__custom__";
const NONE = "__none__";

/* Add or edit a room. Parent owns `open`; passing `room` switches it to edit.

   The rate lived only in the ADD dialog, so a studio that opened with the
   wrong number - or simply raised its prices - had nowhere to change it. The
   room page showed the rate as a read-only tile and the booking page charged
   it, which is the worst pair of facts to hold at once. */
export function AddRoomDialog({
  open,
  onOpenChange,
  room,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room?: EditableRoom;
}) {
  const createRoom = useMutation(api.rooms.create);
  const updateRoom = useMutation(api.rooms.update);
  const editing = Boolean(room);
  const [form, setForm] = React.useState<FormState>(BLANK);
  const [typeMode, setTypeMode] = React.useState<string>(NONE);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset (or prefill) the form whenever the dialog re-opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      if (room) {
        setForm({
          name: room.name,
          roomType: room.roomType ?? "",
          rate: dollars(room.hourlyRateCents),
          condition: room.condition ?? "",
          minimumHours: room.minimumHours !== undefined ? String(room.minimumHours) : "",
          depositPct: room.depositPct !== undefined ? String(room.depositPct) : "",
          bookable: room.bookable !== false,
        });
        const known = (ROOM_TYPES as readonly string[]).includes(room.roomType ?? "");
        setTypeMode(room.roomType ? (known ? room.roomType : CUSTOM) : NONE);
      } else {
        setForm(BLANK);
        setTypeMode(NONE);
      }
    }
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleTypeMode(value: string) {
    setTypeMode(value);
    if (value === NONE) set("roomType", "");
    else if (value !== CUSTOM) set("roomType", value);
    else set("roomType", "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("Give the room a name.");
      return;
    }
    // Dollars in the form → integer cents for the backend.
    const dollars = parseFloat(form.rate);
    const hourlyRateCents =
      form.rate.trim() && Number.isFinite(dollars) && dollars >= 0
        ? Math.round(dollars * 100)
        : undefined;
    const roomType = form.roomType.trim();
    const minimumHours = form.minimumHours.trim() ? Number(form.minimumHours) : undefined;
    const depositPct = form.depositPct.trim() ? Number(form.depositPct) : undefined;
    if (minimumHours !== undefined && (!Number.isFinite(minimumHours) || minimumHours <= 0)) {
      toast.error("A minimum booking is at least one hour.");
      return;
    }
    if (depositPct !== undefined && (!Number.isFinite(depositPct) || depositPct < 0 || depositPct > 100)) {
      toast.error("A deposit is a percentage between 0 and 100.");
      return;
    }
    setSubmitting(true);
    try {
      if (room) {
        await updateRoom({
          id: room._id,
          name,
          roomType: roomType || undefined,
          hourlyRateCents,
          condition: form.condition.trim() || undefined,
          minimumHours,
          depositPct,
          bookable: form.bookable,
        });
        toast.success(`${name} saved.`);
      } else {
        await createRoom({
          name,
          roomType: roomType || undefined,
          hourlyRateCents,
          condition: form.condition.trim() || undefined,
        });
        toast.success(`${name} added to the studio.`);
      }
      onOpenChange(false);
    } catch {
      toast.error(editing ? "Could not save the room. Try again." : "Could not add the room. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit room" : "Add room"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "The hourly rate, minimum and deposit here are what the public booking page charges for this room."
              : "Track a bookable space in the studio. Type, rate and condition are optional - install gear into rooms from the Inventory page."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="room-name">
              <Input
                id="room-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Studio A, The Booth, Mix Room…"
                autoFocus
                required
              />
            </Field>

            <Field
              label="Room type"
              htmlFor="room-type"
              hint="Pick a common type or choose Custom to type your own."
            >
              <Select value={typeMode} onValueChange={handleTypeMode}>
                <SelectTrigger id="room-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No type</SelectItem>
                  {ROOM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Custom…</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {typeMode === CUSTOM && (
              <Field label="Custom type" htmlFor="room-type-custom">
                <Input
                  id="room-type-custom"
                  value={form.roomType}
                  onChange={(e) => set("roomType", e.target.value)}
                  placeholder="Overdub room, Amp closet…"
                  autoComplete="off"
                />
              </Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Hourly rate"
                htmlFor="room-rate"
                hint="In dollars. Leave blank if non-billable."
              >
                <Input
                  id="room-rate"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.rate}
                  onChange={(e) => set("rate", e.target.value)}
                  placeholder="120"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Condition"
                htmlFor="room-condition"
                hint="A short note on the room's state."
              >
                <Input
                  id="room-condition"
                  value={form.condition}
                  onChange={(e) => set("condition", e.target.value)}
                  placeholder="Excellent, freshly treated…"
                  autoComplete="off"
                />
              </Field>
            </div>

            {/* Booking terms. Only on edit: a room is created first and priced
                once the studio knows what it is selling. */}
            {editing && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Minimum booking"
                    htmlFor="room-min"
                    hint="Hours. The shortest block a client can book."
                  >
                    <Input
                      id="room-min"
                      type="number"
                      min={1}
                      step="1"
                      inputMode="numeric"
                      value={form.minimumHours}
                      onChange={(e) => set("minimumHours", e.target.value)}
                      placeholder="2"
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label="Deposit"
                    htmlFor="room-deposit"
                    hint="Percent of the total, taken to hold the slot."
                  >
                    <Input
                      id="room-deposit"
                      type="number"
                      min={0}
                      max={100}
                      step="1"
                      inputMode="numeric"
                      value={form.depositPct}
                      onChange={(e) => set("depositPct", e.target.value)}
                      placeholder="30"
                      autoComplete="off"
                    />
                  </Field>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border border-graphite/50 bg-coal/40 px-4 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-grotesk text-sm font-semibold text-bone">
                      Bookable by clients
                    </p>
                    <p className="text-xs text-steel">
                      Off keeps the room on your calendar and off the public booking page.
                    </p>
                  </div>
                  <Switch
                    checked={form.bookable}
                    onCheckedChange={(v) => set("bookable", v)}
                    aria-label="Bookable by clients"
                  />
                </div>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {editing ? null : <Plus className="size-4" />}
              {submitting ? (editing ? "Saving…" : "Adding…") : editing ? "Save room" : "Add room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
