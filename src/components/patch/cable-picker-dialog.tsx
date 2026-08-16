"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ArrowRight, Cable, Check, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONNECTORS, cableColorHex, connectorMeta, levelMeta } from "./constants";
import { CableColorField } from "./cable-color-field";
import { CableLabelFields } from "./cable-label-fields";

type Options = {
  run: {
    source: string;
    destination: string;
    sourceConnector: string | null;
    destinationConnector: string | null;
    signalLevel: string | null;
  };
  currentCableId: Id<"equipment"> | null;
  currentTag: string | null;
  options: {
    _id: Id<"equipment">;
    name: string;
    connectorA: string | null;
    connectorB: string | null;
    lengthFt: number | null;
    color: string | null;
    genderA: string | null;
    genderB: string | null;
    quantity: number;
    free: number;
    current: boolean;
    fit: "exact" | "compatible" | "vague" | "mismatch";
    fitReason: string | null;
  }[];
};

/**
 * "Which cable did you use?" asked at the moment the question is easy to
 * answer: right after the run is drawn, while the engineer is still holding
 * the thing. Answering later, from a table, means guessing.
 *
 * Two ways to answer: pick from the locker, or describe the cable in your
 * hand and have it join the locker. The second is the common case in a real
 * studio, where the inventory is always a little behind reality.
 */
