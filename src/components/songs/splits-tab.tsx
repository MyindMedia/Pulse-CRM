"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileDown, Plus, Send, Trash2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RightsExportDialog } from "@/components/songs/rights-export-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Contributor = {
  name: string;
  role: string;
  masterPct: number;
  publishingPct: number;
  pro?: string;
  ipi?: string;
  email?: string;
  signed: boolean;
};

type SplitStatus = "draft" | "sent" | "fully_executed";

const SPLIT_STATUS: Record<SplitStatus, { label: string; tone: "neutral" | "info" | "positive" }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  fully_executed: { label: "Fully executed", tone: "positive" },
};

function emptyContributor(): Contributor {
  return {
    name: "",
    role: "Songwriter",
    masterPct: 0,
    publishingPct: 0,
    pro: "",
    ipi: "",
    email: "",
    signed: false,
  };
}

export function SplitsTab({ songId }: { songId: Id<"songs"> }) {
  const split = useQuery(api.splitSheets.forSong, { songId });
  const upsert = useMutation(api.splitSheets.upsert);
  const setStatusMut = useMutation(api.splitSheets.setStatus);

  const [rows, setRows] = useState<Contributor[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  if (split === undefined) {
    return <Skeleton className="h-72 w-full" />;
  }

  // Working copy: local edits if present, otherwise the server state.
  const working: Contributor[] =
    rows ??
    (split
      ? split.contributors.map((c) => ({
          name: c.name,
          role: c.role,
          masterPct: c.masterPct,
          publishingPct: c.publishingPct,
          pro: c.pro ?? "",
          ipi: c.ipi ?? "",
          email: c.email ?? "",
          signed: c.signed,
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
          signed: c.signed,
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

  async function changeStatus(status: SplitStatus) {
    if (!split) return;
    setStatusUpdating(true);
    try {
      await setStatusMut({ id: split._id, status });
      toast.success(`Split sheet marked ${SPLIT_STATUS[status].label.toLowerCase()}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the status.");
    } finally {
      setStatusUpdating(false);
    }
  }

  const currentStatus = (split?.status ?? "draft") as SplitStatus;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-ash-dim" />
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
                className="space-y-2 rounded-md border border-hairline bg-coal-2 p-3"
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
                    label="Email"
                    value={c.email ?? ""}
                    onChange={(v) => patch(i, { email: v })}
                    placeholder="name@email.com"
                  />
                  <div className="flex items-center justify-between gap-2 pt-5">
                    <label className="flex items-center gap-2 text-xs font-medium text-ash">
                      <Checkbox
                        checked={c.signed}
                        onCheckedChange={(v) => patch(i, { signed: v === true })}
                      />
                      Signed
                    </label>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeRow(i)}
                      aria-label="Remove contributor"
                    >
                      <Trash2 className="size-4 text-critical" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-3.5" />
            Add contributor
          </Button>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save split sheet" : "No changes"}
        </Button>
        {split && currentStatus === "draft" && (
          <Button
            variant="outline"
            onClick={() => changeStatus("sent")}
            disabled={statusUpdating || dirty}
          >
            <Send className="size-4" />
            Send for signature
          </Button>
        )}
        {split && currentStatus !== "fully_executed" && (
          <Button
            variant="outline"
            onClick={() => changeStatus("fully_executed")}
            disabled={statusUpdating || dirty}
          >
            <CheckCircle2 className="size-4" />
            Mark fully executed
          </Button>
        )}
        {split && !split.allSigned && currentStatus !== "fully_executed" && (
          <span className="text-xs text-ash-dim">
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
    </div>
  );
}

function TotalReadout({ label, value }: { label: string; value: number }) {
  const ok = value === 100;
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
        {label}
      </span>
      <span
        className={cn(
          "font-display text-lg font-bold",
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  return (
    <div className="space-y-1">
      <span className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
        {label}
      </span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="h-9"
      />
    </div>
  );
}
