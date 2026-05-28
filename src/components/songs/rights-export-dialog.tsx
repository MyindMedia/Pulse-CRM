"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Check, X, FileDown, FileJson, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CHECKS: { key: string; label: string }[] = [
  { key: "mastersBalanced", label: "Master splits total 100%" },
  { key: "publishingBalanced", label: "Publishing splits total 100%" },
  { key: "allSigned", label: "All contributors signed" },
  { key: "sheetExecuted", label: "Split sheet fully executed" },
  { key: "hasIsrc", label: "ISRC assigned" },
  { key: "hasIswc", label: "ISWC assigned" },
];

/** Release-ready check + distributor/PRO handoff export for one song. */
export function RightsExportDialog({
  songId, open, onOpenChange,
}: {
  songId: Id<"songs">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const packet = useQuery(api.rightsExport.packet, open ? { songId } : "skip");

  const slug = packet ? packet.song.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "song";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Rights export</DialogTitle>
          <DialogDescription>Release-ready check, plus a metadata + splits handoff for your distributor or PRO.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {packet === undefined ? (
            <Skeleton className="h-64 w-full" />
          ) : packet === null ? (
            <p className="text-sm text-ash">This song could not be loaded.</p>
          ) : (
            <>
              <div
                className={`flex items-center gap-2 rounded-md border px-4 py-3 ${
                  packet.validation.releaseReady ? "border-positive/30 bg-positive/[0.06]" : "border-caution/30 bg-caution/[0.06]"
                }`}
              >
                {packet.validation.releaseReady ? (
                  <ShieldCheck className="size-5 shrink-0 text-positive" />
                ) : (
                  <AlertTriangle className="size-5 shrink-0 text-caution" />
                )}
                <p className={`text-sm font-medium ${packet.validation.releaseReady ? "text-positive" : "text-caution"}`}>
                  {packet.validation.releaseReady
                    ? "Release-ready - all rights metadata checks pass."
                    : `Not release-ready yet - ${packet.warnings.length} item${packet.warnings.length === 1 ? "" : "s"} to resolve.`}
                </p>
              </div>

              <ul className="grid gap-1.5 sm:grid-cols-2">
                {CHECKS.map((c) => {
                  const ok = (packet.validation as Record<string, unknown>)[c.key] === true;
                  return (
                    <li key={c.key} className="flex items-center gap-2 text-sm">
                      {ok ? <Check className="size-4 text-positive" /> : <X className="size-4 text-critical" />}
                      <span className={ok ? "text-bone" : "text-ash"}>{c.label}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <Meta label="ISRC" value={packet.song.isrc} />
                <Meta label="ISWC" value={packet.song.iswc} />
              </div>

              {packet.contributors.length > 0 && (
                <Table>
                  <THead>
                    <TR>
                      <TH>Contributor</TH>
                      <TH className="text-right">Master</TH>
                      <TH className="text-right">Publishing</TH>
                      <TH>PRO</TH>
                      <TH className="text-right">Signed</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {packet.contributors.map((c, i) => (
                      <TR key={`${c.name}-${i}`}>
                        <TD className="font-medium">{c.name}<span className="block text-xs text-ash-dim">{c.role}</span></TD>
                        <TD className="text-right tabular-nums">{c.masterPct}%</TD>
                        <TD className="text-right tabular-nums">{c.publishingPct}%</TD>
                        <TD className="text-ash">{c.pro || "-"}</TD>
                        <TD className="text-right">
                          {c.signed ? <Badge tone="positive">yes</Badge> : <Badge tone="neutral">no</Badge>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </>
          )}
        </DialogBody>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={!packet}
            onClick={() => packet && download(`${slug}-rights.json`, JSON.stringify(packet, null, 2), "application/json")}
          >
            <FileJson className="size-4" /> Download JSON
          </Button>
          <Button
            disabled={!packet}
            onClick={() => packet && download(`${slug}-splits.csv`, packet.csv, "text/csv")}
          >
            <FileDown className="size-4" /> Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-hairline bg-coal-2 px-3 py-2">
      <p className="font-mono text-[0.5625rem] uppercase tracking-wide text-ash-dim">{label}</p>
      <p className={`mt-0.5 font-mono ${value ? "text-bone" : "text-ash-dim"}`}>{value ?? "not set"}</p>
    </div>
  );
}
