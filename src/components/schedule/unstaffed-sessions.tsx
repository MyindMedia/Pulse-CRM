"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { AlertTriangle, DoorOpen } from "lucide-react";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

function when(ts: number) {
  return new Date(ts).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Upcoming engineering sessions with no engineer assigned - assign one inline.
 *  Renders nothing when fully staffed. */
export function UnstaffedSessions() {
  const gaps = useQuery(api.shifts.unstaffedSessions, {});
  const engineers = useQuery(api.members.engineers) as { _id: string; name: string }[] | undefined;
  const assign = useMutation(api.sessions.assignEngineer);

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
          <div key={s._id} className="flex flex-wrap items-center gap-3 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-bone">{s.title}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-steel/70">
                <span>{when(s.startTime)}</span>
                <span className="uppercase tracking-wide">· {s.serviceType}</span>
                {s.roomName && <span className="inline-flex items-center gap-0.5"><DoorOpen className="size-3" />{s.roomName}</span>}
                <span>· {s.clientName}</span>
              </p>
            </div>
            <div className="w-44 shrink-0">
              <Select onValueChange={(v) => pick(s._id, v)}>
                <SelectTrigger><SelectValue placeholder="Assign engineer" /></SelectTrigger>
                <SelectContent>
                  {(engineers ?? []).map((e) => (
                    <SelectItem key={e._id} value={e._id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
