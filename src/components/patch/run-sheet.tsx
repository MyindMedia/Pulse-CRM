"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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

      {/*
        Portalled to <body>, and that is load-bearing rather than tidy.
        The print rule hides `body > *` so only the sheet prints, and an
        element cannot escape a hidden ancestor however hard it declares
        itself visible. Rendered in place, the sheet printed blank.
      */}
      <RunSheetPortal>
        <RunSheet
          runs={runs ?? []}
          spaceName={spaceName}
          roomName={roomName}
          studioName={org?.name ?? "Studio"}
          logoUrl={org?.logoUrl ?? null}
          accent={org?.accentColor ?? "#fdb913"}
        />
      </RunSheetPortal>
    </>
  );
}

/** Mounts its children as a direct child of <body>, after hydration. */
function RunSheetPortal({ children }: { children: React.ReactNode }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    const el = document.createElement("div");
    el.className = "run-sheet-host";
    document.body.appendChild(el);
    setHost(el);
    return () => {
      document.body.removeChild(el);
    };
  }, []);
  return host ? createPortal(children, host) : null;
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
  isTieLine: boolean;
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
  /* An index of which rows touch each box. The table answers "what is run 7";
     this answers "what is plugged into the Neve", which is the question you
     have when you are standing in front of it. */
  const byDevice = React.useMemo(() => {
    const map = new Map<string, number[]>();
    runs.forEach((run, index) => {
      for (const device of [run.source, run.destination]) {
        const list = map.get(device) ?? [];
        list.push(index + 1);
        map.set(device, list);
      }
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [runs]);

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

      <p className="run-sheet-lede">
        Every cable currently patched in this room, and what it joins. Read a row
        left to right: the signal leaves the first device at the port named under
        it, travels down the cable in the middle, and arrives at the second
        device at the port named under that.
      </p>

      <table className="run-sheet-table">
        <thead>
          <tr>
            <th className="run-sheet-num">#</th>
            <th>Signal leaves</th>
            <th className="run-sheet-arrow-col" />
            <th>and arrives at</th>
            <th>Down this cable</th>
            <th>Marked</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, index) => (
            <tr key={run._id}>
              <td className="run-sheet-num">{index + 1}</td>
              <td>
                <span className="run-sheet-device">{run.source}</span>
                <span className="run-sheet-port">
                  from its {run.sourcePort} socket ({connectorMeta(run.sourceConnector).label})
                </span>
              </td>
              {/* An arrow does the explaining that a column heading cannot.
                  Someone who has never opened the patch screen still knows
                  which way the sound is going. */}
              <td className="run-sheet-arrow">&rarr;</td>
              <td>
                <span className="run-sheet-device">{run.destination}</span>
                <span className="run-sheet-port">
                  into its {run.destinationPort} socket (
                  {connectorMeta(run.destinationConnector).label})
                </span>
              </td>
              <td>
                {run.isNormalled ? (
                  <span className="run-sheet-port">normalled at the bay</span>
                ) : run.isTieLine ? (
                  /* Nobody plugs in a tie line. It is in the wall, and a run
                     sheet that tells an engineer to patch the building is
                     one they will stop trusting. */
                  <span className="run-sheet-port">tie line, already in the wall</span>
                ) : run.unassigned ? (
                  /* An empty cell reads as "nothing to do here". A run with no
                     cable chosen is the opposite: it is the work. */
                  <span className="run-sheet-todo">— no cable assigned —</span>
                ) : (
                  <>
                    <span className="run-sheet-device">{run.cableName}</span>
                    <span className="run-sheet-port">
                      {[
                        run.color ? `${run.color} jacket` : null,
                        run.lengthFt ? `${run.lengthFt} ft long` : null,
                      ]
                        .filter(Boolean)
                        .join(", ")}
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

      {byDevice.length > 0 && (
        <section className="run-sheet-index">
          <h2 className="run-sheet-index-title" style={{ color: accent }}>
            By device
          </h2>
          <p className="run-sheet-port">
            Which rows above touch each box, for when you are standing at one of them.
          </p>
          <ul className="run-sheet-index-list">
            {byDevice.map(([device, numbers]) => (
              <li key={device}>
                <span className="run-sheet-device">{device}</span>
                <span className="run-sheet-port">
                  run{numbers.length === 1 ? "" : "s"} {numbers.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="run-sheet-foot">
        <span>{studioName}</span>
        <span>{spaceName}</span>
      </footer>
    </div>
  );
}
