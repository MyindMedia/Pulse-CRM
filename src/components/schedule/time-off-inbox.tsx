"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Plane, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function range(a: number, b: number) {
  const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${new Date(a).toLocaleDateString("en-US", o)} – ${new Date(b).toLocaleDateString("en-US", o)}`;
}

/** Manager inbox of pending time-off requests. Renders nothing for non-managers
 *  (the query returns [] unless you have schedule.manage). */
export function TimeOffInbox() {
  const pending = useQuery(api.availability.pendingTimeOff, {});
  const decide = useMutation(api.availability.decideTimeOff);

  if (!pending || pending.length === 0) return null;

  async function act(id: Id<"timeOff">, decision: "approved" | "denied") {
    try {
      await decide({ id, decision });
      toast.success(`Time off ${decision}.`);
    } catch {
      toast.error("Could not update the request.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Plane className="size-4 text-gold" />
          Time-off requests
          <span className="rounded-full bg-gold/15 px-1.5 text-[0.625rem] font-bold text-gold">{pending.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-1">
        {pending.map((r) => (
          <div key={r._id} className="flex items-center gap-3 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-bone">{r.memberName}</p>
              <p className="text-xs text-steel">
                {range(r.startTime, r.endTime)}
                {r.reason && <span className="text-steel/70"> · {r.reason}</span>}
              </p>
            </div>
            <Button size="icon-sm" variant="secondary" aria-label="Approve" onClick={() => act(r._id as Id<"timeOff">, "approved")}>
              <Check className="size-4 text-positive" />
            </Button>
            <Button size="icon-sm" variant="secondary" aria-label="Deny" onClick={() => act(r._id as Id<"timeOff">, "denied")}>
              <X className="size-4 text-critical" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
