"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/feedback";
import { meta, SONG_STAGE } from "@/lib/labels";

/** Pitch a sync - song, supervisor, outlet and an optional target fee. */
export function PitchSyncDialog() {
  const songs = useQuery(api.songs.picker, {});
  const createSync = useMutation(api.licensing.createSync);

  const [open, setOpen] = useState(false);
  const [songId, setSongId] = useState("");
  const [supervisorName, setSupervisorName] = useState("");
  const [outlet, setOutlet] = useState("");
  const [fee, setFee] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setSongId("");
    setSupervisorName("");
    setOutlet("");
    setFee("");
  }

  async function handleSubmit() {
    if (!songId) return toast.error("Pick a song to pitch.");
    if (!supervisorName.trim()) return toast.error("Add the music supervisor.");
    if (!outlet.trim()) return toast.error("Add the outlet - show, film or brand.");

    const feeNumber = fee.trim() === "" ? undefined : Number(fee);
    if (feeNumber !== undefined && (!Number.isFinite(feeNumber) || feeNumber < 0)) {
      return toast.error("Enter a valid target fee.");
    }

    setSubmitting(true);
    try {
      await createSync({
        songId: songId as Id<"songs">,
        supervisorName: supervisorName.trim(),
        outlet: outlet.trim(),
        feeCents: feeNumber !== undefined ? Math.round(feeNumber * 100) : undefined,
      });
      toast.success("Sync pitched.");
      setOpen(false);
      reset();
    } catch {
      toast.error("Could not log the pitch. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Pitch a sync
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Pitch a sync placement</DialogTitle>
          <DialogDescription>
            Log a song pitched to a music supervisor. It lands in the Pitched
            column on the board.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Song">
            <Select value={songId} onValueChange={setSongId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a song…" />
              </SelectTrigger>
              <SelectContent>
                {songs === undefined ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-ash-dim">
                    <Spinner /> Loading catalog…
                  </div>
                ) : songs.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-ash-dim">No songs yet.</div>
                ) : (
                  songs.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.title} · {meta(SONG_STAGE, s.stage).label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Music supervisor" htmlFor="sync-supervisor">
              <Input
                id="sync-supervisor"
                value={supervisorName}
                onChange={(e) => setSupervisorName(e.target.value)}
                placeholder="e.g. Maya Renner"
              />
            </Field>
            <Field label="Outlet" htmlFor="sync-outlet" hint="Show, film, ad or brand.">
              <Input
                id="sync-outlet"
                value={outlet}
                onChange={(e) => setOutlet(e.target.value)}
                placeholder="e.g. Netflix drama"
              />
            </Field>
          </div>

          <Field
            label="Target fee"
            htmlFor="sync-fee"
            hint="Optional - the fee you're aiming for, in dollars."
          >
            <Input
              id="sync-fee"
              type="number"
              min={0}
              step={100}
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="e.g. 7500"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Spinner className="text-gold-ink" /> Pitching…
              </>
            ) : (
              "Pitch sync"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
