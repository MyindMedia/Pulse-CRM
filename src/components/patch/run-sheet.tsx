"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectorMeta } from "./constants";

/* ============================================================
   The run list as a sheet of paper.

   A patch map lives on a screen; a session happens in a room
   with someone's hands full. What gets taped to the rack is a
   printed list, so this is not a screenshot of the UI - it is a
   document: white ground, black text, the studio's mark at the
   top, and every run legible at arm's length.

   Printed through the browser rather than generated server-side.
   That keeps the studio's own fonts, logo and accent exactly as
   they appear everywhere else, needs no PDF library, and "Save
   as PDF" in the print dialog produces the file.
   ============================================================ */

export function RunSheetButton({
  patchSpaceId,
  spaceName,
  roomName,
}: {
  patchSpaceId: Id<"patchSpaces">;
  spaceName: string;
  roomName?: string | null;
}) {
  const org = useQuery(api.orgs.current) as
    | { name?: string; logoUrl?: string | null; accentColor?: string }
    | null
    | undefined;
  const runs = useQuery(api.patchCables.runList, { patchSpaceId }) as
    | RunRow[]
    | undefined;

  const ready = !!runs;

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={!ready}
        onClick={() => window.print()}
        data-print-hide
      >
        <Printer className="size-3.5" />
        Print run sheet
      </Button>

      {/* Rendered always but only visible to the printer, so the browser has
          the document laid out and the fonts loaded before print fires. */}
      <RunSheet
        runs={runs ?? []}
        spaceName={spaceName}
        roomName={roomName}
        studioName={org?.name ?? "Studio"}
        logoUrl={org?.logoUrl ?? null}
        accent={org?.accentColor ?? "#fdb913"}
      />
    </>
  );
}

type RunRow = {
  _id: string;
  source: string;
  sourcePort: string;
  sourceConnector: string;
  destination: string;
  destinationPort: string;
  destinationConnector: string;
  cableName: string | null;
  cableTag: string | null;
  color: string | null;
  lengthFt: number | null;
  isNormalled: boolean;
  unassigned: boolean;
  notes: string | null;
};

function RunSheet({
  runs,
  spaceName,
  roomName,
  studioName,
  logoUrl,
  accent,
}: {
  runs: RunRow[];
  spaceName: string;
  roomName?: string | null;
  studioName: string;
  logoUrl: string | null;
  accent: string;
}) {
  /* Printed date, not "now" re-rendered: a sheet taped to a rack should say
     when it was printed, and re-rendering would make it lie about that on
     every reflow. */
  const printedAt = React.useMemo(
    () =>
      new Date().toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [],
  );

  return (
    <div className="run-sheet" aria-hidden>
      <header className="run-sheet-head" style={{ borderBottomColor: accent }}>
        <div className="run-sheet-brand">
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoUrl} alt="" className="run-sheet-logo" />
          ) : (
            <span className="run-sheet-mark" style={{ background: accent }} />
          )}
          <div>
            <p className="run-sheet-studio">{studioName}</p>
            <p className="run-sheet-title">{spaceName}</p>
          </div>
        </div>
        <div className="run-sheet-meta">
          {roomName && <p>{roomName}</p>}
          <p>
            {runs.length} run{runs.length === 1 ? "" : "s"}
          </p>
          <p>{printedAt}</p>
        </div>
      </header>

      <table className="run-sheet-table">
        <thead>
          <tr>
            <th className="run-sheet-num">#</th>
            <th>From</th>
            <th>To</th>
            <th>Cable</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, index) => (
            <tr key={run._id}>
              <td className="run-sheet-num">{index + 1}</td>
              <td>
                <span className="run-sheet-device">{run.source}</span>
                <span className="run-sheet-port">
                  {run.sourcePort} · {connectorMeta(run.sourceConnector).short}
                </span>
              </td>
              <td>
                <span className="run-sheet-device">{run.destination}</span>
                <span className="run-sheet-port">
                  {run.destinationPort} · {connectorMeta(run.destinationConnector).short}
                </span>
              </td>
              <td>
                {run.isNormalled ? (
                  <span className="run-sheet-port">normalled at the bay</span>
                ) : run.unassigned ? (
                  /* An empty cell reads as "nothing to do here". A run with no
                     cable chosen is the opposite: it is the work. */
                  <span className="run-sheet-todo">— no cable assigned —</span>
                ) : (
                  <>
                    <span className="run-sheet-device">{run.cableName}</span>
                    <span className="run-sheet-port">
                      {[run.color, run.lengthFt ? `${run.lengthFt} ft` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </>
                )}
              </td>
              <td className="run-sheet-tag">{run.cableTag ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {runs.length === 0 && <p className="run-sheet-empty">Nothing patched in this room.</p>}

      <footer className="run-sheet-foot">
        <span>{studioName}</span>
        <span>{spaceName}</span>
      </footer>
    </div>
  );
}
