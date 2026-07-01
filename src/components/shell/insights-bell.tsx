"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Bell,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  FileText,
  Check,
  Activity as ActivityIcon,
  CalendarPlus,
  CircleDollarSign,
  CircleCheck,
  CircleX,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

const SEVERITY = {
  warning: { icon: AlertTriangle, tone: "text-critical", ring: "bg-critical/10" },
  opportunity: { icon: TrendingUp, tone: "text-gold", ring: "bg-gold/10" },
  info: { icon: FileText, tone: "text-info", ring: "bg-info/10" },
} as const;

const KIND_ROUTE: Record<string, string> = {
  artist: "/roster",
  song: "/songs",
  session: "/calendar",
  invoice: "/payments",
  opportunity: "/pipeline",
};

// Map an activity row to an icon + tone. Falls back to the row's `accent`.
const ACCENT_STYLE: Record<string, { tone: string; ring: string }> = {
  gold: { tone: "text-gold", ring: "bg-gold/10" },
  positive: { tone: "text-positive", ring: "bg-positive/10" },
  critical: { tone: "text-critical", ring: "bg-critical/10" },
  info: { tone: "text-info", ring: "bg-info/10" },
};

function activityIcon(kind: string) {
  if (kind.startsWith("booking") || kind.startsWith("session")) return CalendarPlus;
  if (kind === "invoice.paid" || kind === "payment.received") return CircleDollarSign;
  if (kind === "session.completed") return CircleCheck;
  if (kind.endsWith(".cancelled") || kind.endsWith(".forfeited")) return CircleX;
  return ActivityIcon;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

type View = "insights" | "activity";

export function InsightsBell() {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<View>("insights");
  const router = useRouter();
  const counts = useQuery(api.insights.counts);
  const insights = useQuery(api.insights.open, { limit: 10 });
  const activity = useQuery(api.notifications.activityFeed, { limit: 20 });
  const markAllSeen = useMutation(api.insights.markAllSeen);
  const setStatus = useMutation(api.insights.setStatus);

  const newCount = counts?.new ?? 0;

  React.useEffect(() => {
    if (open && view === "insights" && newCount > 0) void markAllSeen();
  }, [open, view, newCount, markAllSeen]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative grid size-9 place-items-center rounded-md text-steel transition-colors hover:bg-coal-2 hover:text-bone"
          aria-label="Notifications"
        >
          <Bell className="size-[1.1rem]" />
          {newCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-gold px-1 text-[0.625rem] font-bold text-gold-ink">
              {newCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center gap-1 border-b border-graphite/50 px-2 py-2">
          <TabButton active={view === "insights"} onClick={() => setView("insights")}>
            <Sparkles className="size-3.5" />
            Insights
            {insights && insights.length > 0 && (
              <span className="ml-1 font-meta text-[0.625rem] text-steel/70">{insights.length}</span>
            )}
          </TabButton>
          <TabButton active={view === "activity"} onClick={() => setView("activity")}>
            <ActivityIcon className="size-3.5" />
            Activity
          </TabButton>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {view === "insights" ? (
            insights === undefined ? (
              <Skeletons />
            ) : insights.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="All clear"
                description="No open insights. Pulse will surface nudges here as they come up."
                className="border-0 bg-transparent py-8"
              />
            ) : (
              insights.map((it) => {
                const sev = SEVERITY[it.severity];
                const Icon = sev.icon;
                return (
                  <div
                    key={it._id}
                    className="group rounded-md p-2.5 transition-colors hover:bg-coal-2"
                  >
                    <div className="flex gap-2.5">
                      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", sev.ring)}>
                        <Icon className={cn("size-3.5", sev.tone)} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-bone">{it.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-steel">{it.body}</p>
                        <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                          {it.entityType && it.entityId && KIND_ROUTE[it.entityType] && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void setStatus({ id: it._id, status: "actioned" });
                                setOpen(false);
                                router.push(`${KIND_ROUTE[it.entityType!]}/${it.entityId}`);
                              }}
                            >
                              Open
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void setStatus({ id: it._id, status: "dismissed" })}
                          >
                            <Check className="size-3.5" /> Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : activity === undefined ? (
            <Skeletons />
          ) : activity.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="Nothing yet"
              description="New bookings, payments, and completions will land here."
              className="border-0 bg-transparent py-8"
            />
          ) : (
            activity.map((row) => {
              const style = ACCENT_STYLE[row.accent ?? "info"] ?? ACCENT_STYLE.info;
              const Icon = activityIcon(row.kind);
              const route = row.entityType ? KIND_ROUTE[row.entityType] : undefined;
              return (
                <button
                  key={row._id}
                  type="button"
                  disabled={!(route && row.entityId)}
                  onClick={() => {
                    if (route && row.entityId) {
                      setOpen(false);
                      router.push(`${route}/${row.entityId}`);
                    }
                  }}
                  className="group flex w-full gap-2.5 rounded-md p-2.5 text-left transition-colors hover:bg-coal-2 disabled:cursor-default"
                >
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", style.ring)}>
                    <Icon className={cn("size-3.5", style.tone)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-bone">{row.summary}</p>
                    <p className="mt-0.5 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                      {row.actorName ? `${row.actorName} · ` : ""}
                      {timeAgo(row._creationTime)}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-grotesk text-xs font-semibold transition-colors",
        active ? "bg-coal-2 text-bone" : "text-steel hover:text-bone",
      )}
    >
      {children}
    </button>
  );
}

function Skeletons() {
  return (
    <div className="space-y-2 p-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-16 rounded-md" />
      ))}
    </div>
  );
}
