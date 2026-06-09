"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ListPlus, Plus, Star, X } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const SERVICES = ["recording", "mixing", "mastering", "production", "consultation", "rehearsal", "writing"] as const;
const ANY = "__any__";

/** Studio waitlist - artists waiting on an open slot. Smart-fill offers a freed
 *  slot to the best match through the approval inbox. */
export function WaitlistPanel() {
  const entries = useQuery(api.waitlist.list, {});
  const remove = useMutation(api.waitlist.setStatus);
  const [addOpen, setAddOpen] = React.useState(false);

  async function drop(id: Id<"waitlistEntries">) {
    try { await remove({ id, status: "removed" }); toast.success("Removed from waitlist."); }
    catch { toast.error("Could not remove."); }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Waitlist</CardTitle>
            <CardDescription>
              When a slot frees up, the best match is offered automatically through your inbox.
            </CardDescription>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {entries === undefined ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-graphite/60 py-8 text-center text-xs text-steel/70">
            No one is waiting. Add an artist so they get first pick when a slot opens.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {entries.map((e) => (
              <li key={e._id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-coal-3 text-steel/70">
                    {e.priority === "high" ? <Star className="size-3.5 text-gold" /> : <ListPlus className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-bone">{e.artistName}</span>
                    <span className="block truncate font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                      {e.roomName ?? "Any room"}{e.serviceType ? ` · ${e.serviceType}` : ""}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {e.status === "notified" && <Badge tone="gold">offered</Badge>}
                  <button
                    type="button"
                    onClick={() => drop(e._id)}
                    aria-label={`Remove ${e.artistName} from waitlist`}
                    className="rounded-sm p-1 text-steel/70 transition-colors hover:bg-coal-3 hover:text-bone"
                  >
                    <X className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AddToWaitlistDialog open={addOpen} onOpenChange={setAddOpen} />
    </Card>
  );
}

function AddToWaitlistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const artists = useQuery(api.artists.list, open ? {} : "skip");
  const rooms = useQuery(api.rooms.list, open ? {} : "skip");
  const add = useMutation(api.waitlist.add);

  const [artistId, setArtistId] = React.useState("");
  const [roomId, setRoomId] = React.useState(ANY);
  const [serviceType, setServiceType] = React.useState(ANY);
  const [priority, setPriority] = React.useState<"standard" | "high">("standard");
  const [busy, setBusy] = React.useState(false);

  function reset() {
    setArtistId(""); setRoomId(ANY); setServiceType(ANY); setPriority("standard");
  }

  async function submit() {
    if (!artistId) { toast.error("Pick an artist."); return; }
    setBusy(true);
    try {
      await add({
        artistId: artistId as Id<"artists">,
        roomId: roomId === ANY ? undefined : (roomId as Id<"rooms">),
        serviceType: serviceType === ANY ? undefined : (serviceType as (typeof SERVICES)[number]),
        priority,
      });
      toast.success("Added to the waitlist.");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Could not add to the waitlist.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add to waitlist</DialogTitle>
          <DialogDescription>They get first pick when a matching slot opens up.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Artist">
            <Select value={artistId} onValueChange={setArtistId}>
              <SelectTrigger><SelectValue placeholder="Select an artist" /></SelectTrigger>
              <SelectContent>
                {(artists ?? []).map((a) => (
                  <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Preferred room" hint="Optional - leave on Any room for flexibility.">
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any room</SelectItem>
                {(rooms ?? []).map((r) => (
                  <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Service" hint="Optional.">
            <Select value={serviceType} onValueChange={setServiceType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any service</SelectItem>
                {SERVICES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Priority">
            <div className="flex gap-2">
              <Button
                type="button" size="sm"
                variant={priority === "standard" ? "secondary" : "outline"}
                onClick={() => setPriority("standard")}
              >
                Standard
              </Button>
              <Button
                type="button" size="sm"
                variant={priority === "high" ? "secondary" : "outline"}
                onClick={() => setPriority("high")}
              >
                <Star className="size-3.5" /> High
              </Button>
            </div>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !artistId} onClick={submit}>Add to waitlist</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
