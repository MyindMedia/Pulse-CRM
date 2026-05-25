"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CalendarClock, Trash2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/feedback";
import { combineDateTime, toDateInputValue } from "@/components/calendar/constants";

type Opt = { _id: string; name: string };
export type EditableShift = {
  _id: string;
  memberId: string;
  startTime: number;
  endTime: number;
  roomId?: string;
  note?: string;
  status: "scheduled" | "confirmed" | "cancelled";
};

const hhmm = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Schedule a new shift, or drill into an existing one to edit / cancel it. */
export function ShiftDialog({
  open, onOpenChange, members, rooms, defaultDate, defaultMemberId, shift,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: Opt[];
  rooms: Opt[];
  defaultDate?: number;
  defaultMemberId?: string;
  shift?: EditableShift | null;
}) {
  const create = useMutation(api.shifts.create);
  const update = useMutation(api.shifts.update);
  const cancelShift = useMutation(api.shifts.cancel);
  const editing = !!shift;

  const [memberId, setMemberId] = React.useState("");
  const [date, setDate] = React.useState(() => toDateInputValue(Date.now()));
  const [start, setStart] = React.useState("10:00");
  const [end, setEnd] = React.useState("18:00");
  const [roomId, setRoomId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [status, setStatus] = React.useState<EditableShift["status"]>("scheduled");
  const [saving, setSaving] = React.useState(false);

  // Reset on the open transition (render-time pattern - no setState-in-effect).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      if (shift) {
        setMemberId(shift.memberId);
        setDate(toDateInputValue(shift.startTime));
        setStart(hhmm(shift.startTime));
        setEnd(hhmm(shift.endTime));
        setRoomId(shift.roomId ?? "");
        setNote(shift.note ?? "");
        setStatus(shift.status);
      } else {
        setMemberId(defaultMemberId ?? "");
        // eslint-disable-next-line react-hooks/purity -- one-shot snapshot on open
        setDate(toDateInputValue(defaultDate ?? Date.now()));
        setStart("10:00");
        setEnd("18:00");
        setRoomId("");
        setNote("");
        setStatus("scheduled");
      }
    }
  }

  const valid = memberId !== "" && date !== "" && combineDateTime(date, end) > combineDateTime(date, start);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (editing && shift) {
        const res = await update({
          shiftId: shift._id as Id<"shifts">,
          startTime: combineDateTime(date, start),
          endTime: combineDateTime(date, end),
          roomId: roomId ? (roomId as Id<"rooms">) : undefined,
          note: note.trim() || undefined,
          status,
        });
        toast.success("Shift updated. The team member was notified.");
        if (res.conflict) toast.warning("Heads up - this overlaps another shift for that person.");
      } else {
        const res = await create({
          memberId: memberId as Id<"members">,
          startTime: combineDateTime(date, start),
          endTime: combineDateTime(date, end),
          roomId: roomId ? (roomId as Id<"rooms">) : undefined,
          note: note.trim() || undefined,
        });
        toast.success("Shift scheduled. The team member was notified.");
        if (res.conflict) toast.warning("Heads up - this overlaps another shift for that person.");
      }
      onOpenChange(false);
    } catch {
      toast.error("Could not save the shift.");
    } finally {
      setSaving(false);
    }
  }

  async function doCancel() {
    if (!shift || saving) return;
    setSaving(true);
    try {
      await cancelShift({ shiftId: shift._id as Id<"shifts"> });
      toast.success("Shift cancelled. The team member was notified.");
      onOpenChange(false);
    } catch {
      toast.error("Could not cancel the shift.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit shift" : "Schedule a shift"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Reassign, reschedule, or cancel this shift. The team member is notified of any change."
              : "Assign a team member to a time - and a studio if they're staffing one."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <Field label="Team member">
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger><SelectValue placeholder="Select a team member" /></SelectTrigger>
                <SelectContent>
                  {members.map((m) => <SelectItem key={m._id} value={m._id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date" htmlFor="shift-date">
              <Input id="shift-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start" htmlFor="shift-start">
                <Input id="shift-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </Field>
              <Field label="End" htmlFor="shift-end">
                <Input id="shift-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
            <Field label="Studio / room" hint="Optional - which room they're staffing.">
              <Select value={roomId} onValueChange={setRoomId}>
                <SelectTrigger><SelectValue placeholder="No specific room" /></SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {editing && (
              <Field label="Status">
                <Select value={status} onValueChange={(v) => setStatus(v as EditableShift["status"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Note" htmlFor="shift-note">
              <Input id="shift-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
          </DialogBody>
          <DialogFooter>
            {editing ? (
              <Button type="button" variant="ghost" className="mr-auto text-critical" disabled={saving} onClick={doCancel}>
                <Trash2 className="size-3.5" /> Cancel shift
              </Button>
            ) : (
              <DialogClose asChild><Button type="button" variant="ghost" disabled={saving}>Cancel</Button></DialogClose>
            )}
            <Button type="submit" disabled={!valid || saving}>
              {saving ? <Spinner className="text-gold-ink" /> : <CalendarClock className="size-3.5" />}
              {saving ? "Saving" : editing ? "Save changes" : "Schedule shift"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
