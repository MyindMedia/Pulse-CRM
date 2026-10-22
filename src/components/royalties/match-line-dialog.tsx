"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { amount } from "./format";

export type UnmatchedLine = {
  _id: Id<"royaltyLines">;
  isrc: string | null;
  title: string | null;
  artist: string | null;
  currency: string;
  amountCents: number;
};

/** Match an Unmatched Line to one of the studio's songs, or add it as a new song. */
export function MatchLineDialog({ line, onClose }: { line: UnmatchedLine | null; onClose: () => void }) {
  const match = useMutation(api.royalties.matchLine);
  const [search, setSearch] = React.useState("");
  const [picked, setPicked] = React.useState<Id<"songs"> | null>(null);
  const [mode, setMode] = React.useState<"existing" | "new">("existing");
  const [title, setTitle] = React.useState("");
  const [artistName, setArtistName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Seed from the line each time a new one opens.
  const lineId = line?._id;
  React.useEffect(() => {
    if (!line) return;
    setSearch(line.title ?? "");
    setTitle(line.title ?? "");
    setArtistName(line.artist ?? "");
    setPicked(null);
    setMode("existing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  const songs = useQuery(api.songs.list, line && search.trim() ? { search: search.trim() } : "skip");

  async function save() {
    if (!line) return;
    setBusy(true);
    try {
      const res = await match(
        mode === "existing" && picked
          ? { lineId: line._id, songId: picked }
          : { lineId: line._id, create: { title: title.trim(), artistName: artistName.trim() } },
      );
      toast.success(res.state === "allocated" ? "Matched and divided by the signed sheet." : "Matched. It waits for a fully signed split sheet.");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Could not match that line."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={line !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Match these earnings</DialogTitle>
          <DialogDescription>
            {line ? `${line.title ?? "Untitled"}${line.isrc ? ` · ${line.isrc}` : ""} · ${amount(line.amountCents, line.currency)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Match to">
            {(["existing", "new"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "min-h-9 rounded-md border px-3 text-xs font-medium",
                  mode === m ? "border-gold-dim bg-gold/10 text-gold-bright" : "border-graphite/50 bg-coal text-steel",
                )}
              >
                {m === "existing" ? "A song already here" : "Add it as a new song"}
              </button>
            ))}
          </div>
          {mode === "existing" ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search songs" className="pl-9" aria-label="Search songs" />
              </div>
              {songs === undefined && search.trim() ? (
                <Spinner />
              ) : (
                <ul className="max-h-60 space-y-1 overflow-y-auto">
                  {(songs ?? []).slice(0, 20).map((s) => (
                    <li key={s._id}>
                      <button
                        type="button"
                        aria-pressed={picked === s._id}
                        onClick={() => setPicked(s._id)}
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-left",
                          picked === s._id ? "border-gold-dim bg-gold/10" : "border-graphite/50 bg-coal hover:border-graphite",
                        )}
                      >
                        <span className="block truncate text-sm text-bone">{s.title}</span>
                        <span className="block truncate text-xs text-steel/70">
                          {s.artistName}
                          {s.isrc ? ` · ${s.isrc}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                  {songs && songs.length === 0 && <li className="text-sm text-steel">No songs with that title.</li>}
                </ul>
              )}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Song title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Artist">
                <Input value={artistName} onChange={(e) => setArtistName(e.target.value)} />
              </Field>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || (mode === "existing" ? !picked : !title.trim())}
          >
            {busy && <Spinner />}
            Match
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
