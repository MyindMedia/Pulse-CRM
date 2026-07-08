"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CalendarCheck2, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function fmtWhen(start: number, end: number): string {
  const d = new Date(start);
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const t = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(start)} to ${t(end)}`;
}

/**
 * The signed-in engineer's pending booking requests. A client picked THEM at
 * booking time; accepting finalizes the booking (and creates the shift),
 * declining hands it back to the managers to restaff. Renders nothing when
 * there's nothing to answer.
 */
export function EngineerRequests() {
  const requests = useQuery(api.sessions.myEngineerRequests, {});
  const respond = useMutation(api.sessions.respondToEngineerRequest);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  if (!requests || requests.length === 0) return null;

  async function answer(sessionId: Id<"sessions">, accept: boolean) {
    setBusyId(sessionId);
    try {
      await respond({ sessionId, accept });
      toast.success(accept ? "Confirmed - the booking is locked in." : "Declined - the studio will restaff it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not respond.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="border-gold/40">
      <CardHeader className="flex-row items-center gap-2 pb-3">
        <CalendarCheck2 className="size-4 shrink-0 text-gold" />
        <CardTitle className="text-sm">
          You&apos;ve been requested
          <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 font-meta text-[0.6875rem] text-gold">
            {requests.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {requests.map((r) => (
          <div
            key={r._id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline-2/50 bg-coal-2/60 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-bone">
                {r.artistName} · {r.serviceType.replace(/_/g, " ")}
              </p>
              <p className="text-xs text-steel/80">
                {fmtWhen(r.startTime, r.endTime)}
                {r.roomName ? ` · ${r.roomName}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" disabled={busyId === r._id} onClick={() => answer(r._id, true)}>
                <Check className="size-3.5" />
                Confirm
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busyId === r._id}
                onClick={() => answer(r._id, false)}
              >
                <X className="size-3.5" />
                Decline
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
