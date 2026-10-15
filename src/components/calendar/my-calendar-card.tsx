"use client";

import * as React from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Calendar, CheckCircle, Loading02 as Loader2, AlertTriangle } from "@untitledui/icons";
import { Button } from "@/components/ui/button";
import { CalendarSyncControls, sinceLabel, useGoogleReturn, type SyncDirection } from "./calendar-sync-controls";

/**
 * A team member's own Google calendar, on their schedule page. Their sessions
 * and shifts go to it, and their busy time (never titles) blocks only them.
 */
export function MyCalendarCard() {
  const status = useQuery(api.memberCalendar.status, {});
  const authUrl = useAction(api.memberCalendar.authUrl);
  const listCalendars = useAction(api.memberCalendar.listCalendars);
  const setCalendar = useMutation(api.memberCalendar.setCalendar);
  const setDirection = useMutation(api.memberCalendar.setDirection);
  const disconnect = useMutation(api.memberCalendar.disconnect);
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

  if (status && !status.hasMember) return null; // no staff profile: nothing to connect

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

  return (
    <div className="rounded-chrome border border-graphite/50 bg-coal/40 p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold/10 text-gold">
          <Calendar className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-grotesk text-sm font-semibold text-bone">My Google calendar</p>
          <p className="mt-0.5 text-sm text-steel">
            Your sessions and shifts appear on your own calendar. Your busy time shows to the team as “Busy”, with no
            titles, and keeps you from being booked over.
          </p>
        </div>
      </div>

      {returned && (
        <p role="status" className={`mt-4 flex items-start gap-1.5 text-sm ${returned.ok ? "text-positive" : "text-critical"}`}>
          {returned.ok ? <CheckCircle className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
          {returned.message}
        </p>
      )}

      <div className="mt-4 border-t border-graphite/50 pt-4">
        {status === undefined ? (
          <p className="text-xs text-steel/70">Checking…</p>
        ) : !status.configured ? (
          <p className="text-xs text-steel/70">Calendar sync isn’t enabled on this workspace yet.</p>
        ) : !status.connected ? (
          <div className="space-y-3">
            {status.needsReconnect && (
              <p className="flex items-start gap-1.5 text-sm text-critical">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Google stopped trusting this connection. Reconnect to resume syncing.
              </p>
            )}
            <Button size="sm" disabled={busy} onClick={connect}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              {status.needsReconnect ? "Reconnect Google" : "Connect my Google calendar"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="text-steel">Account: </span>
              <span className="text-bone">{status.email ?? "Connected"}</span>
              <span className="ml-4 text-steel">Last pull: </span>
              <span className="text-bone">{sinceLabel(status.syncedAt)}</span>
            </p>
            <CalendarSyncControls
              calendars={calendars}
              calendarId={status.calendarId ?? "primary"}
              calendarLabel="Main calendar"
              direction={status.direction as SyncDirection}
              onCalendar={(id, name) =>
                setCalendar({ calendarId: id }).then(() => toast.success(`Using ${name}.`)).catch(() => toast.error("Could not change the calendar."))
              }
              onDirection={(direction) => setDirection({ direction }).catch(() => toast.error("Could not change the direction."))}
            />
            {scopeReconnect && (
              <p className="flex items-start gap-1.5 text-xs text-caution">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                To choose a different calendar, reconnect Google once and allow the calendar list.
              </p>
            )}
            {status.error && (
              <p className="flex items-start gap-1.5 text-xs text-critical">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Last sync had an issue: {status.error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={connect}>Reconnect Google</Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => disconnect({}).then(() => toast.success("Disconnected.")).catch(() => toast.error("Could not disconnect."))}
              >
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
