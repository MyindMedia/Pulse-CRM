"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileDown, FileSignature, Plus, Scale, Send, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RightsExportDialog } from "@/components/songs/rights-export-dialog";
import { SigningLinksDialog, type SigningLink } from "@/components/songs/signing-links-dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCapabilities } from "@/lib/use-capabilities";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";

/** Mirrors validEmail in convex/lib/emailKey.ts: the signing link goes here. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Contributor = {
  name: string;
  role: string;
  masterPct: number;
  publishingPct: number;
  pro?: string;
  ipi?: string;
  email?: string;
  /** Row in the saved sheet this came from, so the server keeps its signature. */
  fromIndex?: number;
  /** Read-only, from the server: who signed and when. Never edited here. */
  signedBy: "person" | "studio" | null;
  signedAt: number | null;
};

type SplitStatus = "draft" | "sent" | "fully_executed" | "marked_by_studio";

const SPLIT_STATUS: Record<SplitStatus, { label: string; tone: "neutral" | "info" | "positive" | "gold" }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  fully_executed: { label: "Signed by everyone", tone: "positive" },
  marked_by_studio: { label: "Marked signed by studio", tone: "gold" },
};

const signedOn = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function emptyContributor(): Contributor {
  return {
    name: "",
    role: "Songwriter",
    masterPct: 0,
    publishingPct: 0,
    pro: "",
    ipi: "",
    email: "",
    signedBy: null,
    signedAt: null,
  };
}

