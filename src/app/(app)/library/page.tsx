"use client";

import * as React from "react";
import { useQuery, useMutation, useAction, useConvex } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Copy, Download, FolderOpen, RotateCcw, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/feedback";
import { SkeletonCards } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors";
import { APPROVAL, Select2, formatBytes, openUrl, uploadToR2 } from "@/components/library/shared";

const KINDS = ["session", "stem", "mix", "master", "artwork", "deliverable", "other"] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = { session: "Session", stem: "Stems", mix: "Mix", master: "Master", artwork: "Artwork", deliverable: "Deliverable", other: "Other" };

function useUploader() {
  const prepare = useMutation(api.mediaLibrary.prepareUpload);
  const confirm = useAction(api.media.confirmUpload);
  return (file: File) => uploadToR2(file, prepare, confirm) as Promise<Id<"mediaFiles">>;
}

function NewFile({ onDone }: { onDone: () => void }) {
  const upload = useUploader();
  const add = useMutation(api.mediaLibrary.addVersion);
  const links = useQuery(api.mediaLibrary.linkChoices, {});
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("mix");
  const [tags, setTags] = React.useState("");
  const [songId, setSongId] = React.useState("");
  const [sessionId, setSessionId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    try {
      const mediaId = await upload(file);
      await add({
        mediaId, name: name || file.name, kind,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        songId: songId ? (songId as Id<"songs">) : undefined,
        sessionId: sessionId ? (sessionId as Id<"sessions">) : undefined,
        note: note || undefined,
      });
      toast.success("Saved as version 1");
      setName(""); setTags(""); setNote(""); setFile(null);
      onDone();
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="File" htmlFor="lib-file"><Input id="lib-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <Field label="Name" htmlFor="lib-name"><Input id="lib-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={file?.name ?? "Final master"} /></Field>
        <Field label="Kind" htmlFor="lib-kind">
          <Select2 id="lib-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select2>
        </Field>
        <Field label="Tags" htmlFor="lib-tags" hint="Comma separated"><Input id="lib-tags" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <Field label="Song" htmlFor="lib-song">
          <Select2 id="lib-song" value={songId} onChange={(e) => setSongId(e.target.value)}>
            <option value="">None</option>
            {(links?.songs ?? []).map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
          </Select2>
        </Field>
        <Field label="Session" htmlFor="lib-session">
          <Select2 id="lib-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">None</option>
            {(links?.sessions ?? []).map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
          </Select2>
        </Field>
        <Field label="Note on this version" htmlFor="lib-note" className="sm:col-span-3"><Input id="lib-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="sm:col-span-3"><Button type="submit" disabled={busy || !file}><Upload /> {busy ? "Uploading" : "Upload"}</Button></div>
      </form>
    </Card>
  );
}

function GuestLinks({ assetId }: { assetId: Id<"mediaAssets"> }) {
  const links = useQuery(api.mediaLibrary.guestLinks, { assetId });
  const issue = useMutation(api.mediaLibrary.issueGuestLink);
  const revoke = useMutation(api.grants.revoke);
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [days, setDays] = React.useState("7");
  const [canApprove, setCanApprove] = React.useState(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await issue({ assetId, email, name: name || email, ttlMs: Math.max(1, Number(days) || 7) * 86_400_000, canApprove });
      await navigator.clipboard?.writeText(`${window.location.origin}/files/${r.token}`).catch(() => undefined);
      toast.success("Link created and copied");
      setEmail(""); setName("");
    } catch (err) { toast.error(errorMessage(err)); }
  }
  return (
    <div className="mt-4 space-y-2 border-t border-graphite/40 pt-3">
      <h4 className="overline">Guest links that expire</h4>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Input className="w-48" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Guest email" />
        <Input className="w-36" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Guest name" />
        <Input className="w-20" type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days until it expires" />
        <label className="flex items-center gap-1 text-xs text-steel"><input type="checkbox" checked={canApprove} onChange={(e) => setCanApprove(e.target.checked)} /> Can approve</label>
        <Button size="sm" type="submit">Create link</Button>
      </form>
      <ul className="space-y-1">
        {(links ?? []).map((l) => (
          <li key={l._id} className="flex flex-wrap items-center gap-2 text-sm text-bone">
            {l.name} <span className="text-xs text-steel">{l.email}</span>
            <Badge tone={l.revoked ? "critical" : l.expired ? "caution" : "positive"}>{l.revoked ? "Revoked" : l.expired ? "Expired" : `Expires ${new Date(l.expiresAt).toLocaleDateString()}`}</Badge>
            {!l.revoked && !l.expired && (
              <>
                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/files/${l.token}`).then(() => toast.success("Copied"))}><Copy /> Copy</Button>
                <Button size="sm" variant="ghost" onClick={() => revoke({ grantId: l._id }).catch((err) => toast.error(errorMessage(err)))}>Revoke</Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ assetId, onDeleted }: { assetId: Id<"mediaAssets">; onDeleted: () => void }) {
  const d = useQuery(api.mediaLibrary.detail, { assetId });
  const convex = useConvex();
  const upload = useUploader();
  const addVersion = useMutation(api.mediaLibrary.addVersion);
  const restore = useMutation(api.mediaLibrary.restoreVersion);
  const addNote = useMutation(api.mediaLibrary.addNote);
  const setApproval = useMutation(api.mediaLibrary.setApproval);
  const del = useMutation(api.mediaLibrary.deleteAsset);
  const [noteFor, setNoteFor] = React.useState<string | null>(null);
  const [noteBody, setNoteBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  if (!d) return <SkeletonCards cards={1} />;
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (err) { toast.error(errorMessage(err)); } };

  async function newVersion(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    await run(async () => {
      const mediaId = await upload(file);
      const r = await addVersion({ mediaId, assetId });
      toast.success(`Version ${r.version} added`);
    });
    setBusy(false);
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-grotesk text-lg font-semibold text-bone">{d.asset.name}</h3>
        <Badge>{KIND_LABEL[d.asset.kind]}</Badge>
        {d.asset.tags.map((t) => <Badge key={t} tone="info">{t}</Badge>)}
        <span className="text-xs text-steel">{d.asset.versionCount} versions, {formatBytes(d.asset.totalBytes)}</span>
        <span className="ml-auto flex gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-graphite/60 px-3 py-1.5 text-xs text-bone hover:border-gold">
            <Upload className="size-4" /> {busy ? "Uploading" : "New version"}
            <input type="file" className="sr-only" disabled={busy} onChange={(e) => newVersion(e.target.files?.[0])} />
          </label>
          <Button size="sm" variant="danger" onClick={() => { if (window.confirm("Delete this file and every version?")) run(async () => { await del({ assetId }); onDeleted(); }); }}><Trash2 /> Delete</Button>
        </span>
      </div>
      <ul className="mt-3 space-y-3">
        {d.versions.map((v) => {
          const ap = APPROVAL[v.approval];
          return (
            <li key={v._id} className="rounded-lg border border-graphite/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-meta text-sm text-bone">v{v.version}</span>
                <span className="text-sm text-bone">{v.fileName}</span>
                <span className="text-xs text-steel">{formatBytes(v.size)}</span>
                <Badge tone={ap.tone}>{ap.label}</Badge>
                <span className="text-xs text-steel">{v.uploadedBy}, {new Date(v.uploadedAt).toLocaleString()}</span>
                {v.restoredFrom ? <span className="text-xs text-steel">restored from v{v.restoredFrom}</span> : null}
                {v.approvedBy && v.approvedAt ? <span className="text-xs text-steel">{ap.label.toLowerCase()} by {v.approvedBy}, {new Date(v.approvedAt).toLocaleDateString()}</span> : null}
              </div>
              {v.note && <p className="mt-1 text-sm text-steel">{v.note}</p>}
              {v.approvalNote && <p className="mt-1 text-sm text-steel">Client: {v.approvalNote}</p>}
              {v.notes.map((n) => <p key={n._id} className="mt-1 text-sm text-bone">{n.body} <span className="text-xs text-steel">{n.author}, {new Date(n.createdAt).toLocaleString()}</span></p>)}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => run(async () => openUrl((await convex.query(api.mediaLibrary.downloadUrl, { versionId: v._id })).url))}><Download /> Download</Button>
                <Button size="sm" variant="outline" onClick={() => run(() => restore({ versionId: v._id }))}><RotateCcw /> Restore as new version</Button>
                <Button size="sm" variant="outline" onClick={() => run(() => setApproval({ versionId: v._id, state: "approved" }))}>Approve</Button>
                <Button size="sm" variant="ghost" onClick={() => run(() => setApproval({ versionId: v._id, state: "changes_requested" }))}>Changes asked</Button>
                <Button size="sm" variant="ghost" onClick={() => setNoteFor(noteFor === v._id ? null : v._id)}>Add note</Button>
              </div>
              {noteFor === v._id && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await addNote({ versionId: v._id, body: noteBody }); setNoteBody(""); setNoteFor(null); }); }}>
                  <Input value={noteBody} onChange={(e) => setNoteBody(e.target.value)} aria-label="Note" />
                  <Button size="sm" type="submit" disabled={!noteBody.trim()}>Save</Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      <GuestLinks assetId={assetId} />
      <div className="mt-4 border-t border-graphite/40 pt-3">
        <h4 className="overline">History</h4>
        <ul className="mt-1 space-y-0.5 text-xs text-steel">
          {d.events.map((e) => <li key={e._id}>{new Date(e.createdAt).toLocaleString()}: {e.action.replace("_", " ")}{e.version ? ` v${e.version}` : ""} by {e.actor}{e.detail ? ` (${e.detail})` : ""}</li>)}
        </ul>
      </div>
    </Card>
  );
}

function Library({ shared }: { shared: boolean }) {
  const [q, setQ] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [studio, setStudio] = React.useState("");
  const [allStudios, setAllStudios] = React.useState(false);
  const [open, setOpen] = React.useState<Id<"mediaAssets"> | null>(null);
  const [showNew, setShowNew] = React.useState(false);
  const convex = useConvex();

  const args = { q: q.trim() || undefined, kind: (kind || undefined) as Kind | undefined, tag: tag.trim() || undefined };
  const own = useQuery(api.mediaLibrary.search, allStudios ? "skip" : args);
  const group = useQuery(api.mediaLibrary.sharedSearch, allStudios ? { ...args, studioOrgId: studio || undefined } : "skip");
  const studios = useQuery(api.mediaLibrary.sharedStudios, shared ? {} : "skip");
  const storage = useQuery(api.mediaLibrary.storage, {});
  const rows = allStudios ? group : own;
  const pct = storage ? Math.min(100, Math.round((storage.usedBytes / storage.capBytes) * 100)) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Music"
        title="Media library"
        description="Sessions, stems, mixes, masters, artwork and deliverables. Every upload is a numbered version."
        actions={!allStudios ? <Button onClick={() => setShowNew((s) => !s)}><Upload /> Upload</Button> : undefined}
      />
      {storage && (
        <div className="max-w-md">
          <div className="h-1.5 overflow-hidden rounded-full bg-coal-2"><div className="h-full bg-gold" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-steel">{formatBytes(storage.usedBytes)} of {storage.capGb} GB used</p>
        </div>
      )}
      {showNew && !allStudios && <NewFile onDone={() => setShowNew(false)} />}
      <div className="flex flex-wrap items-end gap-2">
        <Input className="w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, tag, song or session" aria-label="Search the library" />
        <Select2 className="w-40" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select2>
        <Input className="w-36" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag" aria-label="Tag" />
        {shared && (
          <>
            <Select2 className="w-44" value={allStudios ? "all" : "own"} onChange={(e) => { setAllStudios(e.target.value === "all"); setOpen(null); }} aria-label="Whose files">
              <option value="own">This studio</option>
              <option value="all">All my studios</option>
            </Select2>
            {allStudios && (
              <Select2 className="w-44" value={studio} onChange={(e) => setStudio(e.target.value)} aria-label="Studio">
                <option value="">Every studio</option>
                {(studios ?? []).map((s) => <option key={s.orgId} value={s.orgId}>{s.name}</option>)}
              </Select2>
            )}
          </>
        )}
      </div>
      {rows === undefined ? (
        <SkeletonCards cards={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Nothing here yet" description="Upload a file and it is saved as version 1." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r._id}>
              <button type="button" onClick={() => setOpen(open === r._id ? null : r._id)} className="w-full text-left">
                <Card interactive className="flex flex-wrap items-center gap-2 p-3">
                  <span className="text-sm font-semibold text-bone">{r.name}</span>
                  <Badge>{KIND_LABEL[r.kind]}</Badge>
                  {"studioName" in r && allStudios && <Badge tone="gold">{String(r.studioName)}</Badge>}
                  {r.songTitle && <span className="text-xs text-steel">{r.songTitle}</span>}
                  {r.sessionTitle && <span className="text-xs text-steel">{r.sessionTitle}</span>}
                  {r.tags.map((t) => <Badge key={t} tone="info">{t}</Badge>)}
                  <span className="ml-auto text-xs text-steel">v{r.currentVersion}, {formatBytes(r.totalBytes)}, {new Date(r.updatedAt).toLocaleDateString()}</span>
                </Card>
              </button>
              {open === r._id && (allStudios && "isThisStudio" in r && !r.isThisStudio
                ? <SharedDetail assetId={r._id} convex={convex} />
                : <div className="mt-2"><Detail assetId={r._id} onDeleted={() => setOpen(null)} /></div>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Read-only history of a sibling studio's file. */
function SharedDetail({ assetId, convex }: { assetId: Id<"mediaAssets">; convex: ReturnType<typeof useConvex> }) {
  const d = useQuery(api.mediaLibrary.sharedDetail, { assetId });
  if (!d) return <SkeletonCards cards={1} />;
  return (
    <Card className="mt-2 p-4">
      <ul className="space-y-2">
        {d.versions.map((v) => (
          <li key={v._id} className="flex flex-wrap items-center gap-2 text-sm text-bone">
            <span className="font-meta">v{v.version}</span> {v.fileName}
            <Badge tone={APPROVAL[v.approval].tone}>{APPROVAL[v.approval].label}</Badge>
            <span className="text-xs text-steel">{v.uploadedBy}, {new Date(v.uploadedAt).toLocaleString()}</span>
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => convex.query(api.mediaLibrary.sharedDownloadUrl, { versionId: v._id }).then((r) => openUrl(r.url)).catch((err) => toast.error(errorMessage(err)))}><Download /> Download</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function LibraryPage() {
  const access = useQuery(api.mediaLibrary.access, {});
  if (access === undefined) return <SkeletonCards cards={3} />;
  if (!access.library) {
    return <EmptyState icon={FolderOpen} title="The media library is not available here" description="Finished mixes, with version notes, are on the Finished mixes screen." />;
  }
  return <Library shared={access.shared} />;
}
