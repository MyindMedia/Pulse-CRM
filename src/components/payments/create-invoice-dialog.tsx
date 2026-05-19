"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Plus, Trash2, Receipt } from "lucide-react";
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RosterEntry, SongOption } from "./types";

/** A line-item draft — amount kept as a raw dollar string until submit. */
type DraftLine = { id: number; label: string; amount: string };

let lineCounter = 0;
function newLine(): DraftLine {
  return { id: ++lineCounter, label: "", amount: "" };
}

/** Parse a dollar string to integer cents, clamped to >= 0. */
function dollarsToCents(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/** Default due date input value — 14 days out, yyyy-mm-dd. */
function defaultDueDate(): string {
  const d = new Date(Date.now() + 14 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function CreateInvoiceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const roster = useQuery(api.artists.roster) as RosterEntry[] | undefined;
  const create = useMutation(api.invoices.create);

  const [artistId, setArtistId] = React.useState<string>("");
  const [songId, setSongId] = React.useState<string>("");
  const [dueDate, setDueDate] = React.useState<string>(defaultDueDate);
  const [lines, setLines] = React.useState<DraftLine[]>(() => [newLine()]);
  const [submitting, setSubmitting] = React.useState(false);

  const songs = useQuery(
    api.songs.picker,
    artistId ? { artistId: artistId as Id<"artists"> } : "skip",
  ) as SongOption[] | undefined;

  // Reset the form whenever the dialog is freshly opened.
  React.useEffect(() => {
    if (open) {
      setArtistId("");
      setSongId("");
      setDueDate(defaultDueDate());
      setLines([newLine()]);
      setSubmitting(false);
    }
  }, [open]);

  const totalCents = lines.reduce((sum, l) => sum + dollarsToCents(l.amount), 0);
  const validLines = lines.filter((l) => l.label.trim() && dollarsToCents(l.amount) > 0);
  const canSubmit = Boolean(artistId) && validLines.length > 0 && !submitting;

  function patchLine(id: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function removeLine(id: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await create({
        artistId: artistId as Id<"artists">,
        songId: songId ? (songId as Id<"songs">) : undefined,
        lineItems: validLines.map((l) => ({
          label: l.label.trim(),
          amountCents: dollarsToCents(l.amount),
        })),
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).getTime() : undefined,
      });
      toast.success("Invoice drafted");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create invoice");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            Bill a client for studio work. The invoice is created as a draft so you can
            review it before sending.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <Select value={artistId} onValueChange={(v) => { setArtistId(v); setSongId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder={roster ? "Select a client" : "Loading roster…"} />
                </SelectTrigger>
                <SelectContent>
                  {(roster ?? []).map((a) => (
                    <SelectItem key={a._id} value={a._id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Song" hint={!artistId ? "Pick a client first" : "Optional"}>
              <Select
                value={songId}
                onValueChange={setSongId}
                disabled={!artistId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      !artistId
                        ? "—"
                        : songs === undefined
                          ? "Loading songs…"
                          : songs.length === 0
                            ? "No songs"
                            : "Link a song"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(songs ?? []).map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Line items editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-ash">Line items</p>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, newLine()])}
                className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline"
              >
                <Plus className="size-3.5" />
                Add line
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={line.id} className="flex items-start gap-2">
                  <Input
                    value={line.label}
                    onChange={(e) => patchLine(line.id, { label: e.target.value })}
                    placeholder={i === 0 ? "Tracking session — 4 hrs" : "Description"}
                    className="flex-1"
                  />
                  <div className="relative w-36 shrink-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-ash-dim">
                      $
                    </span>
                    <Input
                      value={line.amount}
                      onChange={(e) =>
                        patchLine(line.id, {
                          amount: e.target.value.replace(/[^0-9.]/g, ""),
                        })
                      }
                      inputMode="decimal"
                      placeholder="0.00"
                      className="pl-6 text-right font-mono"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    aria-label="Remove line"
                    className="shrink-0"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due date">
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="font-mono"
              />
            </Field>

            <div className="flex flex-col justify-end">
              <div
                className={cn(
                  "flex items-center justify-between rounded-md border border-hairline-2 bg-ink-2 px-3 py-2.5",
                  totalCents > 0 && "border-gold-dim/50",
                )}
              >
                <span className="overline">Invoice total</span>
                <span className="font-display text-xl font-bold tracking-tight text-bone">
                  {money(totalCents)}
                </span>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Spinner className="text-gold-ink" /> : <Receipt className="size-4" />}
            {submitting ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
