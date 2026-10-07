"use client";

import * as React from "react";
import { useQuery, useMutation, useAction, useConvex } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Disc3, Download, MessageSquare, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea, Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/feedback";
import { SkeletonCards } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import { Select2, formatBytes, openUrl, uploadToR2 } from "@/components/library/shared";

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "positive" | "gold" }> = {
  delivered: { label: "Delivered", tone: "info" },
  in_review: { label: "In review", tone: "neutral" },
  approved: { label: "Approved", tone: "positive" },
  final: { label: "Final", tone: "gold" },
};

function Notes({ deliverableId }: { deliverableId: Id<"deliverables"> }) {
  const notes = useQuery(api.finishedMixes.notes, { deliverableId });
  const add = useMutation(api.finishedMixes.addNote);
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try { await add({ deliverableId, body }); setBody(""); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-3 space-y-2 border-t border-graphite/40 pt-3">
      {(notes ?? []).map((n) => (
        <p key={n._id} className="text-sm text-bone">
          {n.body} <span className="text-xs text-steel">{n.author}, {new Date(n.createdAt).toLocaleString()}</span>
        </p>
      ))}
      {notes && notes.length === 0 && <p className="text-xs text-steel">No notes on this version yet.</p>}
      <form onSubmit={submit} className="flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note on this version" aria-label="Note" />
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>Add note</Button>
      </form>
    </div>
  );
}

function AddMix() {
  const songs = useQuery(api.finishedMixes.songChoices, {});
  const prepare = useMutation(api.finishedMixes.prepareUpload);
  const confirm = useAction(api.media.confirmUpload);
  const addVersion = useMutation(api.finishedMixes.addVersion);
  const [songId, setSongId] = React.useState("");
  const [kind, setKind] = React.useState<"mix" | "master">("mix");
  const [label, setLabel] = React.useState("");
  const [note, setNote] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!songId || !file || busy) return;
    setBusy(true);
    try {
      const mediaId = await uploadToR2(file, prepare, confirm);
      const r = await addVersion({ songId: songId as Id<"songs">, kind, label: label || (kind === "master" ? "Master" : "Mix"), mediaId: mediaId as Id<"mediaFiles">, note: note || undefined });
      toast.success(`Version ${r.version} added`);
      setLabel(""); setNote(""); setFile(null);
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Song" htmlFor="mix-song">
          <Select2 id="mix-song" value={songId} onChange={(e) => setSongId(e.target.value)} required>
            <option value="">Choose a song</option>
            {(songs ?? []).map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
          </Select2>
        </Field>
        <Field label="Type" htmlFor="mix-kind">
          <Select2 id="mix-kind" value={kind} onChange={(e) => setKind(e.target.value as "mix" | "master")}>
            <option value="mix">Mix</option>
            <option value="master">Master</option>
          </Select2>
        </Field>
        <Field label="Name" htmlFor="mix-label"><Input id="mix-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Radio edit" /></Field>
        <Field label="File" htmlFor="mix-file"><Input id="mix-file" type="file" accept="audio/*,.wav,.aif,.aiff,.mp3,.flac,.m4a" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Note on this version" htmlFor="mix-note" className="sm:col-span-2"><Textarea id="mix-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy || !songId || !file}><Upload /> {busy ? "Uploading" : "Add version"}</Button>
        </div>
      </form>
    </Card>
  );
}

export default function MixesPage() {
  const access = useQuery(api.mediaLibrary.access, {});
  if (access === undefined) return <SkeletonCards cards={3} />;
  if (!access.mixes) return <EmptyState icon={Disc3} title="Finished mixes are not available here" />;
  return <Mixes />;
}

function Mixes() {
  const list = useQuery(api.finishedMixes.list, {});
  const setStatus = useMutation(api.deliverables.setStatus);
  const convex = useConvex();
  const [open, setOpen] = React.useState<string | null>(null);

  async function download(id: Id<"deliverables">) {
    try { openUrl((await convex.query(api.files.downloadUrl, { deliverableId: id })).url); }
    catch (err) { toast.error(errorMessage(err)); }
  }
  async function approve(id: Id<"deliverables">, status: "approved" | "in_review") {
    try { await setStatus({ id, status }); }
    catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <div className="space-y-6">
      <PageHeader overline="Music" title="Finished mixes" description="Every mix and master, numbered by version, with notes on each version and client approval." />
      <AddMix />
      {list === undefined ? (
        <SkeletonCards cards={3} />
      ) : list.length === 0 ? (
        <EmptyState icon={Disc3} title="No finished mixes yet" description="Add a mix above and it is saved as version 1." />
      ) : (
        list.map((song) => (
          <Card key={song.songId} className="p-4">
            <h2 className="font-grotesk text-base font-semibold text-bone">{song.songTitle}</h2>
            <ul className="mt-3 space-y-3">
              {song.versions.map((v) => {
                const st = STATUS[v.status] ?? STATUS.delivered;
                return (
                  <li key={v._id} className="rounded-lg border border-graphite/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-meta text-sm text-bone">v{v.version}</span>
                      <span className="text-sm text-bone">{v.label}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {v.fileSize ? <span className="text-xs text-steel">{formatBytes(v.fileSize)}</span> : null}
                      {v.approvedBy && v.approvedAt ? <span className="text-xs text-steel">by {v.approvedBy}, {new Date(v.approvedAt).toLocaleDateString()}</span> : null}
                      <span className="ml-auto flex flex-wrap gap-2">
                        {v.hasFile && <Button size="sm" variant="secondary" onClick={() => download(v._id)}><Download /> Download</Button>}
                        {v.status !== "approved" && v.status !== "final" && <Button size="sm" variant="outline" onClick={() => approve(v._id, "approved")}>Approve</Button>}
                        {(v.status === "approved" || v.status === "final") && <Button size="sm" variant="ghost" onClick={() => approve(v._id, "in_review")}>Reopen</Button>}
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === v._id ? null : v._id)}><MessageSquare /> Notes ({v.noteCount})</Button>
                      </span>
                    </div>
                    {open === v._id && <Notes deliverableId={v._id} />}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
