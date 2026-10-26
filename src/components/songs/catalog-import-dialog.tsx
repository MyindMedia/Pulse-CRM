"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Search } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/feedback";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/* Catalog Import: pick where the songs go (the Import Destination), the
   Credit Roles to search under, and the exact profile that is you at each
   source. Then the import runs in the background and this shows progress. */

const ROLES = [
  "Artist",
  "Writer",
  "Producer",
  "Engineer",
  "Mix Engineer",
  "Mastering Engineer",
  "Vocalist",
  "Musician",
] as const;

const SOURCE_LABEL: Record<string, string> = {
  genius: "Genius",
  musicbrainz: "MusicBrainz",
  deezer: "Deezer",
  apple: "Apple Music",
};

type Subject = { kind: "member" } | { kind: "artist"; artistId: Id<"artists"> };
type Candidate = {
  source: "genius" | "musicbrainz" | "deezer" | "apple";
  sourceId: string;
  name: string;
  imageUrl?: string;
  detail?: string;
  topSongs: string[];
};

const keyOf = (c: Candidate) => `${c.source}:${c.sourceId}`;

export function CatalogImportDialog({
  open,
  onOpenChange,
  subject,
  subjectName,
  orgId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subject: Subject;
  /** Prefills the search: the artist's name, or the member's own. */
  subjectName?: string;
  /** For an artist import, the artist's workspace (the only destination). */
  orgId?: string;
}) {
  const destinations = useQuery(api.catalogImport.destinations, open ? {} : "skip");
  const latest = useQuery(api.catalogImport.latest, open ? { subject } : "skip");
  const searchIdentity = useAction(api.catalogImport.searchIdentity);
  const start = useMutation(api.catalogImport.start);

  const [destination, setDestination] = React.useState<string>("");
  const [roles, setRoles] = React.useState<string[]>([subject.kind === "artist" ? "Artist" : "Producer"]);
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [needsName, setNeedsName] = React.useState(false);
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
  const [picked, setPicked] = React.useState<Candidate[]>([]);
  const [starting, setStarting] = React.useState(false);
  const [importId, setImportId] = React.useState<Id<"catalogImports"> | null>(null);
  const [startOver, setStartOver] = React.useState(false);

  const options = React.useMemo(
    () => (destinations ?? []).filter((d) => subject.kind === "member" || d.orgId === orgId),
    [destinations, subject.kind, orgId],
  );

  // Seed once per open: the active workspace, the person's name, and any
  // import already under way.
  React.useEffect(() => {
    if (!open) return;
    setQuery(subjectName ?? "");
    setCandidates(null);
    setPicked([]);
    setNeedsName(false);
    setStartOver(false);
    setImportId(null);
  }, [open, subjectName]);
  React.useEffect(() => {
    if (!destination && options.length) setDestination((options.find((o) => o.eligible) ?? options[0]).orgId);
  }, [options, destination]);

  const running = latest && (latest.status === "discovering" || latest.status === "importing");
  const showing = importId ?? (!startOver && latest ? latest.importId : null);
  const chosen = options.find((o) => o.orgId === destination);

  async function find() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchIdentity({ query });
      setNeedsName(res.needsName);
      setCandidates(res.candidates as Candidate[]);
      if (res.name && res.name !== query) setQuery(res.name);
    } catch (err) {
      toast.error(errorMessage(err, "Search failed. Try again."));
    } finally {
      setSearching(false);
    }
  }

  function toggle(c: Candidate) {
    setPicked((p) =>
      p.some((x) => keyOf(x) === keyOf(c))
        ? p.filter((x) => keyOf(x) !== keyOf(c))
        : p.length >= 4
          ? p
          : [...p, c],
    );
  }

  async function begin() {
    setStarting(true);
    try {
      const res = await start({
        destinationOrgId: destination,
        subject,
        roles,
        identities: picked.map(({ source, sourceId, name, imageUrl }) => ({ source, sourceId, name, imageUrl })),
      });
      setImportId(res.importId);
      toast.success("Import started. It keeps running if you close this.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not start the import."));
    } finally {
      setStarting(false);
    }
  }

  const title = subject.kind === "artist" ? `Import ${subjectName ?? "artist"}'s catalog` : "Import my catalog";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Pull in released songs with their ISRC, credits and artwork. Each song lands in the Songs list with a
            drafted split sheet.
          </DialogDescription>
        </DialogHeader>

        {showing ? (
          <DialogBody>
            <ImportProgress
              importId={showing}
              onAgain={running && !importId ? undefined : () => { setImportId(null); setStartOver(true); }}
            />
          </DialogBody>
        ) : (
          <>
            <DialogBody className="space-y-5">
              {/* 1. Where the songs go */}
              <Field
                label="Add the songs to"
                hint={
                  chosen && !chosen.eligible
                    ? `${chosen.name} is on ${chosen.planLabel}. Catalog import needs Growth or Max.`
                    : "That workspace's plan covers the import. Copies in two workspaces never sync."
                }
              >
                {destinations === undefined ? (
                  <Spinner />
                ) : options.length === 0 ? (
                  <p className="text-sm text-steel">You can&apos;t add songs to any workspace yet.</p>
                ) : (
                  <Select value={destination} onValueChange={setDestination} disabled={subject.kind === "artist"}>
                    <SelectTrigger aria-label="Destination workspace">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((o) => (
                        <SelectItem key={o.orgId} value={o.orgId}>
                          {o.name} · {o.planLabel}
                          {o.eligible ? "" : " (upgrade needed)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              {/* 2. Roles */}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-bone">Credited as</legend>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map((r) => {
                    const on = roles.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setRoles((p) => (on ? p.filter((x) => x !== r) : [...p, r]))}
                        className={cn(
                          "inline-flex min-h-9 items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors",
                          on
                            ? "border-gold-dim bg-gold/10 text-gold-bright"
                            : "border-graphite/50 bg-coal text-steel hover:text-bone",
                        )}
                      >
                        {on && <Check className="size-3" />}
                        {r}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* 3. Which profile is you */}
              <Field
                label="Find the profile that is you"
                hint="Paste a Spotify, Apple Music or TIDAL artist link, or type a name. Pick the profile that is you; we also check Genius, MusicBrainz, Apple Music and Deezer for the rest."
              >
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void find();
                  }}
                >
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Artist link or name"
                    aria-label="Artist link or name"
                  />
                  <Button type="submit" variant="outline" disabled={searching || !query.trim()}>
                    {searching ? <Spinner /> : <Search className="size-4" />}
                    Search
                  </Button>
                </form>
              </Field>
              {needsName && (
                <p className="text-sm text-caution">TIDAL links don&apos;t show the artist&apos;s name. Type the name instead.</p>
              )}
              {candidates && candidates.length === 0 && !needsName && (
                <p className="text-sm text-steel">No profiles found. Try another spelling or paste a link.</p>
              )}
              {candidates && candidates.length > 0 && (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {candidates.map((c) => {
                    const on = picked.some((x) => keyOf(x) === keyOf(c));
                    return (
                      <li key={keyOf(c)}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(c)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors",
                            on ? "border-gold-dim bg-gold/10" : "border-graphite/50 bg-coal hover:border-graphite",
                          )}
                        >
                          {c.imageUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={c.imageUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" />
                          ) : (
                            <span className="size-10 shrink-0 rounded-md bg-coal-2" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-bone">{c.name}</span>
                              <Badge tone="info">{SOURCE_LABEL[c.source] ?? c.source}</Badge>
                            </span>
                            {(c.detail || c.topSongs.length > 0) && (
                              <span className="block truncate text-xs text-steel/80">
                                {[c.detail, c.topSongs.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                          {on && <Check className="size-4 shrink-0 text-gold-bright" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void begin()}
                disabled={starting || !chosen?.eligible || roles.length === 0 || picked.length === 0}
              >
                {starting && <Spinner />}
                Start import
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportProgress({ importId, onAgain }: { importId: Id<"catalogImports">; onAgain?: () => void }) {
  const job = useQuery(api.catalogImport.get, { importId });
  const resume = useMutation(api.catalogImport.resume);
  // A clock for the stalled check, ticking twice a minute.
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (job === undefined) return <Spinner />;
  if (job === null) return <p className="text-sm text-steel">This import isn&apos;t available.</p>;

  const live = job.status === "discovering" || job.status === "importing";
  // A chain that has not written a song for five minutes has stopped; offer a restart.
  const stalled = job.status === "importing" && now - job.heartbeatAt > 5 * 60_000;

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-bone">
          {job.status === "discovering"
            ? "Finding your songs…"
            : job.status === "importing"
              ? `Adding songs: ${job.done} of ${job.found}`
              : job.status === "done"
                ? "Import finished"
                : "Import stopped"}
        </p>
        <Badge tone={job.status === "done" ? "positive" : job.status === "failed" ? "critical" : "info"}>
          {job.identities.map((i) => SOURCE_LABEL[i.source] ?? i.source).filter((n, i, a) => a.indexOf(n) === i).join(", ")}
        </Badge>
      </div>
      {job.status === "discovering" ? (
        <Progress value={0} tone="info" />
      ) : (
        <Progress value={job.done} max={Math.max(job.found, 1)} tone={job.status === "failed" ? "critical" : "gold"} />
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="New songs" value={job.imported} />
        <Stat label="Matched" value={job.merged} />
        <Stat label="Not your role" value={job.skipped} />
        <Stat label="Couldn't add" value={job.failed} />
      </dl>
      {job.capped > 0 && (
        <p className="text-xs text-steel">{job.capped} more songs were left out by the 500-song limit per import.</p>
      )}
      {job.error && <p className="text-sm text-critical">{job.error}</p>}
      {live && <p className="text-xs text-steel">You can close this. The import keeps running.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {stalled && (
          <Button variant="outline" size="sm" onClick={() => void resume({ importId })}>
            Resume
          </Button>
        )}
        {!live && (
          <Button variant="outline" size="sm" asChild>
            <Link href="/songs">See songs</Link>
          </Button>
        )}
        {!live && onAgain && (
          <Button size="sm" onClick={onAgain}>
            Import again
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-graphite/50 bg-coal px-3 py-2">
      <dt className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">{label}</dt>
      <dd className="font-grotesk text-lg font-semibold text-bone">{value}</dd>
    </div>
  );
}
