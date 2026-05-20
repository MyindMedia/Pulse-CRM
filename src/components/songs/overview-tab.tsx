"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ExternalLink, FileText, Hash, Link2, Pencil, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

type ReferenceTrack = { title: string; url: string; note?: string };

type OverviewSong = {
  _id: Id<"songs">;
  brief?: string;
  referenceTracks: ReferenceTrack[];
  isrc?: string;
  iswc?: string;
  revisionsIncluded: number;
  revisionsUsed: number;
};

export function OverviewTab({ song }: { song: OverviewSong }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <BriefCard song={song} />
        <ReferenceTracksCard song={song} />
      </div>
      <div className="space-y-4">
        <MetadataVaultCard song={song} />
        <RevisionBudgetCard song={song} />
      </div>
    </div>
  );
}

/* ── Creative brief - inline editable ── */
function BriefCard({ song }: { song: OverviewSong }) {
  const update = useMutation(api.songs.update);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(song.brief ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await update({ id: song._id, brief: draft.trim() });
      toast.success("Brief updated.");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the brief.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Creative brief</CardTitle>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(song.brief ?? "");
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="The reference, the mood, the goal for this track…"
              className="min-h-32"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save brief"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : song.brief ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ash">{song.brief}</p>
        ) : (
          <p className="text-sm text-ash-dim">
            No brief yet. Capture the vision so every collaborator works to the same target.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Reference tracks ── */
function ReferenceTracksCard({ song }: { song: OverviewSong }) {
  const addRef = useMutation(api.songs.addReferenceTrack);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim() || !url.trim()) {
      toast.error("A reference needs a title and a link.");
      return;
    }
    setSaving(true);
    try {
      await addRef({
        id: song._id,
        title: title.trim(),
        url: url.trim(),
        note: note.trim() || undefined,
      });
      toast.success("Reference added.");
      setTitle("");
      setUrl("");
      setNote("");
      setAdding(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the reference.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Reference tracks</CardTitle>
        {!adding && (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {song.referenceTracks.length === 0 && !adding && (
          <p className="text-sm text-ash-dim">
            No references attached. Pin the tracks that define the direction.
          </p>
        )}

        {song.referenceTracks.length > 0 && (
          <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline">
            {song.referenceTracks.map((ref, i) => (
              <li
                key={`${ref.url}-${i}`}
                className="flex items-start gap-3 bg-coal-2 px-3 py-2.5"
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-coal-3 text-ash-dim">
                  <Link2 className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-bone">{ref.title}</p>
                  {ref.note && <p className="truncate text-xs text-ash-dim">{ref.note}</p>}
                </div>
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gold hover:underline"
                >
                  Open
                  <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="space-y-3 rounded-md border border-hairline-2 bg-ink-2 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title" htmlFor="ref-title">
                <Input
                  id="ref-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Track name"
                  autoFocus
                />
              </Field>
              <Field label="Link" htmlFor="ref-url">
                <Input
                  id="ref-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                />
              </Field>
            </div>
            <Field label="Note" htmlFor="ref-note" hint="Optional - what to listen for.">
              <Input
                id="ref-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="The drum feel, the vocal stack…"
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Add reference"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAdding(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Metadata vault - ISRC / ISWC inline editable ── */
function MetadataVaultCard({ song }: { song: OverviewSong }) {
  const update = useMutation(api.songs.update);
  const [editing, setEditing] = useState(false);
  const [isrc, setIsrc] = useState(song.isrc ?? "");
  const [iswc, setIswc] = useState(song.iswc ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await update({
        id: song._id,
        isrc: isrc.trim() || undefined,
        iswc: iswc.trim() || undefined,
      });
      toast.success("Metadata saved.");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save metadata.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Hash className="size-4 text-ash-dim" />
          Metadata vault
        </CardTitle>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsrc(song.isrc ?? "");
              setIswc(song.iswc ?? "");
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <>
            <Field label="ISRC" htmlFor="meta-isrc" hint="Recording code - unique per song.">
              <Input
                id="meta-isrc"
                value={isrc}
                onChange={(e) => setIsrc(e.target.value.toUpperCase())}
                placeholder="US-XXX-00-00000"
                autoFocus
              />
            </Field>
            <Field label="ISWC" htmlFor="meta-iswc" hint="Composition code.">
              <Input
                id="meta-iswc"
                value={iswc}
                onChange={(e) => setIswc(e.target.value.toUpperCase())}
                placeholder="T-000.000.000-0"
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <dl className="space-y-2.5">
            <MetaRow label="ISRC" value={song.isrc} />
            <MetaRow label="ISWC" value={song.iswc} />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">{label}</dt>
      <dd>
        {value ? (
          <span className="font-mono text-xs text-bone">{value}</span>
        ) : (
          <Badge tone="neutral">Unassigned</Badge>
        )}
      </dd>
    </div>
  );
}

/* ── Revision budget meter ── */
function RevisionBudgetCard({ song }: { song: OverviewSong }) {
  const over = song.revisionsUsed > song.revisionsIncluded;
  const remaining = song.revisionsIncluded - song.revisionsUsed;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-ash-dim" />
          Revision budget
        </CardTitle>
        <Badge tone={over ? "critical" : remaining <= 1 ? "caution" : "positive"}>
          {over
            ? `${song.revisionsUsed - song.revisionsIncluded} over`
            : `${remaining} left`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-2xl font-bold text-bone">
            {song.revisionsUsed}
          </span>
          <span className="font-mono text-xs text-ash-dim">
            of {song.revisionsIncluded} included
          </span>
        </div>
        <Progress
          value={song.revisionsUsed}
          max={Math.max(song.revisionsIncluded, song.revisionsUsed, 1)}
          tone={over ? "critical" : remaining <= 1 ? "caution" : "gold"}
        />
        <p className="text-xs leading-relaxed text-ash-dim">
          {over
            ? "This song is past its included revisions - bill the overage or upsell a revision pack."
            : "Each revision round is consumed from the Deliverables tab."}
        </p>
      </CardContent>
    </Card>
  );
}
