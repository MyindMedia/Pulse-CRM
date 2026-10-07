"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Archive, ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Section } from "@/components/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCapabilities } from "@/lib/use-capabilities";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  LINK_KIND_LABEL, PICKABLE_KINDS, STAGE_LABEL, fromDateInput, toDateInput,
} from "@/components/projects/constants";

const NONE = "none";
const STAGES = ["tracking", "editing", "mixing", "mastering", "delivery", "complete"] as const;

function fail(err: unknown) {
  toast.error(err instanceof Error ? err.message : "That did not save");
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useCapabilities();
  const editable = can("projects.edit");
  const projectId = id as Id<"projects">;
  const [now] = React.useState(() => Date.now());

  const project = useQuery(api.projects.get, { id: projectId });
  const candidates = useQuery(api.projects.linkCandidates);
  const members = candidates?.engineer ?? [];

  const update = useMutation(api.projects.update);
  const setStage = useMutation(api.projects.setStage);
  const archive = useMutation(api.projects.archive);
  const remove = useMutation(api.projects.remove);
  const addTask = useMutation(api.projects.addTask);
  const setTaskDone = useMutation(api.projects.setTaskDone);
  const updateTask = useMutation(api.projects.updateTask);
  const removeTask = useMutation(api.projects.removeTask);
  const addLink = useMutation(api.projects.addLink);
  const removeLink = useMutation(api.projects.removeLink);

  const [taskTitle, setTaskTitle] = React.useState("");
  const [taskDue, setTaskDue] = React.useState("");
  const [linkKind, setLinkKind] = React.useState<(typeof PICKABLE_KINDS)[number]>("song");
  const [linkRef, setLinkRef] = React.useState("");
  const [notes, setNotes] = React.useState<string | null>(null);

  if (project === undefined) return <Skeleton className="h-96 w-full" />;
  if (project === null) {
    return (
      <EmptyState
        title="Project not found"
        action={<Button variant="secondary" onClick={() => router.push("/projects")}>Back to projects</Button>}
      />
    );
  }
  const options = (candidates?.[linkKind] ?? []) as { id: string; label: string }[];

  return (
    <div className="space-y-6">
      <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-steel hover:text-bone">
        <ArrowLeft className="size-3.5" /> Projects
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="chrome-display text-[1.75rem] leading-none text-bone">{project.name}</h1>
          <div className="flex items-center gap-2 text-xs text-steel">
            <Badge tone="gold">{STAGE_LABEL[project.stage]}</Badge>
            {project.dueDate && (
              <span className={cn(project.stage !== "complete" && project.dueDate < now && "text-critical")}>
                Due {shortDate(project.dueDate)}
              </span>
            )}
          </div>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={async () => {
              try { await archive({ id: projectId }); router.push("/projects"); } catch (e) { fail(e); }
            }}><Archive /> Archive</Button>
            <Button variant="danger" size="sm" onClick={async () => {
              if (!window.confirm("Delete this project and its tasks?")) return;
              try { await remove({ id: projectId }); router.push("/projects"); } catch (e) { fail(e); }
            }}><Trash2 /> Delete</Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Stage</Label>
          <Select value={project.stage} disabled={!editable}
            onValueChange={async (stage) => {
              try { await setStage({ id: projectId, stage: stage as (typeof STAGES)[number] }); } catch (e) { fail(e); }
            }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Owner</Label>
          <Select value={project.ownerMemberId ?? NONE} disabled={!editable}
            onValueChange={async (v) => {
              try { await update({ id: projectId, ownerMemberId: v === NONE ? null : (v as Id<"members">) }); } catch (e) { fail(e); }
            }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Nobody</SelectItem>
              {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="due">Due</Label>
          <Input id="due" type="date" disabled={!editable} defaultValue={toDateInput(project.dueDate)}
            key={project.dueDate ?? "none"}
            onBlur={async (e) => {
              const next = fromDateInput(e.target.value);
              if (next === (project.dueDate ?? null)) return;
              try { await update({ id: projectId, dueDate: next }); } catch (err) { fail(err); }
            }} />
        </div>
      </div>

      <Section title="Tasks">
        {project.tasks.length === 0 && <p className="text-sm text-steel">No tasks yet.</p>}
        <ul className="divide-y divide-hairline-2/40 rounded-lg border border-graphite/60 bg-coal/40">
          {project.tasks.map((t) => {
            const late = !t.done && t.dueDate !== undefined && t.dueDate < now;
            return (
              <li key={t._id} className="flex items-center gap-3 px-3 py-2">
                <input type="checkbox" className="size-4 accent-[var(--gold,#d4a843)]" checked={t.done}
                  disabled={!editable} aria-label={`Mark ${t.title} done`}
                  onChange={async (e) => { try { await setTaskDone({ id: t._id, done: e.target.checked }); } catch (err) { fail(err); } }} />
                <span className={cn("min-w-0 flex-1 truncate text-sm", t.done ? "text-steel line-through" : "text-bone")}>{t.title}</span>
                {t.stage && <Badge>{STAGE_LABEL[t.stage]}</Badge>}
                <Select value={t.ownerMemberId ?? NONE} disabled={!editable}
                  onValueChange={async (v) => {
                    try { await updateTask({ id: t._id, ownerMemberId: v === NONE ? null : (v as Id<"members">) }); } catch (e) { fail(e); }
                  }}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nobody</SelectItem>
                    {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="date" disabled={!editable} className={cn("h-8 w-36 text-xs", late && "border-critical/60")}
                  defaultValue={toDateInput(t.dueDate)} key={t.dueDate ?? "none"}
                  aria-label={`Due date for ${t.title}`}
                  onBlur={async (e) => {
                    const next = fromDateInput(e.target.value);
                    if (next === (t.dueDate ?? null)) return;
                    try { await updateTask({ id: t._id, dueDate: next }); } catch (err) { fail(err); }
                  }} />
                {editable && (
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${t.title}`}
                    onClick={async () => { try { await removeTask({ id: t._id }); } catch (e) { fail(e); } }}><X /></Button>
                )}
              </li>
            );
          })}
        </ul>
        {editable && (
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
            e.preventDefault();
            if (!taskTitle.trim()) return;
            try {
              await addTask({ projectId, title: taskTitle, stage: project.stage, dueDate: fromDateInput(taskDue) ?? undefined });
              setTaskTitle(""); setTaskDue("");
            } catch (err) { fail(err); }
          }}>
            <Input className="min-w-48 flex-1" placeholder="Add a task" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
            <Input className="w-40" type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} aria-label="Task due date" />
            <Button type="submit" variant="secondary" disabled={!taskTitle.trim()}><Plus /> Add</Button>
          </form>
        )}
      </Section>

      <Section title="Linked to">
        {project.links.length === 0 && <p className="text-sm text-steel">Nothing linked yet.</p>}
        <ul className="flex flex-wrap gap-2">
          {project.links.map((l) => (
            <li key={l._id} className="inline-flex items-center gap-2 rounded-md border border-graphite/60 bg-coal/40 px-2.5 py-1 text-sm text-bone">
              <span className="text-xs text-steel">{LINK_KIND_LABEL[l.kind]}</span>
              {l.label}
              {editable && (
                <button type="button" aria-label={`Unlink ${l.label}`} className="text-steel hover:text-critical"
                  onClick={async () => { try { await removeLink({ id: l._id }); } catch (e) { fail(e); } }}><X className="size-3.5" /></button>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Select value={linkKind} onValueChange={(v) => { setLinkKind(v as typeof linkKind); setLinkRef(""); }}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PICKABLE_KINDS.filter((k) => k !== "invoice" || (candidates?.invoice.length ?? 0) > 0)
                  .map((k) => <SelectItem key={k} value={k}>{LINK_KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={linkRef} onValueChange={setLinkRef}>
              <SelectTrigger className="min-w-52 flex-1"><SelectValue placeholder="Choose one" /></SelectTrigger>
              <SelectContent>
                {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="secondary" disabled={!linkRef} onClick={async () => {
              try { await addLink({ projectId, kind: linkKind, refId: linkRef }); setLinkRef(""); } catch (e) { fail(e); }
            }}><Plus /> Link</Button>
          </div>
        )}
      </Section>

      <Section title="Notes">
        <Textarea disabled={!editable} value={notes ?? project.notes ?? ""} onChange={(e) => setNotes(e.target.value)}
          onBlur={async () => {
            if (notes === null || notes === (project.notes ?? "")) return;
            try { await update({ id: projectId, notes }); setNotes(null); } catch (e) { fail(e); }
          }} placeholder="Reference tracks, client direction, delivery format" />
      </Section>
    </div>
  );
}
