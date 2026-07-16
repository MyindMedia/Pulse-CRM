"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/feedback";
import { longDate, timeOfDay, duration } from "@/lib/format";
import { meta, SESSION_STATUS, titleCase } from "@/lib/labels";
import { startOfDay, statusColor, type Session } from "./constants";

/** Upcoming sessions grouped by day - the agenda alternative to the grid. */
export function AgendaList({
  sessions,
  onOpenSession,
}: {
  sessions: Session[];
  onOpenSession: (id: string) => void;
}) {
  // Member roster (with photos) so engineer attributions can show their photo.
  const engineers = useQuery(api.members.engineers, {});
  const engineerPhotoOf = (id?: string) =>
    id ? (engineers?.find((e) => e._id === id)?.photoUrl ?? null) : null;

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
          <div className="overflow-hidden rounded-lg border border-graphite/50 bg-coal">
            <ul className="divide-y divide-hairline">
              {list.map((s) => {
                const st = meta(SESSION_STATUS, s.status);
                return (
                  <li key={s._id}>
                    <button
                      type="button"
                      onClick={() => onOpenSession(s._id)}
                      className="flex w-full items-stretch gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30"
                    >
                      <span
                        aria-hidden
                        className="w-1 shrink-0 self-stretch rounded-full"
                        style={{ backgroundColor: statusColor(s.status) }}
                      />
                      <div className="w-16 shrink-0 pt-0.5">
                        <p className="font-meta text-xs font-medium text-bone">
                          {timeOfDay(s.startTime)}
                        </p>
                        <p className="font-meta text-[0.625rem] text-steel/70">
                          {duration(s.startTime, s.endTime)}
                        </p>
                      </div>
                      {/* Text block wraps instead of amputating - titles get up
                          to two lines, the meta line breaks naturally. */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-bone [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                            {s.title}
                          </p>
                          <Badge tone={st.tone} className="shrink-0">
                            {st.label}
                          </Badge>
                        </div>
                        <p className="text-xs leading-relaxed text-steel/70">
                          {titleCase(s.serviceType)}
                          {s.roomName ? ` · ${s.roomName}` : ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-steel/70">
                          <span className="inline-flex items-center gap-1.5">
                            <Avatar name={s.artistName} size="xs" />
                            <span>{s.artistName}</span>
                          </span>
                          {s.engineerName && (
                            <span className="inline-flex items-center gap-1.5">
                              <Avatar
                                name={s.engineerName}
                                src={engineerPhotoOf(s.engineerId)}
                                size="xs"
                                className="rounded-full"
                              />
                              <span>{s.engineerName}</span>
                            </span>
                          )}
                        </div>
                      </div>
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
