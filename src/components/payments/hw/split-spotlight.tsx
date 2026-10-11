"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCapabilities } from "@/lib/use-capabilities";
import { Chassis, ChassisTitle, EmptyWell, Groove } from "@/components/dashboard/hw/parts";

const STATUS: Record<string, string> = {
  sent: "Out for signature",
  draft: "Draft",
  fully_executed: "Fully signed",
};

/* Split sheet (kit "Invoices and splits"): the sheet that needs attention,
 * each contributor's share on a groove and whether they have signed. The
 * signing tools live on the song, so the key opens it. */
export function SplitSpotlight() {
  const { can, loaded } = useCapabilities();
  const allowed = loaded && can("splitsheet.read");
  const s = useQuery(api.splitSheets.spotlight, allowed ? {} : "skip");

  if (loaded && !allowed) return null;
  return (
    <Chassis>
      {s === undefined ? (
        <>
          <ChassisTitle kicker={<Badge tone="solid">Split sheet</Badge>} title="Loading" bar={false} />
          <div className="mt-3 flex-1" aria-busy />
        </>
      ) : s === null ? (
        <>
          <ChassisTitle kicker={<Badge tone="solid">Split sheet</Badge>} title="No split sheets yet" bar={false} />
          <div className="mt-3 flex flex-1">
            <EmptyWell
              action={
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/songs">Open songs</Link>
                </Button>
              }
            >
              Split sheets are made on each song.
            </EmptyWell>
          </div>
        </>
      ) : (
        <>
          <ChassisTitle
            kicker={<Badge tone="solid">Split sheet</Badge>}
            title={s.songTitle}
            bar={false}
            right={
              <Badge tone={s.signed === s.total ? "positive" : "gold"} className="gap-1.5">
                <span className="pl-led" data-on="true" aria-hidden />
                {s.signed} of {s.total} signed
              </Badge>
            }
          />
          <div className="mt-3 flex items-center gap-3">
            <div className="pl-screen relative size-14 shrink-0 overflow-hidden" aria-hidden>
              {[44, 30, 18].map((d, i) => (
                <span key={d} className="pl-lens-ring" style={{ width: d, height: d, borderWidth: i === 1 ? 2 : 1, borderColor: "var(--pl-copper)", opacity: i === 1 ? 0.9 : 0.5 }} />
              ))}
            </div>
            <div className="min-w-0">
              <p className="truncate font-sans text-sm font-bold leading-5 text-bone">
                {s.artistName ? `${s.artistName}, ${s.songTitle}` : s.songTitle}
              </p>
              <p className="font-sans text-[11px] leading-4 text-steel">{STATUS[s.status] ?? s.status}</p>
            </div>
          </div>
          <ul className="pl-well mt-3 flex-1 space-y-3 px-3 py-3">
            {s.contributors.map((c, i) => (
              <li key={`${c.name}-${i}`}>
                <div className="mb-1.5 flex items-center justify-between gap-2 font-sans text-[13px] leading-[18px]">
                  <span className="min-w-0 truncate">
                    <span className="font-bold text-bone">{c.name}</span> <span className="text-steel">{c.role}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-bone" title={`Master ${c.masterPct}% · publishing ${c.publishingPct}%`}>
                      {c.masterPct}%
                    </span>
                    <Badge tone={c.signed ? "positive" : "gold"}>{c.signed ? "Signed" : "Awaiting"}</Badge>
                  </span>
                </div>
                <Groove value={c.masterPct / 100} tone={c.signed ? "yellow" : "metal"} />
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
            <Button size="sm" asChild>
              <Link href={`/songs/${s.songId}`}>Open split sheet</Link>
            </Button>
          </div>
        </>
      )}
    </Chassis>
  );
}
