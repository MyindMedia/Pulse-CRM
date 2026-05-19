"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Plus, Rocket } from "lucide-react";
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

/** Default the release date 28 days out — a realistic rollout runway. */
function defaultReleaseDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return d.toISOString().slice(0, 10);
}

/**
 * Builder dialog — pick a song and a release date, then create() builds the
 * full 12-step rollout automatically.
 */
export function BuildCampaignDialog() {
  const songs = useQuery(api.songs.picker, {});
  const create = useMutation(api.releases.create);

  const [open, setOpen] = useState(false);
  const [songId, setSongId] = useState<string>("");
  const [releaseDate, setReleaseDate] = useState<string>(defaultReleaseDate());
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setSongId("");
    setReleaseDate(defaultReleaseDate());
  }

  async function handleSubmit() {
    if (!songId) {
      toast.error("Pick a song to roll out.");
      return;
    }
    const ts = new Date(`${releaseDate}T12:00:00`).getTime();
    if (!Number.isFinite(ts)) {
      toast.error("Choose a valid release date.");
      return;
    }
    setSubmitting(true);
    try {
      await create({ songId: songId as Id<"songs">, releaseDate: ts });
      toast.success("Campaign built — 12-step rollout scheduled.");
      setOpen(false);
      reset();
    } catch {
      toast.error("Could not build the campaign. Try again.");
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
          Build campaign
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Build a release campaign</DialogTitle>
          <DialogDescription>
            Pick a song and a release date. Pulse schedules a 12-step rollout
            relative to release day.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Song" hint="Every campaign hangs off one song record.">
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

          <Field
            label="Release date"
            htmlFor="release-date"
            hint="Tasks are offset against this day — D-14, release day, D+7."
          >
            <Input
              id="release-date"
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </Field>

          <div className="flex items-start gap-2.5 rounded-md border border-gold-dim/40 bg-gold/[0.05] px-3 py-2.5">
            <Rocket className="mt-0.5 size-4 shrink-0 text-gold" />
            <p className="text-xs leading-relaxed text-ash">
              The rollout covers teaser drops, pre-save, DSP pitching, art and
              release-day promo — twelve tasks in all, ready to check off.
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || !songId}>
            {submitting ? (
              <>
                <Spinner className="text-gold-ink" /> Building…
              </>
            ) : (
              "Build campaign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
