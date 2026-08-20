"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Cable, CircleAlert, Plus, Sparkles, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/errors";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { StatTile } from "@/components/ui/stat-tile";
import { Section } from "@/components/ui/page";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { RunSheetButton } from "./run-sheet";
import { money } from "@/lib/format";
import { Tooltip } from "@/components/ui/tooltip";
import { cableColorHex, connectorMeta } from "./constants";
import { CableStockDialog } from "./cable-stock-dialog";
import { CablePickerDialog } from "./cable-picker-dialog";

type StockRow = {
  _id: Id<"equipment">;
  name: string;
  spec: {
    connectorA: string;
    connectorB: string;
    channels: number;
    lengthFt?: number;
    color?: string;
  } | null;
  specified: boolean;
  description: string | null;
  quantity: number;
  inUse: number;
  free: number;
  overCommitted: boolean;
  condition: string | null;
  currentValueCents: number;
};

type RunRow = {
  _id: Id<"connections">;
  source: string;
  sourcePort: string;
  destination: string;
  destinationPort: string;
  cableName: string | null;
  cableTag: string | null;
  color: string | null;
  lengthFt: number | null;
  unassigned: boolean;
  orphaned: boolean;
  isNormalled: boolean;
};

type PullRow = {
  connectorA: string;
  connectorB: string;
  needed: number;
  available: number;
  short: number;
};

/**
 * The cable locker plus this room's run list. Stock is inventory, so the
 * counts here are the same numbers the asset register reports; nothing is
 * duplicated. The pull list is what an engineer takes to the locker.
 */
