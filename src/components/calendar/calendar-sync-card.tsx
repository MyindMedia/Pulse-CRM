"use client";

import * as React from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CalendarCheck01 as CalendarCheck, CheckCircle, Loading02 as Loader2, RefreshCw01 as RefreshCw, AlertTriangle } from "@untitledui/icons";
import { Button } from "@/components/ui/button";
import { CalendarSyncControls, sinceLabel, useGoogleReturn, type SyncDirection } from "./calendar-sync-controls";

/**
 * The studio's shared Google calendar. After connecting, the owner picks which
 * calendar is the studio's and which way events flow, and sees the account,
 * calendar, direction, last pull and any error. A lost grant shows
 * "Reconnect Google" instead of failing quietly.
 */
export function CalendarSyncCard() {
  const status = useQuery(api.googleCalendarSync.status, {});
  const syncNow = useAction(api.googleCalendarSync.syncNow);
  const authUrl = useAction(api.googleAuth.authUrl);
  const listCalendars = useAction(api.googleCalendarSettings.listCalendars);
  const setCalendar = useMutation(api.googleCalendarSettings.setCalendar);
  const setDirection = useMutation(api.googleCalendarSettings.setDirection);
  const returned = useGoogleReturn();
  const [busy, setBusy] = React.useState(false);
  const [calendars, setCalendars] = React.useState<{ id: string; name: string; primary: boolean }[] | null>(null);
  const [scopeReconnect, setScopeReconnect] = React.useState(false);

  const connected = status?.connected ?? false;
  React.useEffect(() => {
    if (!connected) return;
    listCalendars({})
      .then((r) => {
        setCalendars(r.calendars);
        setScopeReconnect(r.needsReconnect);
      })
      .catch(() => setCalendars(null));
  }, [connected, listCalendars]);

  async function connect() {
    setBusy(true);
    try {
      const { url } = await authUrl({});
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not start Google connect.");
      setBusy(false);
    }
  }

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

  const needsReconnect = Boolean(status?.needsReconnect) || scopeReconnect;

  return (
    <div className="rounded-chrome border border-graphite/50 bg-coal/40 p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
          <CalendarCheck className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-grotesk text-sm font-semibold text-bone">Studio Google calendar</p>
          <p className="mt-0.5 text-sm text-steel">
            Bookings, requests and room blocks appear on one shared Google calendar, and its other events show up here
            as busy time so you never double-book.
          </p>
        </div>
      </div>

      {returned && (
        <p
          role="status"
          className={`mt-4 flex items-start gap-1.5 text-sm ${returned.ok ? "text-positive" : "text-critical"}`}
        >
          {returned.ok ? <CheckCircle className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
          {returned.message}
        </p>
      )}

      <div className="mt-4 border-t border-graphite/50 pt-4">
        {status === undefined ? (
          <p className="text-xs text-steel/70">Checking…</p>
        ) : !status.configured ? (
          <p className="text-xs text-steel/70">
            Calendar sync isn’t enabled on this workspace yet - your admin needs to configure Google.
          </p>
        ) : !status.connected ? (
          <div className="space-y-3">
            {status.needsReconnect && (
              <p className="flex items-start gap-1.5 text-sm text-critical">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Google stopped trusting this connection (access was removed or expired). Reconnect to resume syncing.
              </p>
            )}
            <Button size="sm" disabled={busy} onClick={connect}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {status.needsReconnect ? "Reconnect Google" : "Connect Google"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-steel">Account: </dt><dd className="inline text-bone">{status.email ?? "Connected"}</dd></div>
              <div><dt className="inline text-steel">Calendar: </dt><dd className="inline text-bone">{status.calendarName}</dd></div>
              <div><dt className="inline text-steel">Last pull: </dt><dd className="inline text-bone">{sinceLabel(status.syncedAt)}</dd></div>
              <div><dt className="inline text-steel">Imported: </dt><dd className="inline text-bone">{status.blockCount} busy block{status.blockCount === 1 ? "" : "s"}</dd></div>
            </dl>

            <CalendarSyncControls
              calendars={calendars}
              calendarId={status.calendarId}
              calendarLabel={status.calendarName}
              direction={status.direction as SyncDirection}
              onCalendar={(id, name) =>
                setCalendar({ calendarId: id, calendarName: name })
                  .then(() => toast.success(`Using ${name}.`))
                  .catch(() => toast.error("Could not change the calendar."))
              }
              onDirection={(direction) =>
                setDirection({ direction }).catch(() => toast.error("Could not change the direction."))
              }
            />

            {needsReconnect && (
              <p className="flex items-start gap-1.5 text-xs text-caution">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                To choose a different calendar, reconnect Google once and allow the calendar list.
              </p>
            )}
            {status.pushError && (
              <p className="flex items-start gap-1.5 text-xs text-critical">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Pulse could not write to Google{status.pushErrorAt ? ` (${sinceLabel(status.pushErrorAt)})` : ""}: {status.pushError}
              </p>
            )}
            {status.error && (
              <p className="flex items-start gap-1.5 text-xs text-critical">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Last pull had an issue: {status.error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={handleSync}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Sync now
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={connect}>
                Reconnect Google
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
