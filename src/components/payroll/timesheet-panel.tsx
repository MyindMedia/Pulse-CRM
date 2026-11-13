"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CalendarClock, Pencil, Plus, Trash2, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
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
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

/* Timesheet: the punches behind the payroll numbers, and the only place a
   manager fixes them. Every change is logged with who made it and what it was
   before. Removing an entry voids it rather than deleting it, so pay history
   is never lost. An entry left open more than 12 hours needs a clock-out time
   before that teammate's pay for the period can be posted. */

type Entry = {
  _id: Id<"timeEntries">;
  memberId: Id<"members">;
  memberName: string;
  clockInAt: number;
  clockOutAt?: number;
  hours: number;
  note?: string;
  voided: boolean;
  /** The viewer's own entry: nobody corrects their own hours. */
  mine: boolean;
  voidReason?: string;
  needsClockOut: boolean;
  autoClosedReason?: string;
  source: "self" | "manual";
};

/** epoch ms -> "YYYY-MM-DDTHH:mm" in the viewer's own time, for datetime-local. */
function toLocalInput(ts: number | undefined): string {
  if (ts === undefined) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): number | null {
  if (!s) return null;
  const ts = new Date(s).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function when(ts: number | undefined): string {
  if (ts === undefined) return "-";
  return new Date(ts).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const POSTED_AGAIN =
  "This entry is in a pay period already posted to Expenses. Post that period again so the ledger matches.";

function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : fallback;
}

export function TimesheetPanel({
  start,
  end,
  canEdit,
  members,
}: {
  start: number;
  end: number;
  canEdit: boolean;
  members: { memberId: Id<"members">; name: string }[];
}) {
  const entries = useQuery(api.payroll.listEntries, { start, end }) as Entry[] | undefined;
  const adjust = useMutation(api.payroll.adjustEntry);
  const add = useMutation(api.payroll.addManualEntry);
  const remove = useMutation(api.payroll.removeEntry);

  const [editing, setEditing] = React.useState<Entry | null>(null);
  const [removing, setRemoving] = React.useState<Entry | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [inAt, setInAt] = React.useState("");
  const [outAt, setOutAt] = React.useState("");
  const [note, setNote] = React.useState("");
  const [memberId, setMemberId] = React.useState<string>("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const flagged = (entries ?? []).filter((e) => e.needsClockOut).length;

  function openEdit(e: Entry) {
    setEditing(e);
    setInAt(toLocalInput(e.clockInAt));
    setOutAt(toLocalInput(e.clockOutAt));
    setNote(e.note ?? "");
  }

  function openAdd() {
    setAdding(true);
    setMemberId(members[0]?.memberId ?? "");
    setInAt("");
    setOutAt("");
    setNote("");
  }

  async function saveEdit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editing || busy) return;
    const i = fromLocalInput(inAt);
    const o = fromLocalInput(outAt);
    if (i === null) return void toast.error("Enter a clock-in time.");
    setBusy(true);
    try {
      const res = await adjust({
        entryId: editing._id,
        clockInAt: i,
        clockOutAt: o,
        note: note.trim() || undefined,
      });
      toast.success(`Updated ${editing.memberName}'s entry.`);
      if (res?.postedPeriod) toast.info(POSTED_AGAIN);
      setEditing(null);
    } catch (e) {
      toast.error(errText(e, "Could not save the entry."));
    } finally {
      setBusy(false);
    }
  }

  async function saveAdd(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const i = fromLocalInput(inAt);
    const o = fromLocalInput(outAt);
    if (!memberId) return void toast.error("Pick a teammate.");
    if (i === null || o === null) return void toast.error("Enter both a clock-in and a clock-out time.");
    setBusy(true);
    try {
      await add({ memberId: memberId as Id<"members">, clockInAt: i, clockOutAt: o, note: note.trim() || undefined });
      toast.success("Entry added.");
      setAdding(false);
    } catch (e) {
      toast.error(errText(e, "Could not add the entry."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing || busy) return;
    setBusy(true);
    try {
      const res = await remove({ entryId: removing._id, reason: reason.trim() || undefined });
      toast.success("Entry removed from pay. It stays on the record.");
      if (res?.postedPeriod) toast.info(POSTED_AGAIN);
      setRemoving(null);
      setReason("");
    } catch (e) {
      toast.error(errText(e, "Could not remove the entry."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
              <CalendarClock className="size-4" />
            </span>
            <div>
              <p className="font-grotesk text-sm font-semibold text-bone">Timesheet</p>
              <p className="text-xs text-steel">
                Every punch in this period. Changes are logged with who made them.
              </p>
            </div>
          </div>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={openAdd} disabled={members.length === 0}>
              <Plus className="mr-1 size-3.5" /> Add entry
            </Button>
          )}
        </div>

        {flagged > 0 && (
          <p role="status" className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-bone">
            {flagged === 1 ? "1 entry needs" : `${flagged} entries need`} a clock-out time. Until it is set, those hours are
            left out of pay and that teammate&apos;s pay for this period is not posted.
          </p>
        )}

        {entries === undefined ? (
          <p className="py-6 text-center text-sm text-steel/70">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="rounded-md border border-graphite/50 bg-coal/30 px-3 py-6 text-center text-sm text-steel">
            No punches in this period.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li
                key={e._id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5 ${e.voided ? "opacity-60" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-bone">{e.memberName}</span>
                    {e.voided && <Badge tone="neutral">removed</Badge>}
                    {e.needsClockOut && <Badge tone="caution">needs a clock-out time</Badge>}
                    {!e.voided && !e.needsClockOut && e.clockOutAt === undefined && <Badge tone="info">on the clock</Badge>}
                    {e.source === "manual" && !e.voided && <Badge tone="neutral">added by a manager</Badge>}
                  </span>
                  <span className={`mt-0.5 block break-words text-xs text-steel/80 ${e.voided ? "line-through" : ""}`}>
                    {when(e.clockInAt)} to {e.clockOutAt === undefined ? "no clock-out" : when(e.clockOutAt)}
                  </span>
                  {(e.voidReason || e.note) && (
                    <span className="mt-0.5 block break-words text-xs text-steel/60">{e.voided ? e.voidReason : e.note}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-bone">{e.hours.toFixed(2)}h</span>
                {canEdit && !e.voided && !e.mine && (
                  <span className="flex shrink-0 gap-1">
                    <IconButton variant="ghost" size="icon" label={`Edit ${e.memberName}'s entry`} onClick={() => openEdit(e)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton variant="ghost" size="icon" label={`Remove ${e.memberName}'s entry`} onClick={() => { setRemoving(e); setReason(""); }}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Fix a time entry - {editing?.memberName}</DialogTitle>
            <DialogDescription>
              If this period&apos;s pay was already posted to Expenses, the posted amount does not change by itself.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit}>
            <DialogBody className="space-y-4">
              <Field label="Clocked in">
                <Input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} required />
              </Field>
              <Field label="Clocked out" hint="Leave empty to keep the clock running">
                <Input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} />
              </Field>
              <Field label="Note" hint="Optional">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}><Check className="size-4" /> {busy ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add a time entry</DialogTitle>
            <DialogDescription>For a shift someone worked but did not clock.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveAdd}>
            <DialogBody className="space-y-4">
              <Field label="Teammate">
                <Select value={memberId} onValueChange={setMemberId}>
                  <SelectTrigger aria-label="Teammate"><SelectValue placeholder="Pick a teammate" /></SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.memberId} value={m.memberId}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Clocked in">
                <Input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} required />
              </Field>
              <Field label="Clocked out">
                <Input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} required />
              </Field>
              <Field label="Note" hint="Optional">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}><Plus className="size-4" /> {busy ? "Adding…" : "Add entry"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(o) => { if (!o) setRemoving(null); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove this entry from pay?</DialogTitle>
            <DialogDescription>
              {removing ? `${removing.memberName}, ${when(removing.clockInAt)}. ` : ""}
              It stops counting toward pay but stays on the record, with your name and reason.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Reason" hint="Optional">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Punched in by mistake" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
            <Button type="button" onClick={confirmRemove} disabled={busy}>
              <Trash2 className="size-4" /> {busy ? "Removing…" : "Remove from pay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
