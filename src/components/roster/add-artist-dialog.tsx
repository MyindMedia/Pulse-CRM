"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
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
import { TagInput } from "@/components/roster/tag-input";
import { ARTIST_TYPES, ARTIST_STATUSES, type ArtistType, type ArtistStatusValue } from "@/components/roster/constants";

type FormState = {
  name: string;
  type: ArtistType;
  email: string;
  phone: string;
  location: string;
  genres: string[];
  status: ArtistStatusValue;
};

const BLANK: FormState = {
  name: "",
  type: "artist",
  email: "",
  phone: "",
  location: "",
  genres: [],
  status: "lead",
};

/**
 * Controlled Add Artist dialog. The parent owns `open` so the page can
 * auto-open it from a `?new=1` query param.
 */
export function AddArtistDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createArtist = useMutation(api.artists.create);
  const [form, setForm] = React.useState<FormState>(BLANK);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog re-opens.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setForm(BLANK);
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
      const id = await createArtist({
        name,
        type: form.type,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        location: form.location.trim() || undefined,
        genres: form.genres.length ? form.genres : undefined,
        status: form.status,
      });
      toast.success(`${name} added to your clients.`);
      onOpenChange(false);
      router.push(`/roster/${id as Id<"artists">}`);
    } catch {
      toast.error("Could not add the artist. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add artist</DialogTitle>
          <DialogDescription>
            Create a new client. You can fill in the rest from their profile.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor="artist-name">
              <Input
                id="artist-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ada Reyes, Northbound, Solene…"
                autoFocus
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="artist-type">
                <Select
                  value={form.type}
                  onValueChange={(v) => set("type", v as ArtistType)}
                >
                  <SelectTrigger id="artist-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ARTIST_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status" htmlFor="artist-status">
                <Select
                  value={form.status}
                  onValueChange={(v) => set("status", v as ArtistStatusValue)}
                >
                  <SelectTrigger id="artist-status">
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="artist-email">
                <Input
                  id="artist-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="name@studio.com"
                  autoComplete="off"
                />
              </Field>
              <Field label="Phone" htmlFor="artist-phone">
                <Input
                  id="artist-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(555) 010-0199"
                  autoComplete="off"
                />
              </Field>
            </div>

            <Field label="Location" htmlFor="artist-location">
              <Input
                id="artist-location"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="City, region"
                autoComplete="off"
              />
            </Field>

            <Field
              label="Genres"
              htmlFor="artist-genres"
              hint="Press Enter or comma to add each genre."
            >
              <TagInput
                id="artist-genres"
                value={form.genres}
                onChange={(v) => set("genres", v)}
                placeholder="R&B, alt-pop, lo-fi…"
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
              <UserPlus className="size-4" />
              {submitting ? "Adding…" : "Add artist"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
