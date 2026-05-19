"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Bell, Sparkles, AlertTriangle, TrendingUp, FileText, Check } from "lucide-react";
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

export function InsightsBell() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const counts = useQuery(api.insights.counts);
  const insights = useQuery(api.insights.open, { limit: 10 });
  const markAllSeen = useMutation(api.insights.markAllSeen);
  const setStatus = useMutation(api.insights.setStatus);

  const newCount = counts?.new ?? 0;

  React.useEffect(() => {
    if (open && newCount > 0) void markAllSeen();
  }, [open, newCount, markAllSeen]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative grid size-9 place-items-center rounded-md text-ash transition-colors hover:bg-coal-2 hover:text-bone"
          aria-label="Insights"
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
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Sparkles className="size-4 text-gold" />
          <p className="font-display text-sm font-semibold text-bone">Pulse insights</p>
          {insights && insights.length > 0 && (
            <span className="ml-auto font-mono text-[0.625rem] uppercase text-ash-dim">
              {insights.length} open
            </span>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {insights === undefined ? (
            <div className="space-y-2 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-16 rounded-md" />
              ))}
            </div>
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
                      <p className="mt-0.5 text-xs leading-relaxed text-ash">{it.body}</p>
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
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
