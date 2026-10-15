"use client";

import { useRef, useState } from "react";
import { useConvex, useMutation, useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AudioLines,
  ClipboardList,
  Download,
  FileText,
  History,
  Image as ImageIcon,
  Link2,
  Mail,
  MessageSquare,
  Music2,
  NotebookPen,
  Paperclip,
  Pause,
  Play,
  Plus,
  Receipt,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityLink, InvoiceLink } from "@/components/shell/entity-link";
import { putToR2 } from "@/lib/r2-upload";
import { money, relativeTime, shortDate } from "@/lib/format";
import { meta, INVOICE_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { NotificationRow } from "@/components/bookings/types";

/* The parts of the session modal beyond the booking's own fields: staff notes,
   files and songs, special requests, invoices, arrival prep, the message log
   and the change history. Shared by the calendar / global session modal and
   the Bookings modal, so both show everything. */

const SECTION = "space-y-2";
const EMPTY = "rounded-md border border-dashed border-graphite/60 px-3 py-4 text-center text-xs text-steel/70";
const ROW = "rounded-md border border-graphite/50 bg-coal-2";

function errorText(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "message" in data) return String((data as { message: unknown }).message);
  }
  if (err instanceof Error && err.message) return err.message.replace(/^\[.*?\]\s*/, "").replace(/^Uncaught \w+:\s*/, "");
  return fallback;
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function SectionTitle({ icon: Icon, children, aside }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="overline inline-flex items-center gap-1.5">
        <Icon className="size-3.5" />
        {children}
      </p>
      {aside}
    </div>
  );
}

/* ── Special requests ─────────────────────────────────────────── */

type RequestsSession = {
  notes?: string;
  gearRequestNote?: string;
  source?: string;
  addOns?: { equipmentId: string; name: string; priceCents?: number }[];
  serviceAddOns?: { feeId: string; label: string; amountCents?: number }[];
};

/** What the client asked for: the gear / special request, what they wrote on
 *  the booking form, and the add-ons they picked. */
