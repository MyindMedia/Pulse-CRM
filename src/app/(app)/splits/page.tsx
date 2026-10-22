"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Plus, Scale } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/feedback";
import { SkeletonCards } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";

/* Split sheets, on every plan. Core has no Songs list, so this page is where
   its sheets live: start one (a basic song comes with it), fill in who owns
   what, send for signature. Growth and Max reach the same editor from Songs. */

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "positive" }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Out for signature", tone: "info" },
  fully_executed: { label: "Fully signed", tone: "positive" },
};

export default function SplitSheetsPage() {
  const sheets = useQuery(api.splitSheets.list, {});
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Music"
        title="Split sheets"
        description="Who owns what share of each song, signed by everyone on it."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New split sheet
          </Button>
        }
      />

      {sheets === undefined ? (
        <SkeletonCards cards={3} />
      ) : sheets.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No split sheets yet"
          description="Start one for a song: add each writer and producer with their share and email, then send it for signature."
          action={<Button onClick={() => setOpen(true)}><Plus className="size-4" /> New split sheet</Button>}
        />
      ) : (
        <Card className="divide-y divide-graphite/40">
          {sheets.map((s) => {
            const st = STATUS[s.status];
            return (
              <Link
                key={s._id}
                href={`/splits/${s.songId}`}
                className="flex min-h-11 flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-coal-2/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-bone">{s.songTitle}</p>
                  <p className="truncate text-xs text-steel">
                    {s.artistName ?? "Unknown artist"}
                    {s.isrc ? ` · ${s.isrc}` : ""}
                    {s.total > 0 ? ` · ${s.signed} of ${s.total} signed` : " · no contributors yet"}
                  </p>
                </div>
                {s.imported && <Badge tone="neutral">Imported</Badge>}
                {s.missingEmail > 0 && s.status !== "fully_executed" && (
                  <Badge tone="gold">{s.missingEmail} need an email</Badge>
                )}
                <Badge tone={st.tone}>{st.label}</Badge>
              </Link>
            );
          })}
        </Card>
      )}

      <NewSplitSheetDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function NewSplitSheetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const roster = useQuery(api.artists.roster);
  const create = useMutation(api.splitSheets.createWithSong);
  const [title, setTitle] = React.useState("");
  const [artistId, setArtistId] = React.useState("");
  const [isrc, setIsrc] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return void toast.error("Give the song a title.");
    if (!artistId) return void toast.error("Pick the artist.");
    setBusy(true);
    try {
      const { songId } = await create({ title, artistId: artistId as Id<"artists">, isrc: isrc.trim() || undefined });
      onOpenChange(false);
      setTitle(""); setArtistId(""); setIsrc("");
      router.push(`/splits/${songId}`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not start the split sheet."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New split sheet</DialogTitle>
            <DialogDescription>Name the song and its artist. You add the people and their shares next.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Song title" htmlFor="nss-title">
              <Input id="nss-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" autoFocus />
            </Field>
            <Field label="Artist" htmlFor="nss-artist" hint={roster && roster.length === 0 ? "Add the artist under Clients first." : undefined}>
              <Select value={artistId} onValueChange={setArtistId}>
                <SelectTrigger id="nss-artist">
                  <SelectValue placeholder={roster ? "Select an artist" : "Loading clients…"} />
                </SelectTrigger>
                <SelectContent>
                  {(roster ?? []).map((a) => (
                    <SelectItem key={a._id} value={a._id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ISRC" htmlFor="nss-isrc" hint="Optional. The 12-character code from the distributor.">
              <Input id="nss-isrc" value={isrc} onChange={(e) => setIsrc(e.target.value)} placeholder="USABC2400001" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? "Starting…" : "Start split sheet"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
