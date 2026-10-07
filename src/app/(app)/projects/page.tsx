"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ListChecks } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader, Section } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Badge } from "@/components/ui/badge";
import { useCapabilities } from "@/lib/use-capabilities";
import { ProjectCard } from "@/components/projects/project-card";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { STAGE_LABEL } from "@/components/projects/constants";

/** Catches a refused query (no studio picked, feature not available here)
 *  so the page shows a plain message instead of the error screen. */
class Guard extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Board() {
  const router = useRouter();
  const board = useQuery(api.projects.board, {});
  if (board === undefined) {
    return <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-48" />)}</div>;
  }
  if (board.projects.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No projects yet"
        description="Track a record from tracking through mixing, mastering and delivery."
        action={<NewProjectDialog onCreated={(id) => router.push(`/projects/${id}`)} />}
      />
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {board.stages.map((stage) => {
        const items = board.projects.filter((p) => p.stage === stage);
        return (
          <section key={stage} className="min-w-0 space-y-2" aria-label={STAGE_LABEL[stage]}>
            <div className="flex items-center justify-between px-1">
              <h2 className="overline">{STAGE_LABEL[stage]}</h2>
              <Badge>{items.length}</Badge>
            </div>
            <div className="space-y-2 rounded-lg border border-graphite/40 bg-coal/30 p-2 min-h-24">
              {items.map((p) => <ProjectCard key={p._id} project={p} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AllStudios() {
  const res = useQuery(api.projects.crossStudio, {});
  if (!res || res.studios.length === 0) return null;
  return (
    <Section title="All studios">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {res.studios.map((s) => (
          <div key={s.orgId} className="space-y-2 rounded-lg border border-graphite/60 bg-coal/40 p-3">
            <div className="flex items-center justify-between">
              <p className="font-grotesk text-sm font-semibold text-bone">{s.name}</p>
              <span className="text-xs text-steel">
                {s.activeCount} active{s.overdueCount ? `, ${s.overdueCount} late` : ""}
              </span>
            </div>
            <ul className="space-y-1 text-xs text-steel">
              {s.projects.slice(0, 5).map((p) => (
                <li key={p._id} className="flex justify-between gap-2">
                  <span className={p.overdue ? "truncate text-critical" : "truncate"}>{p.name}</span>
                  <span className="shrink-0">{STAGE_LABEL[p.stage]}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const { can, kind } = useCapabilities();
  return (
    <div className="space-y-6">
      <PageHeader
        overline="Post-production"
        title="Projects"
        description="Every record after the room: stage, tasks, owners and due dates."
        actions={can("projects.edit") ? <NewProjectDialog onCreated={(id) => router.push(`/projects/${id}`)} /> : undefined}
      />
      <Guard fallback={<EmptyState icon={ListChecks} title="Pick a studio" description="Projects belong to one studio. Choose one to see its board." />}>
        <Board />
      </Guard>
      {kind === "agency_member" && (
        <Guard fallback={null}>
          <AllStudios />
        </Guard>
      )}
    </div>
  );
}
