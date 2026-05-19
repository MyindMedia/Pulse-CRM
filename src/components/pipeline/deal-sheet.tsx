"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Check,
  Music2,
  Pencil,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetBody,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/feedback";
import { Progress } from "@/components/ui/progress";
import { money, percent, relativeTime } from "@/lib/format";
import { meta, PIPELINE_STAGE, titleCase } from "@/lib/labels";
import { KANBAN_STAGES, serviceTint } from "./constants";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="shrink-0 text-xs font-medium text-ash-dim">{label}</span>
      <div className="min-w-0 text-right text-sm text-bone">{children}</div>
    </div>
  );
}

/** Full opportunity detail drawer — edit, restage, activity, destructive actions. */
export function DealSheet({
  oppId,
  onClose,
}: {
  oppId: string | null;
  onClose: () => void;
}) {
  const open = oppId !== null;
  const detail = useQuery(
    api.opportunities.get,
    oppId ? { id: oppId as Id<"opportunities"> } : "skip",
  );
  const activity = useQuery(
    api.activity.forEntity,
    oppId ? { entityType: "opportunity", entityId: oppId } : "skip",
  );

  const update = useMutation(api.opportunities.update);
  const moveStage = useMutation(api.opportunities.moveStage);
  const remove = useMutation(api.opportunities.remove);

  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditingValue(false);
    setBusy(false);
  }, [oppId]);

  async function saveValue() {
    if (!oppId) return;
    const cents = Math.round((parseFloat(valueDraft) || 0) * 100);
    if (cents <= 0) {
      toast.error("Enter a value greater than zero");
      return;
    }
    setBusy(true);
    try {
      await update({ id: oppId as Id<"opportunities">, valueCents: cents });
      toast.success("Deal value updated");
      setEditingValue(false);
    } catch {
      toast.error("Could not update the value");
    } finally {
      setBusy(false);
    }
  }

  async function changeStage(stage: string) {
    if (!oppId) return;
    setBusy(true);
    try {
      await moveStage({
        id: oppId as Id<"opportunities">,
        stage: stage as (typeof KANBAN_STAGES)[number],
      });
      toast.success(`Moved to ${meta(PIPELINE_STAGE, stage).label}`);
    } catch {
      toast.error("Could not move the deal");
    } finally {
      setBusy(false);
    }
  }

  async function markOutcome(stage: "won" | "lost") {
    if (!oppId) return;
    setBusy(true);
    try {
      await moveStage({ id: oppId as Id<"opportunities">, stage });
      toast.success(stage === "won" ? "Deal marked won" : "Deal marked lost");
    } catch {
      toast.error("Could not update the deal");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!oppId) return;
    setBusy(true);
    try {
      await remove({ id: oppId as Id<"opportunities"> });
      toast.success("Opportunity deleted");
      onClose();
    } catch {
      toast.error("Could not delete the opportunity");
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent width="md">
        {!detail ? (
          <>
            <SheetHeader>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </SheetHeader>
            <SheetBody className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </SheetBody>
          </>
        ) : (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: serviceTint(detail.serviceType) }}
                />
                <Badge tone={meta(PIPELINE_STAGE, detail.stage).tone}>
                  {meta(PIPELINE_STAGE, detail.stage).label}
                </Badge>
              </div>
              <SheetTitle>{detail.title}</SheetTitle>
              <SheetDescription>
                {titleCase(detail.serviceType)} deal · updated {relativeTime(detail.updatedAt)}
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="space-y-5">
              {/* Core facts */}
              <div className="divide-y divide-hairline">
                <Row label="Artist">
                  <span className="inline-flex items-center gap-2">
                    <Avatar
                      name={detail.artist?.name ?? "Unknown"}
                      color={detail.artist?.avatarColor}
                      size="xs"
                    />
                    <span className="truncate">{detail.artist?.name ?? "Unknown"}</span>
                  </span>
                </Row>

                <Row label="Song">
                  {detail.songTitle ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Music2 className="size-3.5 text-ash-dim" />
                      {detail.songTitle}
                    </span>
                  ) : (
                    <span className="text-ash-dim">Not linked</span>
                  )}
                </Row>

                <Row label="Value">
                  {editingValue ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Input
                        inputMode="decimal"
                        value={valueDraft}
                        onChange={(e) =>
                          setValueDraft(e.target.value.replace(/[^0-9.]/g, ""))
                        }
                        className="h-8 w-28 text-right"
                        autoFocus
                      />
                      <Button
                        variant="primary"
                        size="icon-sm"
                        onClick={saveValue}
                        disabled={busy}
                        aria-label="Save value"
                      >
                        <Check className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditingValue(false)}
                        aria-label="Cancel"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setValueDraft((detail.valueCents / 100).toString());
                        setEditingValue(true);
                      }}
                      className="inline-flex items-center gap-1.5 font-mono font-semibold text-gold-bright outline-none hover:underline focus-visible:ring-2 focus-visible:ring-gold/30"
                    >
                      {money(detail.valueCents)}
                      <Pencil className="size-3 text-ash-dim" />
                    </button>
                  )}
                </Row>

                <Row label="Probability">
                  <span className="inline-flex items-center gap-2">
                    <Progress value={detail.probability} className="w-24" />
                    <span className="font-mono text-xs text-ash">
                      {percent(detail.probability)}
                    </span>
                  </span>
                </Row>

                <Row label="Weighted value">
                  <span className="font-mono text-ash">
                    {money(Math.round(detail.valueCents * detail.probability))}
                  </span>
                </Row>

                <Row label="Source">{detail.source ?? <span className="text-ash-dim">—</span>}</Row>
              </div>

              {/* Stage control */}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-ash">Stage</p>
                <Select
                  value={KANBAN_STAGES.includes(detail.stage as (typeof KANBAN_STAGES)[number])
                    ? detail.stage
                    : undefined}
                  onValueChange={changeStage}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={meta(PIPELINE_STAGE, detail.stage).label} />
                  </SelectTrigger>
                  <SelectContent>
                    {KANBAN_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {meta(PIPELINE_STAGE, s).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Activity timeline */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-ash">Activity</p>
                {activity === undefined ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-9 w-full" />
                    ))}
                  </div>
                ) : activity.length === 0 ? (
                  <p className="rounded-md border border-dashed border-hairline-2 py-6 text-center text-xs text-ash-dim">
                    No activity logged for this deal yet.
                  </p>
                ) : (
                  <ul className="space-y-0.5">
                    {activity.map((a) => (
                      <li key={a._id} className="flex items-start gap-2.5 rounded-md px-1 py-1.5">
                        <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-sm bg-coal-2 text-ash-dim">
                          <TrendingUp className="size-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-bone">{a.summary}</p>
                          <p className="font-mono text-[0.5625rem] uppercase tracking-wide text-ash-dim">
                            {titleCase(a.kind)} · {relativeTime(a._creationTime)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </SheetBody>

            <SheetFooter className="flex-wrap">
              <Button
                variant="primary"
                size="sm"
                onClick={() => markOutcome("won")}
                disabled={busy || detail.stage === "won"}
              >
                Mark won
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => markOutcome("lost")}
                disabled={busy || detail.stage === "lost"}
              >
                Mark lost
              </Button>
              <div className="flex-1" />
              <Button
                variant="danger"
                size="sm"
                onClick={destroy}
                disabled={busy}
              >
                {busy ? <Spinner /> : <Trash2 className="size-3.5" />}
                Delete
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
