"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Bot, Lightbulb, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { titleCase } from "@/lib/labels";
import { relativeTime, shortDate } from "@/lib/format";

const INSIGHT_TONE: Record<string, "info" | "caution" | "critical"> = {
  info: "info",
  opportunity: "info",
  warning: "caution",
};

export function AiActivityTab({ songId }: { songId: Id<"songs"> }) {
  const data = useQuery(api.songs.aiActivity, { songId });

  if (data === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const { artifacts, insights } = data;

  if (artifacts.length === 0 && insights.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No AI activity yet"
        description="Session recaps, prep packets, reminders and AI insights for this track will gather here as they're generated."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* AI artifacts */}
      <Card material="regular">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-ash-dim" />
            AI artifacts
            {artifacts.length > 0 && (
              <span className="font-mono text-[0.625rem] text-ash-dim">{artifacts.length}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {artifacts.length === 0 ? (
            <p className="py-4 text-center text-sm text-ash-dim">
              No drafts generated for this track yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {artifacts.map((a) => (
                <li
                  key={a._id}
                  className="rounded-md border border-hairline bg-coal-2 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-bone">
                      {a.title}
                    </p>
                    <Badge tone={a.source === "openai" ? "gold" : "neutral"}>
                      {a.source === "openai" ? "OpenAI" : "Fallback"}
                    </Badge>
                  </div>
                  {a.summary && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ash">
                      {a.summary}
                    </p>
                  )}
                  <p className="mt-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                    {titleCase(a.kind)} · {a.scope === "org" ? "Workspace" : "Session"} ·{" "}
                    {relativeTime(a.generatedAt)} · {shortDate(a.generatedAt)}
                    {a.model ? ` · ${a.model}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* AI insights */}
      <Card material="regular">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="size-4 text-ash-dim" />
            Insights
            {insights.length > 0 && (
              <span className="font-mono text-[0.625rem] text-ash-dim">{insights.length}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="py-4 text-center text-sm text-ash-dim">
              No insights pinned to this track.
            </p>
          ) : (
            <ul className="space-y-2">
              {insights.map((i) => (
                <li
                  key={i._id}
                  className="rounded-md border border-hairline bg-coal-2 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-bone">
                      {i.title}
                    </p>
                    <Badge tone={INSIGHT_TONE[i.severity] ?? "info"}>{titleCase(i.kind)}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ash">{i.body}</p>
                  <p className="mt-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                    {relativeTime(i.createdAt)} · {shortDate(i.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
