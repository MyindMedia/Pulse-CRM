"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Link2, Loader2, Sparkles } from "lucide-react";
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
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

/*
 * Import-from-link dialog for an EXISTING song: paste a Spotify or Apple
 * Music link, preview what came back (cover, metadata, credits), then apply -
 * cover art + blank metadata land on the song, credits draft the split sheet.
 */

export type LinkImport = {
  provider: "spotify" | "apple";
  title: string | null;
  artistName: string | null;
  album: string | null;
  genre: string | null;
  releaseDate: number | null;
  coverStorageId: Id<"_storage"> | null;
  coverPreviewUrl: string | null;
  credits: { name: string; role: string }[];
};

export function ImportPreview({ result }: { result: LinkImport }) {
  return (
    <div className="rounded-md border border-graphite/50 bg-coal-2 p-3">
      <div className="flex items-center gap-3">
        {result.coverPreviewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={result.coverPreviewUrl}
            alt=""
            className="size-16 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-md bg-coal-3 text-steel/50">
            <Sparkles className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-bone">{result.title ?? "Unknown title"}</p>
          <p className="truncate text-xs text-steel/70">
            {[result.artistName, result.album].filter(Boolean).join(" · ") || "-"}
          </p>
          <p className="mt-0.5 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
            {[
              result.provider === "spotify" ? "Spotify" : "Apple Music",
              result.genre,
              result.releaseDate ? new Date(result.releaseDate).getFullYear() : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      {result.credits.length > 0 && (
        <div className="mt-3 border-t border-graphite/50 pt-2.5">
          <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
            Credits found
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {result.credits.map((c) => (
              <Badge key={`${c.name}-${c.role}`} tone="neutral">
                {c.name} · {c.role}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ImportLinkDialog({
  open,
  onOpenChange,
  songId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  songId: Id<"songs">;
}) {
  const fetchFromLink = useAction(api.songImport.fetchFromLink);
  const applyToSong = useMutation(api.songImport.applyToSong);

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<LinkImport | null>(null);
  const [applying, setApplying] = useState(false);

  async function runFetch() {
    if (!url.trim() || fetching) return;
    setFetching(true);
    setResult(null);
    try {
      setResult(await fetchFromLink({ url: url.trim() }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that link.");
    } finally {
      setFetching(false);
    }
  }

  async function apply() {
    if (!result || applying) return;
    setApplying(true);
    try {
      const { sheetPrefilled } = await applyToSong({
        songId,
        sourceUrl: url.trim(),
        coverStorageId: result.coverStorageId ?? undefined,
        genre: result.genre ?? undefined,
        releaseDate: result.releaseDate ?? undefined,
        artistName: result.artistName ?? undefined,
        credits: result.credits,
      });
      toast.success(
        sheetPrefilled
          ? "Imported - cover art applied and the split sheet drafted from the credits."
          : "Imported - cover art and metadata applied.",
      );
      onOpenChange(false);
      setUrl("");
      setResult(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply the import.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !fetching && !applying && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import from Spotify or Apple Music</DialogTitle>
          <DialogDescription>
            Paste the track&apos;s link to pull its cover art, metadata and credited
            writers/producers. Credits draft the split sheet when one hasn&apos;t been started.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Track link" htmlFor="il-url">
            <div className="flex gap-2">
              <Input
                id="il-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://open.spotify.com/track/… or https://music.apple.com/…"
                onKeyDown={(e) => e.key === "Enter" && runFetch()}
              />
              <Button variant="secondary" onClick={runFetch} disabled={fetching || !url.trim()}>
                {fetching ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Fetch
              </Button>
            </div>
          </Field>

          {result && <ImportPreview result={result} />}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={fetching || applying}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={apply} disabled={!result || applying}>
            {applying ? "Applying…" : "Apply to song"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
