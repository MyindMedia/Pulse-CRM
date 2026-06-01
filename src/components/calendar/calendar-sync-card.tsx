"use client";

import * as React from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CalendarSync, CheckCircle2, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Inbound Google Calendar sync status. Once a studio connects Google (in the
 * client-email card), Pulse pulls their primary calendar's events in as busy
 * blocks every few minutes so the schedule reflects outside bookings. This card
 * shows that it's working and offers a manual "Sync now".
 */
function sinceLabel(ms: number | null): string {
  if (!ms) return "not yet";
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function CalendarSyncCard() {
  const status = useQuery(api.googleCalendarSync.status, {});
  const syncNow = useAction(api.googleCalendarSync.syncNow);
  const [busy, setBusy] = React.useState(false);

  async function handleSync() {
    setBusy(true);
    try {
      const res = await syncNow({});
      toast[res.ok ? "success" : "error"](res.ok ? "Calendar synced." : "Sync isn't available yet.");
    } catch {
      toast.error("Could not sync the calendar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-hairline bg-coal/40 p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
          <CalendarSync className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-bone">Two-way calendar sync</p>
          <p className="mt-0.5 text-sm text-ash">
            Pulse sessions appear on your Google calendar, and your Google bookings show up here as busy blocks so
            you never double-book.
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-hairline pt-4">
        {status === undefined ? (
          <p className="text-xs text-ash-dim">Checking…</p>
        ) : !status.configured ? (
          <p className="text-xs text-ash-dim">
            Calendar sync isn’t enabled on this workspace yet - your admin needs to configure Google.
          </p>
        ) : !status.connected ? (
          <p className="text-sm text-ash">
            Connect your Google account in <span className="text-bone">Client email</span> above to turn on two-way
            calendar sync.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5 text-bone">
                <CheckCircle2 className="size-4 text-gold" /> Active
              </span>
              <span className="text-ash">Last synced {sinceLabel(status.syncedAt)}</span>
              <span className="text-ash">
                {status.blockCount} block{status.blockCount === 1 ? "" : "s"} imported
              </span>
            </div>
            {status.error && (
              <p className="flex items-start gap-1.5 text-xs text-critical">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Last sync had an issue: {status.error}
              </p>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={handleSync}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Sync now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