export function CableManager({
  patchSpaceId,
  spaceName,
  roomName,
}: {
  patchSpaceId: Id<"patchSpaces">;
  /** Named on the printed sheet, which is the only place it appears. */
  spaceName?: string;
  roomName?: string | null;
}) {
  const stock = useQuery(api.patchCables.stock, {}) as StockRow[] | undefined;
  const summary = useQuery(api.patchCables.stockSummary, {});
  const runs = useQuery(api.patchCables.runList, { patchSpaceId }) as RunRow[] | undefined;
  const pull = useQuery(api.patchCables.pullList, { patchSpaceId }) as PullRow[] | undefined;
  const autoAssign = useMutation(api.patchCables.autoAssign);
  const unassign = useMutation(api.patchCables.unassign);

  const [stockDialog, setStockDialog] = React.useState<{
    open: boolean;
    editId: Id<"equipment"> | null;
  }>({ open: false, editId: null });
  const [pickerFor, setPickerFor] = React.useState<Id<"connections"> | null>(null);
  const [assigning, setAssigning] = React.useState(false);

  const unassignedCount = (runs ?? []).filter((r) => r.unassigned).length;

  async function runAutoAssign() {
    setAssigning(true);
    try {
      const result = await autoAssign({ patchSpaceId });
      if (result.assigned === 0 && result.short === 0) {
        toast("Every run already has a cable.");
      } else if (result.short > 0) {
        toast.warning(
          `Assigned ${result.assigned}. ${result.short} run${result.short === 1 ? "" : "s"} had no matching cable free.`,
        );
      } else {
        toast.success(`Assigned cable to ${result.assigned} run${result.assigned === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not assign."));
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="space-y-7">
      {/* Locker roll-up */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summary === undefined ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : (
          <>
            <StatTile label="Cable types" value={summary.types} icon={Cable} />
            <StatTile label="Runs owned" value={summary.units} />
            <StatTile label="Patched now" value={summary.inUse} />
            <StatTile
              label="Free"
              value={summary.free}
              accent={summary.free === 0}
              hint={summary.unspecified > 0 ? `${summary.unspecified} rows need a spec` : undefined}
            />
          </>
        )}
      </div>

      <Section
        title="Run list"
        trailing={
          <RunSheetButton
            patchSpaceId={patchSpaceId}
            spaceName={spaceName ?? "Patch"}
            roomName={roomName}
          />
        }
      >
        {runs === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Unplug}
            title="Nothing patched in this room"
            description="Patch something on the canvas and every run shows up here."
          />
        ) : (
          <div className="overflow-x-auto rounded-chrome border border-hairline">
            <Table>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH>Destination</TH>
                  <TH>Cable</TH>
                  <TH>Label</TH>
                  <TH>Length</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {runs.map((run) => (
                  <TR
                    key={run._id}
                    interactive={!run.isNormalled}
                    onClick={() => !run.isNormalled && setPickerFor(run._id)}
                  >
                    <TD>
                      <span className="font-medium text-bone">{run.source}</span>
                      <span className="mt-0.5 block font-meta text-[10px] uppercase tracking-wide text-steel">
                        {run.sourcePort}
                      </span>
                    </TD>
                    <TD>
                      <span className="font-medium text-bone">{run.destination}</span>
                      <span className="mt-0.5 block font-meta text-[10px] uppercase tracking-wide text-steel">
                        {run.destinationPort}
                      </span>
                    </TD>
                    <TD>
                      {run.isNormalled ? (
                        <Badge tone="info">Normalled</Badge>
                      ) : run.cableName ? (
                        <span className="flex items-center gap-1.5">
                          {cableColorHex(run.color) && (
                            <span
                              className="size-2.5 shrink-0 rounded-full border border-hairline-2"
                              style={{ background: cableColorHex(run.color)! }}
                            />
                          )}
                          <span className="text-bone">{run.cableName}</span>
                        </span>
                      ) : (
                        <Badge tone="caution">No cable</Badge>
                      )}
                    </TD>
                    <TD className="font-meta text-[11px] text-steel">{run.cableTag ?? "-"}</TD>
                    <TD className="text-steel">{run.lengthFt ? `${run.lengthFt} ft` : "-"}</TD>
                    <TD onClick={(event) => event.stopPropagation()}>
                      {run.cableName && !run.isNormalled && (
                        <Tooltip
                          label="Release the cable"
                          hint="Frees the run back to stock. The connection stays documented."
                        >
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Release ${run.cableName} from this run`}
                            onClick={() => unassign({ connectionId: run._id })}
                          >
                            <Unplug className="size-3.5" />
                          </Button>
                        </Tooltip>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        {runs && runs.length > 0 && (
          <p className="text-[11px] text-steel">
            {runs.length} run{runs.length === 1 ? "" : "s"}.{" "}
            {unassignedCount > 0 && (
              <span className="text-caution">{unassignedCount} with no cable assigned.</span>
            )}
          </p>
        )}
      </Section>

      {/* Pull list. Only worth showing when something is missing. */}
      {pull && pull.length > 0 && (
        <Section
          title="Pull list for this room"
          trailing={
            <Button size="sm" onClick={runAutoAssign} disabled={assigning || unassignedCount === 0}>
              <Sparkles className="size-3.5" />
              {assigning ? "Assigning" : `Auto assign ${unassignedCount}`}
            </Button>
          }
        >
          <div className="overflow-x-auto rounded-chrome border border-hairline">
            <Table>
              <THead>
                <TR>
                  <TH>Cable</TH>
                  <TH>Needed</TH>
                  <TH>Free in stock</TH>
                  <TH>Short</TH>
                </TR>
              </THead>
              <TBody>
                {pull.map((row) => (
                  <TR key={`${row.connectorA}-${row.connectorB}`}>
                    <TD className="font-medium text-bone">
                      {connectorMeta(row.connectorA).short}
                      {row.connectorA !== row.connectorB
                        ? ` to ${connectorMeta(row.connectorB).short}`
                        : ""}
                    </TD>
                    <TD>{row.needed}</TD>
                    <TD>{row.available}</TD>
                    <TD>
                      {row.short > 0 ? (
                        <Badge tone="critical">
                          <CircleAlert className="size-2.5" />
                          {row.short} short
                        </Badge>
                      ) : (
                        <Badge tone="positive">Covered</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Section>
      )}

      {/* The locker, last and folded. It is reference material - what the
          studio owns - rather than what is patched right now, and it is the
          longest table on the page. */}
      <CollapsibleSection
        defaultOpen={false}
        summary={summary ? `${summary.types} types · ${summary.free} free` : undefined}
        title="Cable stock"
        trailing={
          <Button variant="secondary" size="sm" onClick={() => setStockDialog({ open: true, editId: null })}>
            <Plus className="size-3.5" />
            Add stock
          </Button>
        }
      >
        {stock === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : stock.length === 0 ? (
          <EmptyState
            icon={Cable}
            title="No cable stock yet"
            description="Add what is in the locker and the canvas can start spending it."
            action={
              <Button size="sm" onClick={() => setStockDialog({ open: true, editId: null })}>
                <Plus className="size-3.5" />
                Add stock
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-chrome border border-hairline">
            <Table>
              <THead>
                <TR>
                  <TH>Cable</TH>
                  <TH>Ends</TH>
                  <TH>Length</TH>
                  <TH>Owned</TH>
                  <TH>Patched</TH>
                  <TH>Free</TH>
                  <TH>Value</TH>
                </TR>
              </THead>
              <TBody>
                {stock.map((row) => {
                  const hex = cableColorHex(row.spec?.color);
                  return (
                    <TR
                      key={row._id}
                      interactive
                      onClick={() => setStockDialog({ open: true, editId: row._id })}
                    >
                      <TD>
                        <span className="flex items-center gap-2">
                          {hex && (
                            <span
                              className="size-2.5 shrink-0 rounded-full border border-hairline-2"
                              style={{ background: hex }}
                            />
                          )}
                          <span className="font-medium text-bone">{row.name}</span>
                        </span>
                        {!row.specified && (
                          <Badge tone="caution" className="mt-1">
                            Needs a spec
                          </Badge>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-steel">
                        {row.spec
                          ? `${connectorMeta(row.spec.connectorA).short} · ${connectorMeta(row.spec.connectorB).short}`
                          : "-"}
                      </TD>
                      <TD className="text-steel">
                        {row.spec?.lengthFt ? `${row.spec.lengthFt} ft` : "-"}
                      </TD>
                      <TD>{row.quantity}</TD>
                      <TD>{row.inUse}</TD>
                      <TD>
                        <span
                          className={cn(
                            "font-medium",
                            row.free === 0 ? "text-caution" : "text-positive",
                          )}
                        >
                          {row.free}
                        </span>
                        {row.overCommitted && (
                          <Badge tone="critical" className="ml-1.5">
                            Over
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-steel">
                        {money(row.currentValueCents * row.quantity)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </CollapsibleSection>

      {/* The patch list that gets taped to the wall */}

      <CableStockDialog
        open={stockDialog.open}
        editId={stockDialog.editId}
        onOpenChange={(open) => setStockDialog((prev) => ({ ...prev, open }))}
      />
      <CablePickerDialog connectionId={pickerFor} onClose={() => setPickerFor(null)} />
    </div>
  );
}
