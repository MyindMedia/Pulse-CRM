"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  Headphones,
  Lock,
  MessageSquare,
  Music2,
  PackagePlus,
  Plus,
  RotateCcw,
  Upload,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/toggle";
import { Checkbox } from "@/components/ui/toggle";
import { Field, Input, Textarea } from "@/components/ui/field";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { titleCase } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { DeliverableReviewDialog } from "./deliverable-review-dialog";

const DELIVERABLE_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "positive" | "gold" }> = {
  delivered: { label: "Delivered", tone: "info" },
  in_review: { label: "In review", tone: "neutral" },
  approved: { label: "Approved", tone: "positive" },
  final: { label: "Final", tone: "gold" },
};

const KIND_LABEL: Record<string, string> = {
  mix: "Mix",
  master: "Master",
  stems: "Stems",
  instrumental: "Instrumental",
  reference: "Reference",
  backup: "Backup",
};

type DeliverableStatus = "delivered" | "in_review" | "approved" | "final";
type DeliverableKind = "mix" | "master" | "stems" | "instrumental" | "reference" | "backup";

const KIND_OPTIONS: { value: DeliverableKind; label: string }[] = [
  { value: "mix", label: "Mix" },
  { value: "master", label: "Master" },
  { value: "stems", label: "Stems" },
  { value: "instrumental", label: "Instrumental" },
  { value: "reference", label: "Reference" },
  { value: "backup", label: "Backup" },
];

/** Next status in the delivered → in_review → approved → final chain. */
const NEXT_STATUS: Record<DeliverableStatus, DeliverableStatus | null> = {
  delivered: "in_review",
  in_review: "approved",
  approved: "final",
  final: null,
};

