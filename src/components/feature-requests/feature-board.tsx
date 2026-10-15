"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { ChevronUp, Lightbulb, Check, Pencil, GitMerge, Send } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from "@/components/ui/dialog";
import {
  FEATURE_STATUSES,
  FEATURE_STATUS_LABEL,
  FEATURE_CATEGORIES,
  TITLE_MAX,
  DESCRIPTION_MAX,
  type FeatureStatus,
} from "@convex/lib/featureRequests";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/* "What's in the works": the platform-wide feature request board.
   Studios see ideas, votes and status, never who asked. The agency console
   renders the same list with `admin` on: status, edit, merge and the
   requester's studio, name and email. */

type Tone = "neutral" | "gold" | "positive" | "caution" | "critical" | "info";
const STATUS_TONE: Record<FeatureStatus, Tone> = {
  pending: "neutral",
  in_the_works: "gold",
  beta: "info",
  q1: "info",
  q2: "info",
  q3: "info",
  q4: "info",
  shipped: "positive",
  declined: "critical",
};

export function StatusBadge({ status }: { status: FeatureStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{FEATURE_STATUS_LABEL[status]}</Badge>;
}

type Row = {
  _id: Id<"featureRequests">;
  title: string;
  description: string | null;
  category: string | null;
  status: FeatureStatus;
  votes: number;
  createdAt: number;
  voted: boolean;
  mine: boolean;
};
type AdminRow = Row & {
  requesterOrgName: string;
  requesterName: string | null;
  requesterEmail: string | null;
  mergedInto: Id<"featureRequests"> | null;
  mergedIntoTitle: string | null;
};

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** One-tap vote; tap again to take it back. */
function VoteButton({ row, compact }: { row: Pick<Row, "_id" | "voted" | "votes">; compact?: boolean }) {
  const toggle = useMutation(api.featureRequests.toggleVote);
  const [busy, setBusy] = React.useState(false);
  async function onClick() {
    setBusy(true);
    try {
      await toggle({ requestId: row._id });
    } catch (e) {
      toast.error(errorMessage(e, "Could not save your vote."));
    } finally {
      setBusy(false);
    }
  }
  if (compact) {
    return (
      <Button
        type="button" size="sm" variant={row.voted ? "primary" : "outline"}
        onClick={onClick} disabled={busy} aria-pressed={row.voted}
      >
        {row.voted ? <Check /> : <ChevronUp />}
        {row.voted ? "Voted" : "Vote"}
      </Button>
    );
  }
  return (
    <button
      type="button" onClick={onClick} disabled={busy} aria-pressed={row.voted}
      aria-label={row.voted ? `Remove your vote, ${row.votes} votes` : `Vote, ${row.votes} votes`}
      className={cn(
        "fr-vote flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border text-xs font-semibold",
        "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30 disabled:opacity-50",
        row.voted
          ? "border-gold-dim bg-gold/15 text-gold-bright"
          : "border-graphite/60 bg-obsidian text-steel hover:border-gold-dim hover:text-bone",
      )}
    >
      <ChevronUp className="size-4" />
      <span className="tabular-nums">{row.votes}</span>
    </button>
  );
}

// ── Submit form ─────────────────────────────────────────────────────

export function FeatureRequestForm() {
  const submit = useMutation(api.featureRequests.submit);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  // Wait for a short pause in typing before asking for matches.
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    const id = setTimeout(() => setTyped(title.trim()), 250);
    return () => clearTimeout(id);
  }, [title]);
  const matches = useQuery(
    api.featureRequests.similar,
    typed.length >= 2 ? { text: typed } : "skip",
  ) as Row[] | undefined;

  const ready = title.trim().length >= 3;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await submit({
        title: title.trim(),
        description: description.trim() || undefined,
        category: category || undefined,
      });
      toast.success("Request posted. It already has your vote.");
      setTitle(""); setDescription(""); setCategory(""); setTyped("");
    } catch (err) {
      toast.error(errorMessage(err, "Could not post the request."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-gold-bright" />Request a feature</CardTitle>
        <CardDescription>
          Tell us what would make Pulse better for your studio. Vote instead of posting a duplicate:
          the most voted ideas get built first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="What do you need?" htmlFor="fr-title" hint={`${title.trim().length}/${TITLE_MAX}`}>
            <Input
              id="fr-title" value={title} maxLength={TITLE_MAX} autoComplete="off"
              placeholder="e.g. Recurring weekly bookings for a band"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>

          {matches && matches.length > 0 && (
            <div className="fr-matches rounded-md border border-gold-dim/40 bg-gold/5 p-3" role="region" aria-label="Similar requests">
              <p className="mb-2 text-xs font-medium text-gold-bright">
                Already requested? Vote instead of posting a duplicate.
              </p>
              <ul className="space-y-2">
                {matches.map((m) => (
                  <li key={m._id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="truncate text-sm text-bone">{m.title}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-steel">
                        <StatusBadge status={m.status} />
                        <span>{m.votes} {m.votes === 1 ? "vote" : "votes"}</span>
                      </p>
                    </div>
                    <VoteButton row={m} compact />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Details (optional)" htmlFor="fr-desc" hint={`${description.length}/${DESCRIPTION_MAX}`}>
            <Textarea
              id="fr-desc" value={description} maxLength={DESCRIPTION_MAX} rows={3}
              placeholder="What are you trying to do, and what gets in the way today?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Category (optional)" className="w-full sm:w-56">
              <Select value={category || "none"} onValueChange={(val) => setCategory(val === "none" ? "" : val)}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {FEATURE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" disabled={!ready || busy} className="w-full sm:ml-auto sm:w-auto">
              <Send />{busy ? "Posting" : "Post request"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Board ───────────────────────────────────────────────────────────

export function FeatureBoard({ admin = false }: { admin?: boolean }) {
  const rows = useQuery(admin ? api.featureRequests.adminList : api.featureRequests.list, {}) as
    | (Row | AdminRow)[]
    | undefined;
  const [filter, setFilter] = React.useState<FeatureStatus | "all">("all");

  if (rows === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  // Merged duplicates stay in the owner's data but leave the board.
  const live = rows.filter((r) => !("mergedInto" in r && r.mergedInto));
  const counts = new Map<FeatureStatus, number>();
  live.forEach((r) => counts.set(r.status, (counts.get(r.status) ?? 0) + 1));
  const shown = filter === "all" ? live : live.filter((r) => r.status === filter);
  const chips: { key: FeatureStatus | "all"; label: string; n: number }[] = [
    { key: "all", label: "All", n: live.length },
    ...FEATURE_STATUSES.filter((s) => counts.has(s) || s === filter).map((s) => ({
      key: s, label: FEATURE_STATUS_LABEL[s], n: counts.get(s) ?? 0,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {chips.map((c) => (
          <button
            key={c.key} type="button" onClick={() => setFilter(c.key)} aria-pressed={filter === c.key}
            className={cn(
              "fr-chip rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-gold/30",
              filter === c.key
                ? "border-gold-dim bg-gold/15 text-gold-bright"
                : "border-graphite/60 text-steel hover:text-bone",
            )}
          >
            {c.label} <span className="tabular-nums opacity-70">{c.n}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={live.length === 0 ? "No requests yet" : "Nothing with that status"}
          description={live.length === 0 ? "Be the first to say what Pulse should build next." : "Try another filter."}
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <RequestRow key={r._id} row={r} admin={admin} all={live} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestRow({ row, admin, all }: { row: Row | AdminRow; admin: boolean; all: (Row | AdminRow)[] }) {
  const setStatus = useMutation(api.featureRequests.setStatus);
  const a = admin ? (row as AdminRow) : null;
  async function changeStatus(status: FeatureStatus) {
    try {
      await setStatus({ requestId: row._id, status });
      toast.success(`Marked ${FEATURE_STATUS_LABEL[status]}.`);
    } catch (e) {
      toast.error(errorMessage(e, "Could not change the status."));
    }
  }
  return (
    <li>
      <Card className="fr-row">
        <CardContent className="flex gap-3 p-4 sm:gap-4">
          <VoteButton row={row} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 break-words font-grotesk text-sm font-semibold text-bone">{row.title}</h3>
              <StatusBadge status={row.status} />
              {row.category && <Badge>{row.category}</Badge>}
            </div>
            {row.description && (
              <p className="whitespace-pre-wrap break-words text-sm text-steel">{row.description}</p>
            )}
            <p className="text-[0.6875rem] text-steel/70">
              {dateFmt.format(row.createdAt)}
              {row.mine && " · You asked for this"}
            </p>
            {a && (
              <p className="break-words rounded-sm border border-graphite/50 bg-coal-2/60 px-2 py-1.5 text-xs text-steel">
                {a.requesterOrgName}
                {a.requesterName && <> · {a.requesterName}</>}
                {a.requesterEmail && <> · <a className="underline decoration-dotted" href={`mailto:${a.requesterEmail}`}>{a.requesterEmail}</a></>}
              </p>
            )}
            {a && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Select value={row.status} onValueChange={(s) => changeStatus(s as FeatureStatus)}>
                  <SelectTrigger aria-label="Status" className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FEATURE_STATUSES.map((s) => <SelectItem key={s} value={s}>{FEATURE_STATUS_LABEL[s]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <EditDialog row={row} />
                <MergeDialog row={row} others={all.filter((o) => o._id !== row._id)} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function EditDialog({ row }: { row: Row }) {
  const edit = useMutation(api.featureRequests.edit);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(row.title);
  const [description, setDescription] = React.useState(row.description ?? "");
  const [category, setCategory] = React.useState(row.category ?? "");
  async function save() {
    try {
      await edit({ requestId: row._id, title, description, category });
      toast.success("Saved.");
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save."));
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Pencil />Edit</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit request</DialogTitle>
            <DialogDescription>Tidy the wording before other studios vote on it.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="Title" htmlFor="fr-e-title"><Input id="fr-e-title" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Details" htmlFor="fr-e-desc"><Textarea id="fr-e-desc" rows={4} value={description} maxLength={DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="Category">
              <Select value={category || "none"} onValueChange={(v) => setCategory(v === "none" ? "" : v)}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No category</SelectItem>
                  {FEATURE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={title.trim().length < 3}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MergeDialog({ row, others }: { row: Row; others: Row[] }) {
  const merge = useMutation(api.featureRequests.merge);
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState("");
  async function run() {
    try {
      await merge({ fromId: row._id, intoId: target as Id<"featureRequests"> });
      toast.success("Merged. The votes moved over.");
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e, "Could not merge."));
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={others.length === 0}><GitMerge />Merge</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge duplicate</DialogTitle>
            <DialogDescription>
              &ldquo;{row.title}&rdquo; leaves the board and its votes move to the request you pick.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Merge into">
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger aria-label="Merge into"><SelectValue placeholder="Pick the request to keep" /></SelectTrigger>
                <SelectContent>
                  {others.map((o) => <SelectItem key={o._id} value={o._id}>{o.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={run} disabled={!target}>Merge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The Settings tab: file a request, then browse the board. */
export function FeatureRequestsPanel() {
  return (
    <div className="space-y-6">
      <FeatureRequestForm />
      <section className="space-y-3">
        <div>
          <h2 className="font-grotesk text-base font-semibold text-bone">What&apos;s in the works</h2>
          <p className="text-sm text-steel">Every studio sees the same list. Vote for what you want built next.</p>
        </div>
        <FeatureBoard />
      </section>
    </div>
  );
}
