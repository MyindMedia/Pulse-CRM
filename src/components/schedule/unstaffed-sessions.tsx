"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { AlertTriangle, DoorOpen } from "lucide-react";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useCapabilities } from "@/lib/use-capabilities";
import {
  SuggestEngineerButton,
  SuggestedBadge,
  SuggestedEngineers,
  suggestionFor,
  useEngineerFitEnabled,
  useEngineerSuggestions,
} from "./engineer-suggestions";

type Gap = FunctionReturnType<typeof api.shifts.unstaffedSessions>[number];
type Engineer = { _id: string; name: string };

function when(ts: number) {
  return new Date(ts).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Upcoming engineering sessions with no engineer assigned - assign one inline.
 *  Renders nothing when fully staffed. */
export function UnstaffedSessions() {
  const gaps = useQuery(api.shifts.unstaffedSessions, {});
  const engineers = useQuery(api.members.engineers) as Engineer[] | undefined;
  const assign = useMutation(api.sessions.assignEngineer);
  // Jev suggestions are offered only to staff schedulers on a deployment with Jev.
  const canSuggest = useEngineerFitEnabled(Boolean(gaps?.length));
  // Assigning needs sessions.edit (the server re-checks). Shown while loading so
  // the control does not flash away for the people who have it.
  const { can, loaded } = useCapabilities();
  const canAssign = !loaded || can("sessions.edit");

  if (!gaps || gaps.length === 0) return null;

  async function pick(sessionId: string, engineerId: string) {
    try {
      const res = await assign({ sessionId: sessionId as Id<"sessions">, engineerId: engineerId as Id<"members"> });
      toast.success("Engineer assigned.");
      if (res.staffingWarning) toast.warning(res.staffingWarning);
    } catch {
      toast.error("Could not assign the engineer.");
    }
  }

  return (
    <div className="rounded-chrome border border-caution/40 bg-caution/[0.06] p-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-caution">
        <AlertTriangle className="size-4" />
        Needs an engineer ({gaps.length})
      </p>
      <div className="space-y-2">
        {gaps.map((s) => (
          <GapRow key={s._id} gap={s} engineers={engineers} canSuggest={canSuggest} canAssign={canAssign} onPick={pick} />
        ))}
      </div>
    </div>
  );
}

/** One unstaffed session. "Suggest engineer" asks Jev who fits it; the
 *  suggested names get a chip, and the owner still picks from the list. */
function GapRow({
  gap: s,
  engineers,
  canSuggest,
  canAssign,
  onPick,
}: {
  gap: Gap;
  engineers: Engineer[] | undefined;
  canSuggest: boolean;
  canAssign: boolean;
  onPick: (sessionId: string, engineerId: string) => void;
}) {
  const fit = useEngineerSuggestions();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-bone">{s.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-steel/70">
          <span>{when(s.startTime)}</span>
          <span className="uppercase tracking-wide">· {s.serviceType}</span>
          {s.roomName && <span className="inline-flex items-center gap-0.5"><DoorOpen className="size-3" />{s.roomName}</span>}
          <span>· {s.clientName}</span>
        </p>
        {fit.result && (
          <div className="mt-1.5">
            <SuggestedEngineers result={fit.result} />
          </div>
        )}
      </div>
      {canSuggest && !fit.result && (
        <SuggestEngineerButton loading={fit.loading} onClick={() => void fit.ask({ sessionId: s._id })} />
      )}
      {canAssign && (
        <div className="w-44 shrink-0">
          <Select onValueChange={(v) => onPick(s._id, v)}>
            <SelectTrigger><SelectValue placeholder="Assign engineer" /></SelectTrigger>
            <SelectContent>
              {(engineers ?? []).map((e) => {
                const suggestion = suggestionFor(fit.result, e._id);
                return (
                  <SelectItem
                    key={e._id}
                    value={e._id}
                    trailing={suggestion ? <SuggestedBadge pick={suggestion} /> : undefined}
                  >
                    {e.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