function fmtDuration(sec?: number) {
  if (sec == null) return "-";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function DeliverablesTab({ songId }: { songId: Id<"songs"> }) {
  const deliverables = useQuery(api.deliverables.forSong, { songId });
  const consumeRevision = useMutation(api.deliverables.consumeRevision);

  const [addOpen, setAddOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [consuming, setConsuming] = useState(false);

  async function useRevision() {
    setConsuming(true);
    try {
      const used = await consumeRevision({ songId });
      toast.success(`Revision logged - ${used} used.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log the revision.");
    } finally {
      setConsuming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="overline">Deliverables</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={useRevision} disabled={consuming}>
            <RotateCcw className="size-3.5" />
            {consuming ? "Logging…" : "Use a revision"}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" />
            Add deliverable
          </Button>
        </div>
      </div>

      {deliverables === undefined ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : deliverables.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="No deliverables yet"
          description="Upload a mix, master or stem set. Each one is versioned and carries its own revision comments."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add deliverable
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {deliverables.map((d) => (
            <DeliverableRow
              key={d._id}
              deliverable={d}
              expanded={expandedId === d._id}
              onToggle={() => setExpandedId(expandedId === d._id ? null : d._id)}
            />
          ))}
        </div>
      )}

      <AddDeliverableDialog songId={songId} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

/* ── A single versioned deliverable row + expandable comment thread ── */
type DeliverableRowData = {
  _id: Id<"deliverables">;
  kind: string;
  version: number;
  label: string;
  status: string;
  durationSec?: number;
  paymentGated: boolean;
  fileId?: Id<"_storage">;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  commentCount: number;
  openCommentCount: number;
};

function fmtBytes(bytes?: number) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DeliverableRow({
  deliverable: d,
  expanded,
  onToggle,
}: {
  deliverable: DeliverableRowData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const setStatus = useMutation(api.deliverables.setStatus);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const attachFile = useMutation(api.files.attachFile);
  const convex = useConvex();
  const [advancing, setAdvancing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const status = DELIVERABLE_STATUS[d.status] ?? { label: d.status, tone: "neutral" as const };
  const next = NEXT_STATUS[d.status as DeliverableStatus];

  async function advance() {
    if (!next) return;
    setAdvancing(true);
    try {
      await setStatus({ id: d._id, status: next });
      toast.success(`${d.label} v${d.version} → ${DELIVERABLE_STATUS[next].label.toLowerCase()}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setAdvancing(false);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await attachFile({
        deliverableId: d._id,
        storageId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      });
      toast.success(`${file.name} attached.`);
    } catch (err) {
      toast.error(errorMessage(err, "Could not upload the file."));
    } finally {
      setUploading(false);
    }
  }

  async function download() {
    setDownloading(true);
    setLocked(null);
    try {
      const { url } = await convex.query(api.files.downloadUrl, { deliverableId: d._id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not get the download.";
      setLocked(msg);
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-coal-2 text-ash-dim">
          <Music2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-bone">{d.label}</p>
            <span className="shrink-0 rounded-sm border border-hairline bg-coal-2 px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide text-ash">
              v{d.version}
            </span>
            {d.paymentGated && (
              <span
                className="inline-flex shrink-0 items-center gap-1 text-[0.625rem] font-medium text-caution"
                title="Payment-gated"
              >
                <Lock className="size-3" />
                Gated
              </span>
            )}
          </div>
          <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
            {KIND_LABEL[d.kind] ?? titleCase(d.kind)} · {fmtDuration(d.durationSec)}
          </p>
        </div>

        <Badge tone={status.tone}>{status.label}</Badge>

        {next && (
          <Button variant="outline" size="sm" onClick={advance} disabled={advancing}>
            {advancing ? "…" : `Mark ${DELIVERABLE_STATUS[next].label.toLowerCase()}`}
          </Button>
        )}

        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-coal-2 px-2.5 py-1.5 text-xs font-medium text-ash transition-colors hover:text-bone"
        >
          <MessageSquare className="size-3.5" />
          {d.commentCount}
          {d.openCommentCount > 0 && (
            <span className="font-mono text-[0.625rem] text-caution">
              · {d.openCommentCount} open
            </span>
          )}
          <ChevronDown
            className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
          />
        </button>
      </div>

      {/* File row - upload (staff) + gated download */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline bg-ink-2 px-3 py-2">
        <div className="min-w-0">
          {d.fileId ? (
            <p className="truncate font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              {d.fileName ?? "Attached file"}
              {d.fileSize != null && ` · ${fmtBytes(d.fileSize)}`}
            </p>
          ) : (
            <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
              No file attached
            </p>
          )}
          {locked && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[0.625rem] font-medium text-caution">
              <Lock className="size-3" />
              {locked}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onFilePicked}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="size-3.5" />
            {uploading ? "Uploading…" : d.fileId ? "Replace" : "Upload"}
          </Button>
          {d.fileId && (
            <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
              <Headphones className="size-3.5" />
              Review
            </Button>
          )}
          {d.fileId && (
            <Button size="sm" onClick={download} disabled={downloading}>
              {locked ? <Lock className="size-3.5" /> : <Download className="size-3.5" />}
              {downloading ? "…" : locked ? "Locked" : "Download"}
            </Button>
          )}
        </div>
      </div>

      {expanded && <CommentThread deliverableId={d._id} />}

      <DeliverableReviewDialog
        deliverableId={d._id}
        label={`${d.label} v${d.version}`}
        authorName="Studio"
        open={reviewOpen}
        onOpenChange={setReviewOpen}
      />
    </Card>
  );
}

/* ── Timestamped revision-comment thread ── */
function CommentThread({ deliverableId }: { deliverableId: Id<"deliverables"> }) {
  const comments = useQuery(api.deliverables.comments, { deliverableId });
  const addComment = useMutation(api.deliverables.addComment);
  const resolveComment = useMutation(api.deliverables.resolveComment);

  const [author, setAuthor] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [seconds, setSeconds] = useState("0");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!body.trim()) {
      toast.error("Write a note before adding the comment.");
      return;
    }
    const ts = Number(minutes) * 60 + Number(seconds);
    setSaving(true);
    try {
      await addComment({
        deliverableId,
        timestampSec: Number.isFinite(ts) ? ts : 0,
        body: body.trim(),
        authorName: author.trim() || "Studio",
      });
      toast.success("Comment added.");
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the comment.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleResolved(id: Id<"revisionComments">, resolved: boolean) {
    try {
      await resolveComment({ id, resolved });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the comment.");
    }
  }

  return (
    <div className="space-y-3 border-t border-hairline bg-ink-2 p-3">
      {comments === undefined ? (
        <Skeleton className="h-20 w-full" />
      ) : comments.length === 0 ? (
        <p className="text-xs text-ash-dim">No revision notes on this version yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {comments.map((c) => (
            <li
              key={c._id}
              className={cn(
                "flex items-start gap-3 rounded-md border border-hairline px-3 py-2",
                c.resolved ? "bg-coal/50 opacity-70" : "bg-coal-2",
              )}
            >
              <span className="mt-0.5 shrink-0 rounded-sm bg-gold/10 px-1.5 py-0.5 font-mono text-[0.625rem] font-medium text-gold-bright">
                {fmtDuration(c.timestampSec)}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm leading-snug",
                    c.resolved ? "text-ash-dim line-through" : "text-bone",
                  )}
                >
                  {c.body}
                </p>
                <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                  {c.authorName}
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-[0.625rem] font-mono uppercase tracking-wide text-ash-dim">
                <Checkbox
                  checked={c.resolved}
                  onCheckedChange={(v) => toggleResolved(c._id, v === true)}
                />
                Resolved
              </label>
            </li>
          ))}
        </ul>
      )}

      {/* Add comment form */}
      <div className="space-y-2.5 rounded-md border border-hairline-2 bg-coal p-3">
        <p className="overline">Add a revision note</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Min" htmlFor="cm-min" className="w-16">
            <Input
              id="cm-min"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="h-9"
            />
          </Field>
          <Field label="Sec" htmlFor="cm-sec" className="w-16">
            <Input
              id="cm-sec"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="h-9"
            />
          </Field>
          <Field label="Author" htmlFor="cm-author" className="min-w-40 flex-1">
            <Input
              id="cm-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Studio"
              className="h-9"
            />
          </Field>
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Note the timestamp issue - vocal too dry at 1:24, snare needs more body…"
          className="min-h-16"
        />
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? "Adding…" : "Add comment"}
        </Button>
      </div>
    </div>
  );
}

/* ── Add-deliverable dialog ── */
function AddDeliverableDialog({
  songId,
  open,
  onOpenChange,
}: {
  songId: Id<"songs">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.deliverables.create);
  const [kind, setKind] = useState<DeliverableKind>("mix");
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const [gated, setGated] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!label.trim()) {
      toast.error("Give the deliverable a label.");
      return;
    }
    const dur =
      minutes.trim() || seconds.trim()
        ? Number(minutes || 0) * 60 + Number(seconds || 0)
        : undefined;
    setSaving(true);
    try {
      await create({
        songId,
        kind,
        label: label.trim(),
        durationSec: dur != null && Number.isFinite(dur) ? dur : undefined,
        paymentGated: gated,
      });
      toast.success("Deliverable added.");
      setKind("mix");
      setLabel("");
      setMinutes("");
      setSeconds("");
      setGated(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the deliverable.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add deliverable</DialogTitle>
          <DialogDescription>
            The version number is assigned automatically - newest first.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind" htmlFor="dl-kind">
              <Select value={kind} onValueChange={(v) => setKind(v as DeliverableKind)}>
                <SelectTrigger id="dl-kind">
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
            <Field label="Label" htmlFor="dl-label">
              <Input
                id="dl-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Rough mix, Final master…"
                autoFocus
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Duration" htmlFor="dl-min" hint="Optional - minutes and seconds.">
              <div className="flex items-center gap-2">
                <Input
                  id="dl-min"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="3"
                  inputMode="numeric"
                />
                <span className="text-ash-dim">:</span>
                <Input
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="42"
                  inputMode="numeric"
                />
              </div>
            </Field>
            <Field label="Payment-gated" htmlFor="dl-gated" hint="Locked until the invoice clears.">
              <div className="flex h-10 items-center">
                <Switch id="dl-gated" checked={gated} onCheckedChange={setGated} />
              </div>
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Adding…" : "Add deliverable"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