export function CablePickerDialog({
  connectionId,
  onClose,
}: {
  connectionId: Id<"connections"> | null;
  onClose: () => void;
}) {
  const data = useQuery(
    api.patchCables.optionsFor,
    connectionId ? { connectionId } : "skip",
  ) as Options | null | undefined;

  const updateConnection = useMutation(api.patchManager.updateConnection);
  const createAndAssign = useMutation(api.patchCables.createAndAssign);

  const [mode, setMode] = React.useState<"stock" | "new">("stock");
  const [q, setQ] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [labelMode, setLabelMode] = React.useState<"single" | "perEnd">("single");
  const [sourceTag, setSourceTag] = React.useState("");
  const [targetTag, setTargetTag] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const [draft, setDraft] = React.useState({
    name: "",
    connectorA: "xlr",
    connectorB: "xlr",
    lengthFt: "10",
    color: "black",
    quantity: "1",
    price: "",
  });

  // Reset whenever a different run is being asked about, and pre-fill the
  // new-cable form from the two jacks so the common case is one click.
  const [seenId, setSeenId] = React.useState<string | null>(null);
  if (connectionId !== seenId) {
    setSeenId(connectionId);
    setMode("stock");
    setQ("");
    setTag(data?.currentTag ?? "");
    setLabelMode("single");
    setSourceTag("");
    setTargetTag("");
    setDraft((d) => ({
      ...d,
      name: "",
      connectorA: data?.run.sourceConnector ?? "xlr",
      connectorB: data?.run.destinationConnector ?? "xlr",
    }));
  }

  const level = data?.run.signalLevel ? levelMeta(data.run.signalLevel) : null;

  const suggestedName = `${connectorMeta(draft.connectorA).short}${
    draft.connectorA === draft.connectorB ? "" : ` to ${connectorMeta(draft.connectorB).short}`
  }${draft.lengthFt ? ` ${draft.lengthFt}ft` : ""}`;

  const filtered = (data?.options ?? []).filter((o) =>
    q.trim() ? o.name.toLowerCase().includes(q.trim().toLowerCase()) : true,
  );

  async function assign(cableId: Id<"equipment">, fit?: string, reason?: string | null) {
    if (!connectionId) return;
    // A cable that cannot physically seat is refused by the server. Offer
    // to record it anyway rather than just failing, because an engineer
    // using an adapter is describing their rig accurately.
    if (
      fit === "mismatch" &&
      !window.confirm(
        `${reason ?? "This cable does not fit these jacks."}\n\nRecord it anyway? Use this when an adapter is in the chain.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await updateConnection({
        id: connectionId,
        cableId,
        cableTag: labelMode === "single" ? tag.trim() || undefined : undefined,
        cableLabelMode: labelMode,
        cableTagSource: labelMode === "perEnd" ? sourceTag.trim() || undefined : undefined,
        cableTagTarget: labelMode === "perEnd" ? targetTag.trim() || undefined : undefined,
        allowMismatch: fit === "mismatch",
      });
      toast.success("Cable recorded on this run.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign that cable.");
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    if (!connectionId) return;
    setBusy(true);
    try {
      await createAndAssign({
        connectionId,
        name: draft.name.trim() || suggestedName,
        connectorA: draft.connectorA as never,
        connectorB: draft.connectorB as never,
        lengthFt: Number(draft.lengthFt) || undefined,
        color: draft.color,
        quantity: Math.max(1, Number(draft.quantity) || 1),
        purchaseCents: draft.price ? Math.round(Number(draft.price) * 100) : undefined,
        cableTag: labelMode === "single" ? tag.trim() || undefined : undefined,
      });
      if (labelMode === "perEnd" && connectionId) {
        await updateConnection({
          id: connectionId,
          cableLabelMode: "perEnd",
          cableTagSource: sourceTag.trim() || undefined,
          cableTagTarget: targetTag.trim() || undefined,
        });
      }
      toast.success(`${draft.name.trim() || suggestedName} added to inventory and patched.`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add that cable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!connectionId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Which cable is this?</DialogTitle>
          <DialogDescription>
            Recording it now is what makes the run traceable later.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* The run, so there is no doubt what is being answered. */}
          {data === undefined ? (
            <Skeleton className="h-14 w-full" />
          ) : data ? (
            <div className="flex items-center gap-2 rounded-chrome border border-hairline-2 bg-coal-2/50 px-3 py-2.5 text-xs">
              <span
                className="h-8 w-[3px] shrink-0 rounded-full"
                style={{ background: level?.color ?? "#5db4ff" }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-bone">{data.run.source}</span>
                <span className="mt-0.5 flex items-center gap-1 font-meta text-[10px] uppercase tracking-wide text-steel">
                  <ArrowRight className="size-2.5" />
                  {data.run.destination}
                </span>
              </span>
              {data.run.sourceConnector && data.run.destinationConnector && (
                <Badge tone="neutral">
                  {connectorMeta(data.run.sourceConnector).short}
                  {data.run.sourceConnector !== data.run.destinationConnector
                    ? ` · ${connectorMeta(data.run.destinationConnector).short}`
                    : ""}
                </Badge>
              )}
            </div>
          ) : null}

          {/* Mode switch */}
          <div className="flex items-center gap-1 rounded-md border border-hairline-2 bg-coal-2/40 p-1">
            {(
              [
                { key: "stock", label: "From the locker", icon: Cable },
                { key: "new", label: "New cable", icon: Plus },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                aria-pressed={mode === key}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 py-1.5 font-meta text-[10px] uppercase tracking-wide transition-colors",
                  mode === key
                    ? "bg-gold/15 text-gold-bright"
                    : "text-steel hover:text-bone",
                )}
              >
                <Icon className="size-3" />
                {label}
              </button>
            ))}
          </div>

          {mode === "stock" ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-steel" />
                <Input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Search the locker"
                  className="h-9 pl-8 text-xs"
                  aria-label="Search cable stock"
                />
              </div>

              {data === undefined ? (
                <Skeleton className="h-40 w-full" />
              ) : filtered.length === 0 ? (
                <div className="rounded-md border border-dashed border-graphite/60 px-3 py-8 text-center">
                  <p className="text-xs text-steel">
                    {data?.options.length === 0
                      ? "The locker is empty."
                      : "Nothing matches that."}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => setMode("new")}
                  >
                    <Plus className="size-3.5" />
                    Add the cable you are holding
                  </Button>
                </div>
              ) : (
                <div className="max-h-60 space-y-1 overflow-y-auto pr-1">
                  {filtered.map((option) => {
                    const hex = cableColorHex(option.color);
                    const unavailable = option.free <= 0 && !option.current;
                    return (
                      <button
                        key={option._id}
                        type="button"
                        disabled={busy || unavailable}
                                        onClick={() => assign(option._id, option.fit, option.fitReason)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
                          option.current
                            ? "border-gold-dim/60 bg-gold/10"
                            : unavailable
                              ? "cursor-not-allowed border-transparent opacity-40"
                              : "border-transparent hover:border-gold-dim/50 hover:bg-gold/[0.06]",
                        )}
                      >
                        <span
                          className="size-3 shrink-0 rounded-full border border-hairline-2"
                          style={{ background: hex ?? "#3c3a3e" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-bone">
                            {option.name}
                          </span>
                          <span className="block truncate font-meta text-[10px] uppercase tracking-wide text-steel">
                            {option.connectorA
                              ? `${connectorMeta(option.connectorA).short} · ${connectorMeta(option.connectorB ?? option.connectorA).short}`
                              : "No spec"}
                            {option.lengthFt ? ` · ${option.lengthFt}ft` : ""}
                          </span>
                        </span>
                        {!option.current && option.fit === "exact" && (
                          <Badge tone="positive">Fits</Badge>
                        )}
                        {!option.current && option.fit === "compatible" && (
                          <Badge tone="info">Mates</Badge>
                        )}
                        {!option.current && option.fit === "vague" && (
                          <Badge tone="neutral">Unverified</Badge>
                        )}
                        {option.current && (
                          <Badge tone="gold">
                            <Check className="size-2.5" />
                            On this run
                          </Badge>
                        )}
                        <span
                          className={cn(
                            "shrink-0 font-meta text-[10px] font-semibold",
                            option.free > 0 ? "text-positive" : "text-caution",
                          )}
                        >
                          {option.free}/{option.quantity}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Name" hint={`Leave blank to use "${suggestedName}"`}>
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder={suggestedName}
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="End A">
                  <Select
                    value={draft.connectorA}
                    onValueChange={(value) => setDraft({ ...draft, connectorA: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTORS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="End B">
                  <Select
                    value={draft.connectorB}
                    onValueChange={(value) => setDraft({ ...draft, connectorB: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONNECTORS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Length (ft)">
                  <Input
                    type="number"
                    min={0}
                    value={draft.lengthFt}
                    onChange={(event) => setDraft({ ...draft, lengthFt: event.target.value })}
                  />
                </Field>
                <Field label="How many" hint="Adds this many to stock.">
                  <Input
                    type="number"
                    min={1}
                    value={draft.quantity}
                    onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
                  />
                </Field>
                <Field label="Price each" hint="Optional.">
                  <Input
                    type="number"
                    min={0}
                    value={draft.price}
                    placeholder="0"
                    onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                  />
                </Field>
              </div>

              <Field label="Jacket colour">
                <CableColorField
                  value={draft.color}
                  onChange={(color) => setDraft({ ...draft, color })}
                />
              </Field>
            </div>
          )}

          <CableLabelFields
            mode={labelMode}
            onModeChange={setLabelMode}
            tag={tag}
            onTagChange={setTag}
            sourceTag={sourceTag}
            onSourceTagChange={setSourceTag}
            targetTag={targetTag}
            onTargetTagChange={setTargetTag}
            sourceName={data?.run.source}
            targetName={data?.run.destination}
          />

        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Not sure yet
          </Button>
          {mode === "new" && (
            <Button onClick={createNew} disabled={busy}>
              {busy ? "Adding" : "Add to inventory and patch"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
