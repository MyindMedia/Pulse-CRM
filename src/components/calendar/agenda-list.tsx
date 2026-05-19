"use client";

import { CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/feedback";
import { longDate, timeOfDay, duration } from "@/lib/format";
import { meta, SESSION_STATUS, titleCase } from "@/lib/labels";
import { startOfDay, statusColor, type Session } from "./constants";

/** Upcoming sessions grouped by day — the agenda alternative to the grid. */
export function AgendaList({
  sessions,
  onOpenSession,
}: {
  sessions: Session[];
  onOpenSession: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nothing scheduled"
        description="Sessions in this window will appear here grouped by day."
      />
    );
  }

  // Group by day, days ascending, sessions within a day by start time.
  const groups = new Map<number, Session[]>();
  for (const s of [...sessions].sort((a, b) => a.startTime - b.startTime)) {
    const key = startOfDay(s.startTime);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([day, list]) => (
        <section key={day} className="space-y-2">
          <h3 className="overline">{longDate(day)}</h3>
          <div className="overflow-hidden rounded-lg border border-hairline bg-coal">
            <ul className="divide-y divide-hairline">
              {list.map((s) => {
                const st = meta(SESSION_STATUS, s.status);
                return (
                  <li key={s._id}>
                    <button
                      type="button"
                      onClick={() => onOpenSession(s._id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30"
                    >
                      <span
                        aria-hidden
                        className="h-9 w-1 shrink-0 rounded-full"
                        style={{ backgroundColor: statusColor(s.status) }}
                      />
                      <div className="w-20 shrink-0">
                        <p className="font-mono text-xs font-medium text-bone">
                          {timeOfDay(s.startTime)}
                        </p>
                        <p className="font-mono text-[0.625rem] text-ash-dim">
                          {duration(s.startTime, s.endTime)}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-bone">{s.title}</p>
                        <p className="truncate text-xs text-ash-dim">
                          {titleCase(s.serviceType)}
                          {s.roomName ? ` · ${s.roomName}` : ""}
                          {s.engineerName ? ` · ${s.engineerName}` : ""}
                        </p>
                      </div>
                      <Avatar name={s.artistName} size="sm" />
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