export function SplitsTab({ songId }: { songId: Id<"songs"> }) {
  const split = useQuery(api.splitSheets.forSong, { songId });
  const upsert = useMutation(api.splitSheets.upsert);
  const issueSigning = useMutation(api.splitSignatures.issue);
  const markOutside = useMutation(api.splitSheets.markSignedOutsidePulse);
  const { role } = useCapabilities();
  const [markOpen, setMarkOpen] = useState(false);
  const [markNote, setMarkNote] = useState("");

  const [rows, setRows] = useState<Contributor[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [issuedLinks, setIssuedLinks] = useState<SigningLink[] | null>(null);
  const [linksOpen, setLinksOpen] = useState(false);

  if (split === undefined) {
    return <Skeleton className="h-72 w-full" />;
  }

  // Working copy: local edits if present, otherwise the server state.
  const working: Contributor[] =
    rows ??
    (split
      ? split.contributors.map((c, i) => ({
          name: c.name,
          role: c.role,
          masterPct: c.masterPct,
          publishingPct: c.publishingPct,
          pro: c.pro ?? "",
          ipi: c.ipi ?? "",
          email: c.email ?? "",
          fromIndex: i,
          signedBy: c.signedBy,
          signedAt: c.signedAt,
        }))
      : [emptyContributor()]);

  const masterTotal = working.reduce((s, c) => s + (c.masterPct || 0), 0);
  const pubTotal = working.reduce((s, c) => s + (c.publishingPct || 0), 0);
  const balanced = masterTotal === 100 && pubTotal === 100;
  const dirty = rows !== null;

  function patch(index: number, next: Partial<Contributor>) {
    setRows(working.map((c, i) => (i === index ? { ...c, ...next } : c)));
  }
  function addRow() {
    setRows([...working, emptyContributor()]);
  }
  function removeRow(index: number) {
    setRows(working.filter((_, i) => i !== index));
  }
  /** Standard even split: distribute 100% across every contributor on both
      columns, pushing any rounding remainder onto the first so totals hit
      exactly 100. */
  function splitEvenly() {
    const n = working.length;
    if (n === 0) return;
    const base = Math.floor((100 / n) * 100) / 100; // 2dp floor
    const remainder = Math.round((100 - base * n) * 100) / 100;
    setRows(
      working.map((c, i) => {
        const pct = i === 0 ? Math.round((base + remainder) * 100) / 100 : base;
        return { ...c, masterPct: pct, publishingPct: pct };
      }),
    );
  }

  async function save() {
    if (!balanced) {
      toast.error(
        `Splits must total 100% - master ${masterTotal}%, publishing ${pubTotal}%.`,
      );
      return;
    }
    if (working.some((c) => !c.name.trim())) {
      toast.error("Every contributor needs a name.");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        songId,
        contributors: working.map((c) => ({
          name: c.name.trim(),
          role: c.role.trim() || "Contributor",
          masterPct: c.masterPct || 0,
          publishingPct: c.publishingPct || 0,
          pro: c.pro?.trim() || undefined,
          ipi: c.ipi?.trim() || undefined,
          email: c.email?.trim() || undefined,
          fromIndex: c.fromIndex,
        })),
      });
      toast.success("Split sheet saved.");
      setRows(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the split sheet.");
    } finally {
      setSaving(false);
    }
  }

  async function sendForSignature() {
    if (!split) return;
    setStatusUpdating(true);
    try {
      const links = await issueSigning({ splitSheetId: split._id });
      setIssuedLinks(links);
      setLinksOpen(true);
      if (links.length > 0) {
        toast.success(`Signing links issued to ${links.length} contributor${links.length === 1 ? "" : "s"}.`);
      } else {
        toast.message("Everyone with an email has already signed.");
      }
    } catch (err) {
      toast.error(errorMessage(err, "Could not issue signing links."));
    } finally {
      setStatusUpdating(false);
    }
  }

  async function markSignedOutside() {
    if (!split) return;
    setStatusUpdating(true);
    try {
      await markOutside({ id: split._id, note: markNote });
      toast.success("Marked signed outside Pulse. Royalties can now be split from this sheet.");
      setMarkOpen(false);
      setMarkNote("");
    } catch (err) {
      toast.error(errorMessage(err, "Could not mark the sheet."));
    } finally {
      setStatusUpdating(false);
    }
  }

  const currentStatus = (split?.displayStatus ?? "draft") as SplitStatus;
  const anySignature = working.some((c) => c.signedBy !== null);
  const isOwner = role === "owner";
  const canMarkOutside = currentStatus !== "fully_executed" && currentStatus !== "marked_by_studio";
  // Executed before signatures were enforced (a hand tick, or a signature an
  // old re-save wiped): shown as marked by studio, but not yet relabelled.
  // The owner can record where the signatures are.
  const legacyExecuted = split?.status === "fully_executed" && currentStatus === "marked_by_studio";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-steel/70" />
            Split sheet
          </CardTitle>
          {split ? (
            <Badge tone={SPLIT_STATUS[currentStatus].tone}>
              {SPLIT_STATUS[currentStatus].label}
            </Badge>
          ) : (
            <Badge tone="neutral">Not started</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Totals banner */}
          <div
            className={cn(
              "flex flex-wrap items-center gap-4 rounded-md border px-4 py-3",
              balanced
                ? "border-positive/30 bg-positive/[0.06]"
                : "border-critical/30 bg-critical/[0.06]",
            )}
          >
            {balanced ? (
              <CheckCircle2 className="size-5 shrink-0 text-positive" />
            ) : (
              <AlertTriangle className="size-5 shrink-0 text-critical" />
            )}
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <TotalReadout label="Master" value={masterTotal} />
              <TotalReadout label="Publishing" value={pubTotal} />
            </div>
            <p
              className={cn(
                "ml-auto text-xs font-medium",
                balanced ? "text-positive" : "text-critical",
              )}
            >
              {balanced
                ? "Splits balanced - ready to execute."
                : "Splits must total exactly 100% on both columns."}
            </p>
          </div>

          {/* Contributor rows */}
          <div className="space-y-2">
            {working.map((c, i) => (
              <div
                key={i}
                className="space-y-2 rounded-md border border-graphite/50 bg-coal-2 p-3"
              >
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <LabelledInput
                    label="Name"
                    value={c.name}
                    onChange={(v) => patch(i, { name: v })}
                    placeholder="Full legal name"
                  />
                  <LabelledInput
                    label="Role"
                    value={c.role}
                    onChange={(v) => patch(i, { role: v })}
                    placeholder="Songwriter, Producer…"
                  />
                  <LabelledInput
                    label="Master %"
                    value={c.masterPct ? String(c.masterPct) : ""}
                    onChange={(v) =>
                      patch(i, { masterPct: Number(v.replace(/[^0-9.]/g, "")) || 0 })
                    }
                    placeholder="0"
                    inputMode="decimal"
                  />
                  <LabelledInput
                    label="Publishing %"
                    value={c.publishingPct ? String(c.publishingPct) : ""}
                    onChange={(v) =>
                      patch(i, { publishingPct: Number(v.replace(/[^0-9.]/g, "")) || 0 })
                    }
                    placeholder="0"
                    inputMode="decimal"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <LabelledInput
                    label="PRO"
                    value={c.pro ?? ""}
                    onChange={(v) => patch(i, { pro: v })}
                    placeholder="ASCAP, BMI…"
                  />
                  <LabelledInput
                    label="IPI"
                    value={c.ipi ?? ""}
                    onChange={(v) => patch(i, { ipi: v })}
                    placeholder="00000000000"
                  />
                  <LabelledInput
                    label="Email (required to sign)"
                    value={c.email ?? ""}
                    onChange={(v) => patch(i, { email: v })}
                    placeholder="name@email.com"
                    type="email"
                    required={c.signedBy === null}
                    invalid={c.signedBy === null && !EMAIL_RE.test((c.email ?? "").trim())}
                  />
                  <div className="flex items-center justify-between gap-2 pt-5">
                    {/* Read-only: only the person's own signing link signs. */}
                    {c.signedBy === "person" && c.signedAt ? (
                      <Badge tone="positive">Signed on {signedOn(c.signedAt)}</Badge>
                    ) : c.signedBy === "studio" ? (
                      <Badge tone="gold">Marked signed by studio</Badge>
                    ) : (
                      <span className="text-xs text-steel/70">Not signed yet</span>
                    )}
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeRow(i)}
                      label="Remove contributor"
                    >
                      <Trash2 className="size-4 text-critical" />
                    </IconButton>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {anySignature && (
            <p className="text-xs text-steel/80">
              Changing a name, role or share, or adding or removing someone, clears the signatures
              and everyone signs again. Changing someone&rsquo;s email clears their signature and they sign
              again from the new address. Once anyone has signed, only the studio owner can change an
              email or a share. Fixing a PRO or IPI keeps every signature.
            </p>
          )}
          {split?.marked && (
            <p className="text-xs text-steel/80">
              Marked signed outside Pulse{split.marked.by ? ` by ${split.marked.by}` : ""}
              {split.marked.at ? ` on ${signedOn(split.marked.at)}` : ""}: {split.marked.note}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="size-3.5" />
              Add contributor
            </Button>
            {working.length > 1 && (
              <Button variant="ghost" size="sm" onClick={splitEvenly}>
                <Scale className="size-3.5" />
                Split evenly
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save split sheet" : "No changes"}
        </Button>
        {split && currentStatus !== "fully_executed" && (
          <Button
            variant="outline"
            onClick={sendForSignature}
            disabled={statusUpdating || dirty}
          >
            <Send className="size-4" />
            {currentStatus === "draft" ? "Send for signature" : "Re-send signing links"}
          </Button>
        )}
        {split && isOwner && (canMarkOutside || legacyExecuted) && (
          <Button
            variant="outline"
            onClick={() => setMarkOpen(true)}
            disabled={statusUpdating || dirty}
          >
            <FileSignature className="size-4" />
            Mark signed outside Pulse
          </Button>
        )}
        {split && !split.allSigned && (currentStatus === "draft" || currentStatus === "sent") && (
          <span className="text-xs text-steel/70">
            Not all contributors have signed yet.
          </span>
        )}
        {split && (
          <Button variant="outline" className="ml-auto" onClick={() => setExportOpen(true)} disabled={dirty}>
            <FileDown className="size-4" />
            Rights export
          </Button>
        )}
      </div>

      <RightsExportDialog songId={songId} open={exportOpen} onOpenChange={setExportOpen} />
      <SigningLinksDialog links={issuedLinks} open={linksOpen} onOpenChange={setLinksOpen} />
      <Dialog open={markOpen} onOpenChange={setMarkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark signed outside Pulse</DialogTitle>
            <DialogDescription>
              For signatures collected on paper. The sheet shows &ldquo;Marked signed by studio&rdquo;, never
              that each person signed in Pulse, and royalties are split from it. This is recorded with your name.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label className="block space-y-1">
              <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                Where are the signed copies?
              </span>
              <Textarea
                value={markNote}
                onChange={(e) => setMarkNote(e.target.value)}
                maxLength={1000}
                placeholder="Paper sheet signed 3 May, kept in the studio safe"
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMarkOpen(false)}>Cancel</Button>
            <Button onClick={markSignedOutside} disabled={statusUpdating || markNote.trim().length < 3}>
              {statusUpdating ? "Saving…" : "Mark signed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TotalReadout({ label, value }: { label: string; value: number }) {
  const ok = value === 100;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
        {label}
      </span>
      <span
        className={cn(
          "font-grotesk text-lg font-bold",
          ok ? "text-positive" : "text-critical",
        )}
      >
        {value}%
      </span>
    </div>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  type,
  required,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
  type?: "text" | "email";
  required?: boolean;
  invalid?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
        {label}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        type={type}
        required={required}
        aria-invalid={invalid || undefined}
        className={cn("h-9", invalid && "border-critical/70")}
      />
    </label>
  );
}