export function SpecialRequestsPanel({ session }: { session: RequestsSession }) {
  const fromForm = session.source === "public_booking" ? session.notes?.trim() : undefined;
  const gear = session.gearRequestNote?.trim();
  const addOns = session.addOns ?? [];
  const services = session.serviceAddOns ?? [];
  const empty = !fromForm && !gear && addOns.length === 0 && services.length === 0;
  return (
    <section className={SECTION} aria-label="Special requests">
      <SectionTitle icon={Sparkles}>Special requests</SectionTitle>
      {empty ? (
        <p className={EMPTY}>No special requests on this booking.</p>
      ) : (
        <div className="space-y-2">
          {gear && (
            <div className={cn(ROW, "p-3")}>
              <p className="text-[0.6875rem] font-medium text-steel/70">Gear or special request</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-bone">{gear}</p>
            </div>
          )}
          {fromForm && (
            <div className={cn(ROW, "p-3")}>
              <p className="text-[0.6875rem] font-medium text-steel/70">From the booking form</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-bone">{fromForm}</p>
            </div>
          )}
          {(addOns.length > 0 || services.length > 0) && (
            <ul className={cn(ROW, "divide-y divide-hairline")}>
              {addOns.map((a) => (
                <li key={`g-${a.equipmentId}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-bone">{a.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone="neutral">Gear</Badge>
                    {a.priceCents !== undefined && <span className="font-meta text-xs text-steel">{money(a.priceCents)}</span>}
                  </span>
                </li>
              ))}
              {services.map((a) => (
                <li key={`s-${a.feeId}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-bone">{a.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone="neutral">Service</Badge>
                    {a.amountCents !== undefined && <span className="font-meta text-xs text-steel">{money(a.amountCents)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Session notes ────────────────────────────────────────────── */

/** Staff-only notes, newest first. Never sent to the client. */
export function SessionNotesPanel({ sessionId }: { sessionId: Id<"sessions"> }) {
  const notes = useQuery(api.sessionNotes.list, { sessionId });
  const add = useMutation(api.sessionNotes.add);
  const remove = useMutation(api.sessionNotes.remove);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      await add({ sessionId, body });
      setDraft("");
    } catch (err) {
      toast.error(errorText(err, "Could not save the note."));
    } finally {
      setSaving(false);
    }
  }

  if (notes === null) return null;
  return (
    <section className={SECTION} aria-label="Session notes">
      <SectionTitle icon={NotebookPen} aside={<span className="text-[0.625rem] text-steel/70">Staff only</span>}>
        Session notes
      </SectionTitle>
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Add a note for the team. The client never sees these."
          aria-label="New session note"
          rows={3}
          maxLength={4000}
        />
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" disabled={saving || !draft.trim()} onClick={() => void submit()}>
            <Plus className="size-3.5" />
            {saving ? "Saving..." : "Add note"}
          </Button>
        </div>
      </div>
      {notes === undefined ? (
        <Skeleton className="h-14 w-full" />
      ) : notes.length === 0 ? (
        <p className={EMPTY}>No notes yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="session-notes">
          {notes.map((n) => (
            <li key={n._id} className={cn(ROW, "p-3")}>
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.6875rem] text-steel/70">
                  <span className="font-medium text-steel">{n.authorName}</span> · {relativeTime(n.createdAt)}
                </p>
                {n.canDelete && (
                  <button
                    type="button"
                    aria-label="Delete note"
                    className="shrink-0 rounded-sm p-0.5 text-steel/70 transition-colors hover:text-critical focus-visible:ring-2 focus-visible:ring-gold/30"
                    onClick={() =>
                      void remove({ noteId: n._id }).catch((err) => toast.error(errorText(err, "Could not delete the note.")))
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-bone">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Files and songs ──────────────────────────────────────────── */

function fileIcon(mime: string) {
  if (mime.startsWith("audio/")) return AudioLines;
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return Play;
  return FileText;
}

/** Files on this booking (bytes in R2, private bucket) and the songs worked on. */
export function SessionFilesPanel({ sessionId, artistId }: { sessionId: Id<"sessions">; artistId: Id<"artists"> }) {
  const data = useQuery(api.sessionFiles.list, { sessionId });
  const convex = useConvex();
  const prepare = useMutation(api.sessionFiles.prepareUpload);
  const confirm = useAction(api.media.confirmUpload);
  const attach = useMutation(api.sessionFiles.attach);
  const removeFile = useMutation(api.sessionFiles.remove);
  const createSong = useMutation(api.songs.create);
  const linkSong = useMutation(api.sessionFiles.linkSong);
  const unlinkSong = useMutation(api.sessionFiles.unlinkSong);

  const fileInput = useRef<HTMLInputElement>(null);
  const songInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [playing, setPlaying] = useState<{ versionId: string; url: string } | null>(null);

  async function upload(file: File, opts?: { asSong?: boolean }) {
    setUploading(file.name);
    try {
      let songId: Id<"songs"> | undefined;
      if (opts?.asSong) {
        const title = file.name.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || "Untitled";
        songId = (await createSong({ title, artistId, kind: "single" })) as Id<"songs">;
      }
      const mimeType = file.type || "application/octet-stream";
      const prep = await prepare({ sessionId, fileName: file.name || "upload", mimeType, size: file.size });
      await putToR2(file, prep);
      await confirm({ mediaId: prep.mediaId as Id<"mediaFiles"> });
      await attach({ sessionId, mediaId: prep.mediaId as Id<"mediaFiles">, songId });
      toast.success(opts?.asSong ? `Added "${file.name}" as a new song` : `Uploaded ${file.name}`);
    } catch (err) {
      const msg = errorText(err, "Upload failed.");
      toast.error(/R2 is not configured/i.test(msg) ? "File storage is not set up on this deployment yet." : msg);
    } finally {
      setUploading(null);
    }
  }

  async function urlFor(versionId: Id<"mediaVersions">) {
    return await convex.query(api.sessionFiles.downloadUrl, { versionId });
  }

  async function download(versionId: Id<"mediaVersions">) {
    try {
      const { url } = await urlFor(versionId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(errorText(err, "Could not open the file."));
    }
  }

  async function play(versionId: Id<"mediaVersions">) {
    if (playing?.versionId === versionId) {
      setPlaying(null);
      return;
    }
    try {
      const { url } = await urlFor(versionId);
      setPlaying({ versionId, url });
    } catch (err) {
      toast.error(errorText(err, "Could not play the file."));
    }
  }

  if (data === null) return null;
  return (
    <section className="space-y-4" aria-label="Files and songs">
      {/* Songs */}
      <div className={SECTION}>
        <SectionTitle
          icon={Music2}
          aside={
            data?.canEditSongs ? (
              <button
                type="button"
                onClick={() => setPicking((p) => !p)}
                className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-steel transition-colors hover:text-gold"
              >
                <Link2 className="size-3" />
                Link a song
              </button>
            ) : null
          }
        >
          Songs
        </SectionTitle>
        {picking && <SongPicker sessionId={sessionId} onPick={async (songId) => {
          try {
            await linkSong({ sessionId, songId });
            setPicking(false);
            toast.success("Song linked");
          } catch (err) {
            toast.error(errorText(err, "Could not link the song."));
          }
        }} />}
        {data === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : data.songs.length === 0 ? (
          <p className={EMPTY}>No songs linked to this session.</p>
        ) : (
          <ul className={cn(ROW, "divide-y divide-hairline")} data-testid="session-songs">
            {data.songs.map((s) => (
              <li key={s.songId} className="flex items-center justify-between gap-3 px-3 py-2">
                <EntityLink type="song" id={s.songId} className="flex min-w-0 items-center gap-2 text-sm text-bone hover:text-gold">
                  <Music2 className="size-3.5 shrink-0 text-gold" />
                  <span className="truncate">{s.title}</span>
                  {s.artistName && <span className="hidden truncate text-xs text-steel/70 sm:inline">{s.artistName}</span>}
                </EntityLink>
                <span className="flex shrink-0 items-center gap-2">
                  {s.primary && <Badge tone="gold">Main</Badge>}
                  {!s.primary && s.linkId && data.canEditSongs && (
                    <button
                      type="button"
                      aria-label={`Unlink ${s.title}`}
                      className="rounded-sm p-0.5 text-steel/70 hover:text-critical"
                      onClick={() =>
                        void unlinkSong({ linkId: s.linkId! }).catch((err) => toast.error(errorText(err, "Could not unlink.")))
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Files */}
      <div className={SECTION}>
        <SectionTitle icon={Paperclip}>Files</SectionTitle>
        {data?.canUpload && (
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              aria-label="Upload a file to this session"
              data-testid="session-file-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
            <input
              ref={songInput}
              type="file"
              accept="audio/*"
              className="sr-only"
              aria-label="Upload audio as a new song"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f, { asSong: true });
              }}
            />
            <Button size="sm" variant="secondary" disabled={uploading !== null} onClick={() => fileInput.current?.click()}>
              <Upload className="size-3.5" />
              Upload file
            </Button>
            {data.canCreateSong && (
              <Button size="sm" variant="outline" disabled={uploading !== null} onClick={() => songInput.current?.click()}>
                <Music2 className="size-3.5" />
                Upload as new song
              </Button>
            )}
          </div>
        )}
        {uploading && (
          <p className="text-xs text-steel" role="status">
            Uploading {uploading}...
          </p>
        )}
        {data === undefined ? (
          <Skeleton className="h-12 w-full" />
        ) : data.files.length === 0 ? (
          <p className={EMPTY}>No files yet. Stems, references, PDFs, images and audio all go here.</p>
        ) : (
          <ul className="space-y-2" data-testid="session-files">
            {data.files.map((f) => {
              const Icon = fileIcon(f.mimeType);
              const audio = f.mimeType.startsWith("audio/");
              const isPlaying = playing?.versionId === f.versionId;
              return (
                <li key={f.assetId} className={cn(ROW, "p-2.5")}>
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-coal-3 text-gold-dim">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-bone" title={f.fileName}>{f.name}</p>
                      <p className="truncate text-[0.6875rem] text-steel/70">
                        {bytes(f.size)} · {f.uploadedBy} · {shortDate(f.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {audio && (
                        <Button size="icon-sm" variant="ghost" aria-label={isPlaying ? `Stop ${f.name}` : `Play ${f.name}`} onClick={() => void play(f.versionId)}>
                          {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" aria-label={`Download ${f.name}`} onClick={() => void download(f.versionId)}>
                        <Download className="size-3.5" />
                      </Button>
                      {f.canDelete && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${f.name}`}
                          onClick={() =>
                            void removeFile({ assetId: f.assetId })
                              .then(() => toast.success(`Deleted ${f.name}`))
                              .catch((err) => toast.error(errorText(err, "Could not delete the file.")))
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {isPlaying && (
                    <audio className="mt-2 w-full" src={playing.url} controls autoPlay preload="none" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function SongPicker({ sessionId, onPick }: { sessionId: Id<"sessions">; onPick: (songId: Id<"songs">) => void }) {
  const choices = useQuery(api.sessionFiles.songChoices, { sessionId });
  if (!choices) return <Skeleton className="h-9 w-full" />;
  if (choices.length === 0) return <p className={EMPTY}>No songs in the library yet.</p>;
  return (
    <Select onValueChange={(v) => onPick(v as Id<"songs">)}>
      <SelectTrigger aria-label="Pick a song to link">
        <SelectValue placeholder="Pick a song" />
      </SelectTrigger>
      <SelectContent>
        {choices.map((s) => (
          <SelectItem key={s._id} value={s._id}>
            {s.title}
            {s.own ? " (this client)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ── Invoices, prep, history ──────────────────────────────────── */

const PREP_LABEL: Record<string, string> = {
  details: "Brief opened",
  parking: "Parking sign",
  room: "Room ready",
  welcome: "Welcome set",
  files: "Files delivered",
  billing: "Billing settled",
  gear: "Gear back",
  notes: "Notes logged",
  reset: "Room reset",
  refresh: "Refreshed",
  zero: "Console zeroed",
  stage: "Staged for next",
};

/** Invoices raised for this booking, each one opens the invoice modal. */
export function SessionInvoicesPanel({ sessionId }: { sessionId: Id<"sessions"> }) {
  const extras = useQuery(api.sessionDetail.extras, { sessionId });
  if (!extras || !extras.seesMoney) return null;
  return (
    <section className={SECTION} aria-label="Invoices">
      <SectionTitle icon={Receipt}>Invoices</SectionTitle>
      {extras.invoices.length === 0 ? (
        <p className={EMPTY}>No invoice raised for this session.</p>
      ) : (
        <ul className="space-y-1.5" data-testid="session-invoices">
          {extras.invoices.map((inv) => {
            const st = meta(INVOICE_STATUS, inv.status);
            return (
              <li key={inv._id}>
                <InvoiceLink
                  invoiceId={inv._id}
                  className={cn(ROW, "flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:border-graphite/60 hover:bg-coal-3")}
                >
                  <span className="min-w-0">
                    <span className="block font-meta text-sm font-medium text-bone">{inv.number}</span>
                    <span className="block text-[0.6875rem] text-steel/70">Due {shortDate(inv.dueDate)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-meta text-sm tabular-nums text-bone">{money(inv.amountCents)}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </span>
                </InvoiceLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Arrival prep progress, who created and decided the booking, and its history. */
export function SessionHistoryPanel({ sessionId }: { sessionId: Id<"sessions"> }) {
  const extras = useQuery(api.sessionDetail.extras, { sessionId });
  if (extras === null) return null;
  return (
    <>
      <section className={SECTION} aria-label="Arrival prep">
        <SectionTitle icon={ClipboardList}>Arrival prep</SectionTitle>
        {extras === undefined ? (
          <Skeleton className="h-8 w-full" />
        ) : !extras.prep || extras.prep.done.length === 0 ? (
          <p className={EMPTY}>Nothing checked off yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {extras.prep.done.map((step) => {
              const who = extras.prep!.attribution.find((a) => a.step === step);
              return (
                <li key={step}>
                  <Badge tone="positive" title={who ? `${who.by}, ${relativeTime(who.at)}` : undefined}>
                    {PREP_LABEL[step] ?? (step.startsWith("item:") ? "Rented gear ready" : step)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={SECTION} aria-label="Change history">
        <SectionTitle icon={History}>Change history</SectionTitle>
        {extras === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            {(extras.createdBy || extras.requestDecidedBy || extras.source) && (
              <p className="text-xs text-steel">
                {extras.source === "public_booking" ? "Booked through the public link" : extras.createdBy ? `Booked by ${extras.createdBy}` : "Booked in Pulse"}
                {extras.requestDecidedBy ? ` · request decided by ${extras.requestDecidedBy}` : ""}
              </p>
            )}
            {extras.changes.length > 0 && (
              <ul className="space-y-1.5">
                {extras.changes.map((c) => (
                  <li key={c._id} className={cn(ROW, "px-3 py-2 text-xs text-steel")}>
                    <span className="font-medium text-bone">
                      {c.origin === "google" ? "Moved in Google" : `Change asked${c.requestedBy ? ` by ${c.requestedBy}` : ""}`}
                    </span>
                    {" · "}
                    {c.status}
                    {c.decidedBy ? ` by ${c.decidedBy}` : ""} · {relativeTime(c.at)}
                    {c.reason && <span className="block text-steel/70">{c.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
            {extras.history.length === 0 && extras.changes.length === 0 ? (
              <p className={EMPTY}>No changes recorded.</p>
            ) : (
              <ol className="relative space-y-2 border-l border-graphite/60 pl-3">
                {extras.history.map((h) => (
                  <li key={h._id} className="text-xs">
                    <p className="text-bone">{h.summary}</p>
                    <p className="text-[0.625rem] text-steel/70">
                      {h.actorName ? `${h.actorName} · ` : ""}
                      {relativeTime(h.at)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>
    </>
  );
}

/* ── Message log ──────────────────────────────────────────────── */

/** Confirmations and reminders sent about this booking. Read-only. */
export function MessageLog({ sessionId }: { sessionId: Id<"sessions"> }) {
  const messages = useQuery(api.notifications.forSession, { sessionId }) as NotificationRow[] | undefined;

  return (
    <section className={SECTION} aria-label="Message log">
      <SectionTitle icon={Mail}>Message log</SectionTitle>
      {messages === undefined ? (
        <div className="space-y-1.5">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <p className={EMPTY}>No confirmations or reminders sent for this booking yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {messages.map((msg) => (
            <li key={msg._id} className={cn(ROW, "p-2.5")}>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-bone">
                  {msg.channel === "email" ? (
                    <Mail className="size-3.5 shrink-0 text-steel/70" />
                  ) : (
                    <MessageSquare className="size-3.5 shrink-0 text-steel/70" />
                  )}
                  <span className="truncate">{msg.subject}</span>
                </span>
                <span className="shrink-0 text-[0.625rem] text-steel/70">{relativeTime(msg._creationTime)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-steel">{msg.body}</p>
              <p className="mt-1 truncate font-meta text-[0.5625rem] uppercase tracking-wide text-steel/70">
                {msg.channel} · {msg.recipient}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.625rem] text-steel/70">Confirmations and reminders are emailed to the client and logged here.</p>
    </section>
  );
}
