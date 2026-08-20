"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AlertTriangle, ExternalLink, Search, Zap } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { categoryMeta } from "@/components/studio/constants";
import { Boxes } from "lucide-react";
import type { PatchPort } from "./device-node";
import { DeviceEditDialog, type EditableDevice } from "./device-edit-dialog";
import { useCapabilities } from "@/lib/use-capabilities";

type GraphDevice = {
  _id: Id<"deviceInstances">;
  label: string;
  notes?: string;
  normalling?: string;
  category: string;
  manufacturer: string;
  phantomSensitive: boolean;
  ports: PatchPort[];
  equipment: {
    _id: Id<"equipment">;
    name: string;
    serialNumber: string | null;
    condition: string | null;
    quantity: number;
  } | null;
};

const COLUMNS = 7;

/**
 * Every device on this canvas as a table. This is the view an engineer
 * prints or scans when they do not want a graph, and it is where the
 * inventory link is most visible: each row says which asset it is and
 * whether it is a real one.
 */
export function DeviceList({ patchSpaceId }: { patchSpaceId: Id<"patchSpaces"> }) {
  const graph = useQuery(api.patchManager.graph, { patchSpaceId }) as
    | { devices: GraphDevice[]; connections: { fromPortId: string; toPortId: string }[] }
    | null
    | undefined;
  const [q, setQ] = React.useState("");
  const [editing, setEditing] = React.useState<EditableDevice | null>(null);
  const { can, loaded } = useCapabilities();
  const canEdit = loaded && can("patch.edit");

  const connected = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of graph?.connections ?? []) {
      set.add(c.fromPortId);
      set.add(c.toPortId);
    }
    return set;
  }, [graph]);

  const rows = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (graph?.devices ?? [])
      .filter(
        (d) =>
          !needle ||
          d.label.toLowerCase().includes(needle) ||
          d.manufacturer.toLowerCase().includes(needle) ||
          (d.equipment?.serialNumber ?? "").toLowerCase().includes(needle),
      )
      .map((device) => {
        const inputs = device.ports.filter(
          (p) => p.direction === "input" || p.direction === "bidirectional",
        ).length;
        const outputs = device.ports.filter(
          (p) => p.direction === "output" || p.direction === "bidirectional",
        ).length;
        const patched = device.ports.filter((p) => connected.has(p._id)).length;
        const phantomOn = device.ports.filter((p) => p.state.phantom === true).length;
        return { device, inputs, outputs, patched, phantomOn };
      })
      .sort((a, b) => a.device.label.localeCompare(b.device.label));
  }, [graph, q, connected]);

  const loading = graph === undefined;

  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-steel" />
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search devices and serials"
          className="h-9 pl-8 text-xs"
          aria-label="Search devices"
        />
      </div>

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={q ? "No devices match that" : "Nothing on this canvas yet"}
          description={
            q
              ? "Try a different search."
              : "Place gear from the canvas palette and it shows up here."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-chrome border border-hairline">
          <Table>
            <THead>
              <TR>
                <TH>Device</TH>
                <TH>Category</TH>
                <TH>Inventory asset</TH>
                <TH>Serial</TH>
                <TH>Ports</TH>
                <TH>Patched</TH>
                <TH>Flags</TH>
              </TR>
            </THead>
            <TBody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TR key={i}>
                    {Array.from({ length: COLUMNS }).map((__, j) => (
                      <TD key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TD>
                    ))}
                  </TR>
                ))}

              {!loading &&
                rows.map(({ device, inputs, outputs, patched, phantomOn }) => {
                  const meta = categoryMeta(device.category);
                  const Icon = meta.icon;
                  return (
                    <TR
                      key={device._id}
                      interactive
                      onClick={() => setEditing(device as unknown as EditableDevice)}
                    >
                      <TD>
                        <span className="flex items-center gap-2">
                          <Icon className="size-3.5 shrink-0 text-steel" />
                          <span className="font-medium text-bone">{device.label}</span>
                        </span>
                        {device.manufacturer && (
                          <span className="mt-0.5 block font-meta text-[10px] uppercase tracking-wide text-steel">
                            {device.manufacturer}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone="neutral">{meta.label}</Badge>
                      </TD>
                      <TD onClick={(event) => event.stopPropagation()}>
                        {device.equipment ? (
                          <Link
                            href="/inventory"
                            className="inline-flex items-center gap-1 text-info hover:underline"
                          >
                            {device.equipment.name}
                            <ExternalLink className="size-3" />
                          </Link>
                        ) : (
                          <Badge tone="caution">Unlinked</Badge>
                        )}
                      </TD>
                      <TD className="font-meta text-[11px] text-steel">
                        {device.equipment?.serialNumber ?? "-"}
                      </TD>
                      <TD className="whitespace-nowrap text-steel">
                        {inputs} in · {outputs} out
                      </TD>
                      <TD>
                        <span
                          className={
                            patched > 0 ? "font-medium text-bone" : "text-steel/70"
                          }
                        >
                          {patched} of {device.ports.length}
                        </span>
                      </TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          {phantomOn > 0 && (
                            <Badge tone="caution">
                              <Zap className="size-2.5" />
                              48V ×{phantomOn}
                            </Badge>
                          )}
                          {device.phantomSensitive && (
                            <Badge tone="critical">
                              <AlertTriangle className="size-2.5" />
                              Ribbon
                            </Badge>
                          )}
                          {device.equipment?.condition && (
                            <Badge tone="neutral">{device.equipment.condition}</Badge>
                          )}
                        </span>
                      </TD>
                    </TR>
                  );
                })}
            </TBody>
          </Table>
        </div>
      )}

      <DeviceEditDialog
        device={editing}
        patchSpaceId={patchSpaceId}
        canEdit={canEdit}
        onOpenChange={(open) => !open && setEditing(null)}
      />

      {!loading && rows.length > 0 && (
        <p className="text-[11px] text-steel">
          {rows.length} device{rows.length === 1 ? "" : "s"} on this canvas. Click a row to edit it.{" "}
          {rows.filter((r) => !r.device.equipment).length > 0 && (
            <span className="text-caution">
              {rows.filter((r) => !r.device.equipment).length} not linked to inventory.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
