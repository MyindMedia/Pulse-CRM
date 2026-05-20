"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
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
};

const BLANK: FormState = {
  name: "",
  roomType: "",
  rate: "",
  condition: "",
};

/** A room type is either one of the common presets or free-typed. */
const CUSTOM = "__custom__";
const NONE = "__none__";

/** Create a new bookable room. Parent owns `open`. */
export function AddRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createRoom = useMutation(api.rooms.create);
  const [form, setForm] = React.useState<FormState>(BLANK);
  const [typeMode, setTypeMode] = React.useState<string>(NONE);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog re-opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setForm(BLANK);
      setTypeMode(NONE);
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
    setSubmitting(true);
    try {
      await createRoom({
        name,
        roomType: roomType || undefined,
        hourlyRateCents,
        condition: form.condition.trim() || undefined,
      });
      toast.success(`${name} added to the studio.`);
      onOpenChange(false);
    } catch {
      toast.error("Could not add the room. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add room</DialogTitle>
          <DialogDescription>
            Track a bookable space in the studio. Type, rate and condition are
            optional — install gear into rooms from the Inventory page.
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
              <Plus className="size-4" />
              {submitting ? "Adding…" : "Add room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
