"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";
import { ImportPreview, type LinkImport } from "@/components/songs/import-link-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "album_track", label: "Album track" },
  { value: "ep", label: "EP" },
  { value: "beat", label: "Beat" },
  { value: "spec", label: "Spec" },
];

const MODE_OPTIONS = ["Major", "Minor"];

/** New-song creation dialog - controlled open state, routes to the new song on submit. */
export function NewSongDialog({
  open,
  onOpenChange,
  routeOnCreate = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeOnCreate?: boolean;
}) {
  const router = useRouter();
  const roster = useQuery(api.artists.roster);
  const createSong = useMutation(api.songs.create);
  const fetchFromLink = useAction(api.songImport.fetchFromLink);
  const applyImport = useMutation(api.songImport.applyToSong);

  const [title, setTitle] = useState("");
  const [artistId, setArtistId] = useState("");
  const [kind, setKind] = useState("single");
  const [genre, setGenre] = useState("");
  const [bpm, setBpm] = useState("");
  const [musicalKey, setMusicalKey] = useState("");
  const [mode, setMode] = useState("");
  const [brief, setBrief] = useState("");
  const [revisions, setRevisions] = useState("3");
  const [submitting, setSubmitting] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<LinkImport | null>(null);

  function reset() {
    setTitle("");
    setArtistId("");
    setKind("single");
    setGenre("");
    setBpm("");
    setMusicalKey("");
    setMode("");
    setBrief("");
    setRevisions("3");
    setImportUrl("");
    setImported(null);
  }

  /** Pull metadata/credits/cover from a streaming link and prefill the form.
      The heavier writes (cover, split-sheet draft) apply after creation. */
  async function runImport() {
    if (!importUrl.trim() || importing) return;
    setImporting(true);
    try {
      const result = await fetchFromLink({ url: importUrl.trim() });
      setImported(result);
      if (result.title) setTitle(result.title);
      if (result.genre && !genre.trim()) setGenre(result.genre);
      // Auto-select the artist when a roster name matches the import.
      if (result.artistName && !artistId) {
        const match = (roster ?? []).find(
          (a) => a.name.trim().toLowerCase() === result.artistName!.trim().toLowerCase(),
        );
        if (match) setArtistId(match._id);
      }
      toast.success("Imported - review the prefilled details and create the song.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that link.");
    } finally {
      setImporting(false);
    }
  }

  async function submit() {
    if (!title.trim()) {
      toast.error("Give the song a title.");
      return;
    }
    if (!artistId) {
      toast.error("Pick an artist for this song.");
      return;
    }
    setSubmitting(true);
    try {
      const bpmNum = bpm.trim() ? Number(bpm) : undefined;
      const revNum = revisions.trim() ? Number(revisions) : undefined;
      const id = await createSong({
        title: title.trim(),
        artistId: artistId as Parameters<typeof createSong>[0]["artistId"],
        kind: kind as Parameters<typeof createSong>[0]["kind"],
        genre: genre.trim() || undefined,
        bpm: bpmNum !== undefined && Number.isFinite(bpmNum) ? bpmNum : undefined,
        musicalKey: musicalKey.trim() || undefined,
        mode: mode || undefined,
        brief: brief.trim() || undefined,
        revisionsIncluded:
          revNum !== undefined && Number.isFinite(revNum) ? revNum : undefined,
      });
      // The link import lands after creation: cover art, remaining metadata
      // and the credit-drafted split sheet attach to the new song.
      if (imported) {
        try {
          await applyImport({
            songId: id,
            sourceUrl: importUrl.trim(),
            coverStorageId: imported.coverStorageId ?? undefined,
            genre: imported.genre ?? undefined,
            releaseDate: imported.releaseDate ?? undefined,
            artistName: imported.artistName ?? undefined,
            credits: imported.credits,
          });
        } catch {
          toast.error("Song created, but the import couldn't be applied - retry from its page.");
        }
      }
      toast.success(`"${title.trim()}" added to the catalog.`);
      onOpenChange(false);
      reset();
      if (routeOnCreate) router.push(`/songs/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the song.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New song</DialogTitle>
          <DialogDescription>
            Start a track in the writing stage - you can fill in the rest from its detail page.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field
            label="Import from a link"
            htmlFor="ns-import"
            hint="Optional - Spotify or Apple Music. Pulls cover art, metadata and credits."
          >
            <div className="flex gap-2">
              <Input
                id="ns-import"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://open.spotify.com/track/…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runImport();
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={runImport}
                disabled={importing || !importUrl.trim()}
              >
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Import
              </Button>
            </div>
          </Field>
          {imported && <ImportPreview result={imported} />}

          <Field label="Title" htmlFor="ns-title">
            <Input
              id="ns-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Working title"
              autoFocus
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Artist" htmlFor="ns-artist">
              <Select value={artistId} onValueChange={setArtistId}>
                <SelectTrigger id="ns-artist">
                  <SelectValue placeholder={roster ? "Select an artist" : "Loading roster…"} />
                </SelectTrigger>
                <SelectContent>
                  {(roster ?? []).map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Kind" htmlFor="ns-kind">
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="ns-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Genre" htmlFor="ns-genre" className="sm:col-span-2">
              <Input
                id="ns-genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="R&B, Trap…"
              />
            </Field>
            <Field label="BPM" htmlFor="ns-bpm">
              <Input
                id="ns-bpm"
                value={bpm}
                onChange={(e) => setBpm(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="128"
                inputMode="numeric"
              />
            </Field>
            <Field label="Revisions" htmlFor="ns-rev" hint="Included">
              <Input
                id="ns-rev"
                value={revisions}
                onChange={(e) => setRevisions(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="3"
                inputMode="numeric"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key" htmlFor="ns-key">
              <Input
                id="ns-key"
                value={musicalKey}
                onChange={(e) => setMusicalKey(e.target.value)}
                placeholder="F#"
              />
            </Field>
            <Field label="Mode" htmlFor="ns-mode">
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger id="ns-mode">
                  <SelectValue placeholder="Major / Minor" />
                </SelectTrigger>
                <SelectContent>
                  {MODE_OPTIONS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Creative brief" htmlFor="ns-brief" hint="Optional - the vision in a sentence or two.">
            <Textarea
              id="ns-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="The reference, the mood, the goal…"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create song"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
