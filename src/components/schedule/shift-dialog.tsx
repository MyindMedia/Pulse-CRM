"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
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

/** Schedule a staff shift (manager). Optional studio/room assignment. */
export function ShiftDialog({
  open, onOpenChange, members, rooms, defaultDate, defaultMemberId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: Opt[];
  rooms: Opt[];
  defaultDate?: number;
  defaultMemberId?: string;
}) {
  const create = useMutation(api.shifts.create);
  const [memberId, setMemberId] = React.useState(defaultMemberId ?? "");
  const [date, setDate] = React.useState(toDateInputValue(defaultDate ?? Date.now()));
  const [start, setStart] = React.useState("10:00");
  const [end, setEnd] = React.useState("18:00");
  const [roomId, setRoomId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // Reset on the open transition (render-time, matching the codebase pattern -
  // avoids a setState-in-effect cascade).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setMemberId(defaultMemberId ?? "");
      // eslint-disable-next-line react-hooks/purity -- one-shot "today" snapshot on open transition
      setDate(toDateInputValue(defaultDate ?? Date.now()));
      setStart("10:00");
      setEnd("18:00");
      setRoomId("");
      setNote("");
    }
  }

  const valid = memberId !== "" && date !== "" && combineDateTime(date, end) > combineDateTime(date, start);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const res = await create({
        memberId: memberId as Id<"members">,
        startTime: combineDateTime(date, start),
        endTime: combineDateTime(date, end),
        roomId: roomId ? (roomId as Id<"rooms">) : undefined,
        note: note.trim() || undefined,
      });
      toast.success("Shift scheduled.");
      if (res.conflict) toast.warning("Heads up - this overlaps another shift for that person.");
      onOpenChange(false);
    } catch {
      toast.error("Could not schedule the shift.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Schedule a shift</DialogTitle>
          <DialogDescription>Assign a team member to a time - and a studio if they’re staffing one.</DialogDescription>
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
            <Field label="Note" htmlFor="shift-note">
              <Input id="shift-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost" disabled={saving}>Cancel</Button></DialogClose>
            <Button type="submit" disabled={!valid || saving}>
              {saving ? <Spinner className="text-gold-ink" /> : <CalendarClock className="size-3.5" />}
              {saving ? "Scheduling" : "Schedule shift"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
