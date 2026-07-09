"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Search, Upload, UserPlus, Users, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { CountUp } from "@/components/shell/app-motion";
import { StatTile } from "@/components/ui/stat-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money, relativeTime } from "@/lib/format";
import { meta, ARTIST_STATUS, RELIABILITY } from "@/lib/labels";
import { AddArtistDialog } from "@/components/roster/add-artist-dialog";
import { ImportClientsDialog } from "@/components/roster/import-clients-dialog";
import { StatusFilter, type StatusFilterValue } from "@/components/roster/status-filter";
import { GenreChips } from "@/components/roster/genre-chips";
import { artistTypeLabel } from "@/components/roster/constants";
import { useDebouncedValue } from "@/components/roster/use-debounced-value";

const COLUMN_COUNT = 7;

type ArtistRow = {
  type: string;
  status: string;
  sessionCount: number;
  lifetimeValueCents: number;
};

/** Top-level lenses over the one contacts table. Artists = creative talent you
 *  work with; Clients = anyone who has booked or paid; Leads = prospects. They
 *  intentionally overlap (a booked artist shows in both Artists and Clients). */
const SEGMENTS: { key: string; label: string; match: (a: ArtistRow) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "artists", label: "Artists", match: (a) => ["artist", "band", "songwriter", "producer"].includes(a.type) },
  { key: "clients", label: "Clients", match: (a) => a.sessionCount > 0 || a.lifetimeValueCents > 0 },
  { key: "leads", label: "Leads", match: (a) => a.status === "lead" },
];

