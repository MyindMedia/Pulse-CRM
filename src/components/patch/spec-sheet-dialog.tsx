"use client";

import * as React from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  Camera,
  Check,
  ClipboardPaste,
  FileText,
  Link2,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pdfToText, plainToText } from "@/lib/pdf-text";
import { diffPortsClient, type ProposedPort } from "./spec-diff";
import type { PatchPort } from "./device-node";

/* ============================================================
   Configuring a device's I/O from its documentation.

   Read the source, show what it found against what the device
   already has, and write only what the user approves. The diff
   is the whole point: a jack can have a cable in it, and the
   difference between "adds eight inputs" and "unpatches your
   session" has to be visible before anything happens.
   ============================================================ */

type Source = "lookup" | "link" | "file" | "paste" | "photo";

const SOURCES: { key: Source; label: string; icon: typeof Link2 }[] = [
  { key: "lookup", label: "Look up", icon: Search },
  { key: "link", label: "Link", icon: Link2 },
  { key: "file", label: "PDF", icon: FileText },
  { key: "paste", label: "Paste", icon: ClipboardPaste },
  { key: "photo", label: "Photo", icon: Camera },
];

export function SpecSheetDialog({
  open,
  onOpenChange,
  deviceInstanceId,
  deviceLabel,
  ports,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceInstanceId: Id<"deviceInstances">;
  deviceLabel: string;
  ports: PatchPort[];
}) {
  const propose = useAction(api.patchSpecs.proposeFromSource);
  const applyProposal = useMutation(api.patchSpecs.applyProposal);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  const [source, setSource] = React.useState<Source>("lookup");
  const [url, setUrl] = React.useState("");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [proposal, setProposal] = React.useState<{
    ports: ProposedPort[];
    summary?: string;
    label: string;
    hedged?: boolean;
  } | null>(null);

  // Which removals the user has chosen to go ahead with. Everything the
  // sheet did not mention starts UNCHECKED, because "the manual did not
  // list it" is a weak reason to pull a cable.
  const [confirmedRemovals, setConfirmedRemovals] = React.useState<Set<string>>(new Set());

  const diff = React.useMemo(
    () => (proposal ? diffPortsClient(ports, proposal.ports) : null),
    [ports, proposal],
  );

  function reset() {
    setProposal(null);
    setStatus(null);
    setConfirmedRemovals(new Set());
  }

  async function run(payload: { url?: string; text?: string; imageId?: Id<"_storage"> }, label: string) {
    setBusy(true);
    setStatus("Reading the source");
    try {
      const result = await propose({ deviceInstanceId, ...payload });
      if (!result.ok) {
        setStatus(null);
        toast.error(result.reason ?? "Nothing usable came back.");
        return;
      }
      setProposal({
        ports: (result.ports ?? []) as ProposedPort[],
        summary: result.summary,
        label,
        hedged: result.hedged,
      });
      setStatus(null);
    } catch (error) {
      setStatus(null);
      toast.error(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    setBusy(true);
    try {
      if (file.type.startsWith("image/")) {
        setStatus("Uploading the photo");
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: string };
        await run({ imageId: storageId as Id<"_storage"> }, file.name);
        return;
      }

      setStatus("Reading the document");
      const extracted =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? await pdfToText(file)
          : await plainToText(file);

      if (extracted.trim().length < 40) {
        toast.error(
          "No text came out of that file. If it is a scan, use the Photo option instead.",
        );
        setStatus(null);
        return;
      }
      await run({ text: extracted }, file.name);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!diff) return;
    setBusy(true);
    try {
      const removePortIds = diff.remove
        .filter((p) => confirmedRemovals.has(p._id))
        .map((p) => p._id as Id<"ports">);

      const result = await applyProposal({
        deviceInstanceId,
        add: diff.add as never,
        removePortIds,
        sourceLabel: proposal?.label,
      });

      toast.success(
        `${result.added} port${result.added === 1 ? "" : "s"} added` +
          (result.removed ? `, ${result.removed} removed` : "") +
          (result.cablesPulled ? `, ${result.cablesPulled} cable pulled` : ""),
      );
      onOpenChange(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not apply that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure I/O from a spec sheet</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {!proposal ? (
            <>
              <p className="text-xs text-steel">
                Point this at {deviceLabel}&apos;s documentation and it will read the
                connectors off it. Nothing changes until you approve what it found.
              </p>

              <div className="flex gap-1 rounded-chrome border border-hairline-2 bg-coal p-1">
                {SOURCES.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSource(key)}
                    aria-pressed={source === key}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5",
                      "font-meta text-[10px] uppercase tracking-wide transition-colors",
                      source === key ? "bg-gold/15 text-gold-bright" : "text-steel hover:text-bone",
                    )}
                  >
                    <Icon className="size-3" />
                    {label}
                  </button>
                ))}
              </div>

              {source === "lookup" && (
                <div className="rounded-chrome border border-hairline-2 bg-coal-2/40 p-3">
                  <p className="text-xs text-bone">
                    Look up {deviceLabel} by model name
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-steel">
                    No document needed. This is how you get the real I/O onto a device
                    that was placed before its spec was known, because a device keeps
                    the jacks it was placed with.
                  </p>
                </div>
              )}

              {source === "link" && (
                <Field
                  label="Link to the product page or manual"
                  hint="An HTML page. For a PDF, download it and use the PDF tab."
                >
                  <Input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://manufacturer.com/product/spec"
                    className="text-xs"
                  />
                </Field>
              )}

              {(source === "file" || source === "photo") && (
                <label
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1.5 rounded-chrome border",
                    "border-dashed border-hairline-2 bg-coal-2/40 px-4 py-8 text-center",
                    "transition-colors hover:border-gold-dim/60",
                  )}
                >
                  <input
                    type="file"
                    className="sr-only"
                    accept={source === "photo" ? "image/*" : ".pdf,.txt,.md,text/plain"}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void onFile(file);
                      event.target.value = "";
                    }}
                  />
                  {source === "photo" ? (
                    <Camera className="size-5 text-steel" />
                  ) : (
                    <FileText className="size-5 text-steel" />
                  )}
                  <span className="text-xs text-bone">
                    {source === "photo" ? "Choose a photo of the back panel" : "Choose a PDF or text file"}
                  </span>
                  <span className="text-[10px] text-steel">
                    {source === "photo"
                      ? "Shot straight on, with the jack labels readable."
                      : "Read in your browser. Only the text is sent."}
                  </span>
                </label>
              )}

              {source === "paste" && (
                <Field label="Paste the connector list">
                  <Textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={7}
                    placeholder={"8 x XLR/TRS combo mic inputs\n10 x TRS line outputs\nADAT in and out, S/PDIF coax"}
                    className="text-xs"
                  />
                </Field>
              )}

              {status && (
                <p className="flex items-center gap-2 text-xs text-steel">
                  <Loader2 className="size-3.5 animate-spin" />
                  {status}
                </p>
              )}

              {(source === "link" || source === "paste" || source === "lookup") && (
                <Button
                  className="w-full"
                  disabled={
                    busy ||
                    (source === "link" && !url.trim()) ||
                    (source === "paste" && text.trim().length < 20)
                  }
                  onClick={() => {
                    if (source === "link") void run({ url: url.trim() }, url.trim());
                    else if (source === "paste") void run({ text: text.trim() }, "the pasted text");
                    else void run({}, "a lookup by model name");
                  }}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {source === "lookup" ? "Look it up" : "Read it"}
                </Button>
              )}
            </>
          ) : (
            <>
              <div
                className={cn(
                  "rounded-chrome border p-3",
                  proposal.hedged
                    ? "border-caution/40 bg-caution/10"
                    : "border-hairline-2 bg-coal-2/40",
                )}
              >
                <p className="font-meta text-[9px] uppercase tracking-wide text-steel">
                  From {proposal.label}
                </p>
                {proposal.summary && (
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      proposal.hedged ? "text-caution" : "text-bone",
                    )}
                  >
                    {proposal.summary}
                  </p>
                )}
              </div>

              <div className="max-h-72 space-y-1 overflow-y-auto">
                {diff?.add.map((port, index) => (
                  <DiffRow key={`add-${index}`} tone="add" label={port.label} detail={`${port.direction} · ${port.connector}`} />
                ))}
                {diff?.keep.map(({ port }) => (
                  <DiffRow key={`keep-${port._id}`} tone="keep" label={port.label} detail="already on the device" />
                ))}
                {diff?.remove.map((port) => (
                  <DiffRow
                    key={`rm-${port._id}`}
                    tone="remove"
                    label={port.label}
                    detail={
                      port.patched
                        ? `${port.patched} cable${port.patched === 1 ? "" : "s"} patched`
                        : "not in the sheet"
                    }
                    checked={confirmedRemovals.has(port._id)}
                    onToggle={() =>
                      setConfirmedRemovals((prev) => {
                        const next = new Set(prev);
                        if (next.has(port._id)) next.delete(port._id);
                        else next.add(port._id);
                        return next;
                      })
                    }
                  />
                ))}
              </div>

              {diff && diff.remove.length > 0 && (
                <p className="text-[10px] leading-snug text-steel">
                  Removals are off by default. The sheet not mentioning a jack is a weak
                  reason to pull a cable out of it.
                </p>
              )}

              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={reset} disabled={busy}>
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={busy || !diff || (diff.add.length === 0 && confirmedRemovals.size === 0)}
                  onClick={() => void apply()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Apply {diff ? diff.add.length + confirmedRemovals.size : 0} change
                  {diff && diff.add.length + confirmedRemovals.size === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DiffRow({
  tone,
  label,
  detail,
  checked,
  onToggle,
}: {
  tone: "add" | "keep" | "remove";
  label: string;
  detail: string;
  checked?: boolean;
  onToggle?: () => void;
}) {
  const mark = tone === "add" ? "+" : tone === "remove" ? "-" : "=";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
        tone === "add" && "border-positive/30 bg-positive/8",
        tone === "keep" && "border-hairline bg-coal-2/30",
        tone === "remove" && "border-critical/30 bg-critical/8",
      )}
    >
      <span
        className={cn(
          "w-3 shrink-0 text-center font-meta font-semibold",
          tone === "add" && "text-positive",
          tone === "keep" && "text-steel",
          tone === "remove" && "text-critical",
        )}
      >
        {mark}
      </span>
      <span className="min-w-0 flex-1 truncate text-bone">{label}</span>
      <span className="shrink-0 font-meta text-[9px] uppercase tracking-wide text-steel">
        {detail}
      </span>
      {onToggle && (
        <input
          type="checkbox"
          checked={!!checked}
          onChange={onToggle}
          aria-label={`Remove ${label}`}
          className="size-3.5 shrink-0 accent-[var(--color-critical)]"
        />
      )}
    </div>
  );
}
