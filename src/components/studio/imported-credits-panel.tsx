"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { errorMessage } from "@/lib/errors";

const SOURCE_LABEL: Record<string, string> = {
  genius: "Genius",
  musicbrainz: "MusicBrainz",
  deezer: "Deezer",
  apple: "Apple Music",
};

/** Credit Approval: a Member's imported credits, and (for an owner or
 *  manager) the switch that puts them on the booking page. */
export function ImportedCreditsPanel({ memberId }: { memberId: Id<"members"> }) {
  const data = useQuery(api.importedCredits.forMember, { memberId });
  const approve = useMutation(api.importedCredits.approve);
  const [busy, setBusy] = React.useState(false);

  if (!data || data.credits.length === 0) return null;

  // One row per song; a song's roles approve together.
  const songs = new Map<string, { title: string; artistName: string; roles: string[]; source: string; ids: Id<"importedCredits">[]; approved: boolean }>();
  for (const c of data.credits) {
    const s = songs.get(c.songId);
    if (s) {
      s.roles.push(c.role);
      s.ids.push(c._id);
      s.approved &&= c.approved;
    } else {
      songs.set(c.songId, { title: c.title, artistName: c.artistName, roles: [c.role], source: c.source, ids: [c._id], approved: c.approved });
    }
  }
  const rows = [...songs.values()];
  const approvedCount = rows.filter((r) => r.approved).length;

  async function set(ids: Id<"importedCredits">[], approved: boolean) {
    setBusy(true);
    try {
      await approve({ memberId, creditIds: ids, approved });
    } catch (err) {
      toast.error(errorMessage(err, "Could not update credits."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-bone">Imported credits</p>
          <p className="text-[0.6875rem] text-steel/70">
            {approvedCount} of {rows.length} songs shown to clients. Only approved credits leave the studio.
          </p>
        </div>
        {data.canApprove && approvedCount < rows.length && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void set(rows.filter((r) => !r.approved).flatMap((r) => r.ids).slice(0, 500), true)}
          >
            Approve all
          </Button>
        )}
      </div>
      <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {rows.map((r) => (
          <li key={r.ids[0]} className="flex items-center gap-2 rounded-md border border-graphite/50 bg-coal px-2.5 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-bone">
                {r.artistName ? `${r.artistName} - ` : ""}
                {r.title}
              </span>
              <span className="block truncate text-[0.6875rem] text-steel/70">
                {r.roles.join(", ")} · via {SOURCE_LABEL[r.source] ?? r.source}
              </span>
            </span>
            {data.canApprove ? (
              <Button
                type="button"
                size="sm"
                variant={r.approved ? "secondary" : "ghost"}
                disabled={busy}
                aria-pressed={r.approved}
                onClick={() => void set(r.ids, !r.approved)}
              >
                {r.approved ? "Shown" : "Approve"}
              </Button>
            ) : (
              <Badge tone={r.approved ? "positive" : "neutral"}>{r.approved ? "Shown" : "Pending"}</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