function RosterView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const segParam = searchParams.get("segment") ?? "all";
  const [segment, setSegment] = React.useState(SEGMENTS.some((s) => s.key === segParam) ? segParam : "all");
  // Follow the URL param (?segment=artists etc. - deep links still work)
  // even when already on this page (render-time sync, no effect cascade).
  const [prevSeg, setPrevSeg] = React.useState(segParam);
  if (prevSeg !== segParam) {
    setPrevSeg(segParam);
    if (SEGMENTS.some((s) => s.key === segParam)) setSegment(segParam);
  }
  const [status, setStatus] = React.useState<StatusFilterValue>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const search = useDebouncedValue(searchInput.trim(), 250);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  // Auto-open the Add Artist dialog when the URL carries ?new=1. Split into
  // a render-time check (state) and an effect that strips the param.
  const newParam = searchParams.get("new");
  const [prevNewParam, setPrevNewParam] = React.useState(newParam);
  if (prevNewParam !== newParam) {
    setPrevNewParam(newParam);
    if (newParam === "1") setAddOpen(true);
  }
  React.useEffect(() => {
    if (searchParams.get("new") === "1") router.replace("/roster");
  }, [searchParams, router]);

  const counts = useQuery(api.artists.counts);
  const artists = useQuery(api.artists.list, {
    status: status === "all" ? undefined : status,
    search: search || undefined,
  });

  const visible = React.useMemo(() => {
    const m = SEGMENTS.find((s) => s.key === segment)?.match ?? (() => true);
    return (artists ?? []).filter(m);
  }, [artists, segment]);

  const filtering = status !== "all" || search.length > 0 || segment !== "all";
  const loading = artists === undefined;
  const empty = !loading && visible.length === 0;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="CRM"
        title="Clients"
        description="Every client - artist, producer and label - the studio works with, ranked by lifetime value."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" />
              Import clients
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus className="size-4" />
              Add artist
            </Button>
          </div>
        }
      />

      {/* Stat tiles */}
      {counts === undefined ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="rise-stagger grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Total roster" value={<CountUp to={counts.total} />} icon={Users} accent />
          <StatTile label="Active" value={<CountUp to={counts.active} />} />
          <StatTile label="VIP" value={<CountUp to={counts.vip} />} />
          <StatTile label="Leads" value={<CountUp to={counts.lead} />} />
          <StatTile label="Dormant" value={<CountUp to={counts.dormant} />} />
        </div>
      )}

      {/* Segment lenses over the one contacts table */}
      <div className="flex flex-wrap gap-1 border-b border-graphite/50">
        {SEGMENTS.map((s) => {
          const active = segment === s.key;
          const n = (artists ?? []).filter(s.match).length;
          return (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              className={
                "relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                (active ? "border-gold text-bone" : "border-transparent text-steel/70 hover:text-steel")
              }
            >
              {s.label}
              {artists !== undefined && <span className="ml-1.5 font-meta text-[0.6875rem] text-steel/70">{n}</span>}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusFilter
          value={status}
          onChange={setStatus}
          counts={
            counts && {
              all: counts.total,
              lead: counts.lead,
              active: counts.active,
              vip: counts.vip,
              dormant: counts.dormant,
            }
          }
        />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, genre, tag…"
            className="pl-9 pr-9"
            aria-label="Search roster"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-steel/70 transition-colors hover:bg-coal-3 hover:text-bone"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {empty ? (
        <EmptyState
          icon={Users}
          title={filtering ? "No clients match" : "No clients yet"}
          description={
            filtering
              ? "Try a different status or clear the search to see everyone."
              : "Add your first client to start building the studio's CRM."
          }
          action={
            filtering ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setStatus("all");
                  setSearchInput("");
                  setSegment("all");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setAddOpen(true)}>
                <UserPlus className="size-4" />
                Add artist
              </Button>
            )
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Status</TH>
              <TH>Reliability</TH>
              <TH>Genres</TH>
              <TH className="text-right">Sessions</TH>
              <TH className="text-right">Lifetime value</TH>
              <TH className="text-right">Last contact</TH>
            </TR>
          </THead>
          <TBody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TR key={i}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <Skeleton className="size-10 rounded-md" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-3.5 w-32" />
                          <Skeleton className="h-2.5 w-16" />
                        </div>
                      </div>
                    </TD>
                    {Array.from({ length: COLUMN_COUNT - 1 }).map((__, j) => (
                      <TD key={j}>
                        <Skeleton className="h-4 w-16" />
                      </TD>
                    ))}
                  </TR>
                ))
              : visible.map((artist) => {
                  const st = meta(ARTIST_STATUS, artist.status);
                  const rel = meta(RELIABILITY, artist.reliability);
                  return (
                    <TR
                      key={artist._id}
                      interactive
                      onClick={() => router.push(`/roster/${artist._id}`)}
                    >
                      <TD>
                        <Link
                          href={`/roster/${artist._id}`}
                          className="flex items-center gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Avatar name={artist.name} color={artist.avatarColor} size="md" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-bone">{artist.name}</p>
                            <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                              {artistTypeLabel(artist.type)}
                              {artist.location ? ` · ${artist.location}` : ""}
                            </p>
                          </div>
                        </Link>
                      </TD>
                      <TD>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </TD>
                      <TD>
                        <Badge tone={rel.tone} dot>
                          {rel.label}
                        </Badge>
                      </TD>
                      <TD>
                        <GenreChips items={artist.genres} max={3} />
                      </TD>
                      <TD className="text-right font-meta tabular-nums text-steel">
                        {artist.sessionCount}
                      </TD>
                      <TD className="text-right font-meta tabular-nums font-medium text-bone">
                        {money(artist.lifetimeValueCents, { compact: true })}
                      </TD>
                      <TD className="text-right text-steel/70">
                        {artist.lastContactAt ? relativeTime(artist.lastContactAt) : "-"}
                      </TD>
                    </TR>
                  );
                })}
          </TBody>
        </Table>
      )}

      {!loading && !empty && (
        <p className="text-xs text-steel/70">
          Showing {visible.length} {visible.length === 1 ? "contact" : "contacts"}
          {filtering ? " for the current filters" : ""}.
        </p>
      )}

      <AddArtistDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportClientsDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

/* useSearchParams() must sit under a Suspense boundary for static export. */
export default function RosterPage() {
  return (
    <React.Suspense fallback={null}>
      <RosterView />
    </React.Suspense>
  );
}
