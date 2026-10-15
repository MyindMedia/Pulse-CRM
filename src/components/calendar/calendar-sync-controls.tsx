"use client";

import * as React from "react";
import { REASON_MESSAGES } from "@convex/lib/googleReasons";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export type SyncDirection = "two_way" | "push" | "pull" | "off";

export const DIRECTION_LABELS: Record<SyncDirection, string> = {
  two_way: "Two-way",
  push: "Pulse to Google only",
  pull: "Google to Pulse only",
  off: "Off",
};

export const DIRECTION_HELP: Record<SyncDirection, string> = {
  two_way: "Pulse bookings appear in Google, and Google events show up here as busy time.",
  push: "Pulse bookings appear in Google. Google events are ignored.",
  pull: "Google events show up here as busy time. Pulse writes nothing to Google.",
  off: "Nothing moves in either direction.",
};

/** Calendar + direction pickers shared by the studio card and the member card. */
export function CalendarSyncControls(props: {
  calendars: { id: string; name: string; primary: boolean }[] | null;
  calendarId: string;
  calendarLabel: string;
  direction: SyncDirection;
  onCalendar: (id: string, name: string) => void;
  onDirection: (d: SyncDirection) => void;
}) {
  const { calendars, calendarId, calendarLabel, direction, onCalendar, onDirection } = props;
  const options = calendars && calendars.length > 0 ? calendars : [{ id: calendarId, name: calendarLabel, primary: calendarId === "primary" }];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1">
        <span className="text-xs text-steel">Calendar</span>
        <Select
          value={options.some((c) => c.id === calendarId) ? calendarId : undefined}
          onValueChange={(id) => onCalendar(id, options.find((c) => c.id === id)?.name ?? id)}
        >
          <SelectTrigger aria-label="Google calendar"><SelectValue placeholder={calendarLabel} /></SelectTrigger>
          <SelectContent>
            {options.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}{c.primary ? " (main)" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="space-y-1">
        <span className="text-xs text-steel">Direction</span>
        <Select value={direction} onValueChange={(d) => onDirection(d as SyncDirection)}>
          <SelectTrigger aria-label="Sync direction"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(DIRECTION_LABELS) as SyncDirection[]).map((d) => (
              <SelectItem key={d} value={d}>{DIRECTION_LABELS[d]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="block text-xs text-steel/70">{DIRECTION_HELP[direction]}</span>
      </label>
    </div>
  );
}

export function sinceLabel(ms: number | null): string {
  if (!ms) return "not yet";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/** The `?google=` result the OAuth callback redirects back with, as a message. */
export function useGoogleReturn(): { ok: boolean; message: string } | null {
  const [state, setState] = React.useState<{ ok: boolean; message: string } | null>(null);
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const g = p.get("google");
    if (g === "connected") setState({ ok: true, message: "Google connected." });
    else if (g === "error") {
      const reason = (p.get("reason") ?? "server_error") as keyof typeof REASON_MESSAGES;
      setState({ ok: false, message: REASON_MESSAGES[reason] ?? REASON_MESSAGES.server_error });
    }
  }, []);
  return state;
}
