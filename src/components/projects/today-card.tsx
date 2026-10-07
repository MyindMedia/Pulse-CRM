"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ListChecks } from "lucide-react";
import { Section } from "@/components/ui/page";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { ProjectCard } from "./project-card";

/** Dashboard card: the post-production work that is late or due soonest.
 *  Renders nothing for a person or studio that does not have projects. */
export function ProjectsTodayCard({ className }: { className?: string }) {
  const res = useQuery(api.projects.todayCards, {});
  if (res && !res.enabled) return null;
  return (
    <Section title="Projects">
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between border-b border-hairline-2/50 py-3">
        <CardDescription>
          {res ? `${res.activeCount} in progress${res.overdueCount ? `, ${res.overdueCount} late` : ""}` : "Post-production"}
        </CardDescription>
        <Link href="/projects" className="text-xs text-gold hover:underline">All projects</Link>
      </CardHeader>
      <CardContent className="p-3">
        {res === undefined ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
        ) : res.projects.length === 0 ? (
          <EmptyState icon={ListChecks} title="No projects in progress" description="Start one from the Projects page." className="border-0 bg-transparent py-8" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {res.projects.map((p) => <ProjectCard key={p._id} project={p} showStage />)}
          </div>
        )}
      </CardContent>
    </Card>
    </Section>
  );
}
