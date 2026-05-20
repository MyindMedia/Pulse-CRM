"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check } from "lucide-react";
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
import {
  ARTIST_STATUSES,
  RELIABILITY_LEVELS,
  type ArtistStatusValue,
  type ReliabilityValue,
} from "@/components/roster/constants";

export type EditableArtist = {
  _id: Id<"artists">;
  name: string;
  status: string;
  reliability: string;
  instagram?: string;
  spotify?: string;
};

type FormState = {
  name: string;
  status: ArtistStatusValue;
  reliability: ReliabilityValue;
  instagram: string;
  spotify: string;
};

function toForm(artist: EditableArtist): FormState {
  return {
    name: artist.name,
    status: artist.status as ArtistStatusValue,
    reliability: artist.reliability as ReliabilityValue,
    instagram: artist.instagram ?? "",
    spotify: artist.spotify ?? "",
  };
}

/** Edit core CRM fields for an existing artist. */
export function EditArtistDialog({
  artist,
  open,
  onOpenChange,
}: {
  artist: EditableArtist;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateArtist = useMutation(api.artists.update);
  const [form, setForm] = React.useState<FormState>(() => toForm(artist));
  const [submitting, setSubmitting] = React.useState(false);

  // Re-seed the form from the latest artist data each time the dialog opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setForm(toForm(artist));
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error("An artist needs a name.");
      return;
    }
    setSubmitting(true);
    try {
      await updateArtist({
        id: artist._id,
        name,
        status: form.status,
        reliability: form.reliability,
        instagram: form.instagram.trim() || undefined,
        spotify: form.spotify.trim() || undefined,
      });
      toast.success("Profile updated.");
      onOpenChange(false);
    } catch {
      toast.error("Could not save changes. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Update the CRM status, reliability and social links for {artist.name}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="edit-name">
              <Input
                id="edit-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status" htmlFor="edit-status">
                <Select
                  value={form.status}
                  onValueChange={(v) => set("status", v as ArtistStatusValue)}
                >
                  <SelectTrigger id="edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ARTIST_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reliability" htmlFor="edit-reliability">
                <Select
                  value={form.reliability}
                  onValueChange={(v) => set("reliability", v as ReliabilityValue)}
                >
                  <SelectTrigger id="edit-reliability">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELIABILITY_LEVELS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field
              label="Instagram"
              htmlFor="edit-instagram"
              hint="Handle or full profile URL."
            >
              <Input
                id="edit-instagram"
                value={form.instagram}
                onChange={(e) => set("instagram", e.target.value)}
                placeholder="@handle"
                autoComplete="off"
              />
            </Field>

            <Field
              label="Spotify"
              htmlFor="edit-spotify"
              hint="Artist profile URL."
            >
              <Input
                id="edit-spotify"
                value={form.spotify}
                onChange={(e) => set("spotify", e.target.value)}
                placeholder="https://open.spotify.com/artist/…"
                autoComplete="off"
              />
            </Field>
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
              <Check className="size-4" />
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
