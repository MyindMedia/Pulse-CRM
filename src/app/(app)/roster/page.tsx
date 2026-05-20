"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Search, UserPlus, Users, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
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
import { StatusFilter, type StatusFilterValue } from "@/components/roster/status-filter";
import { GenreChips } from "@/components/roster/genre-chips";
import { artistTypeLabel } from "@/components/roster/constants";
import { useDebouncedValue } from "@/components/roster/use-debounced-value";

const COLUMN_COUNT = 7;

function RosterView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = React.useState<StatusFilterValue>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const search = useDebouncedValue(searchInput.trim(), 250);
  const [addOpen, setAddOpen] = React.useState(false);

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

  const filtering = status !== "all" || search.length > 0;
  const loading = artists === undefined;
  const empty = !loading && artists.length === 0;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="CRM"
        title="Roster"
        description="Every artist, producer and label the studio works with - ranked by lifetime value."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" />
            Add artist
          </Button>
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Total roster" value={String(counts.total)} icon={Users} accent />
          <StatTile label="Active" value={String(counts.active)} />
          <StatTile label="VIP" value={String(counts.vip)} />
          <StatTile label="Leads" value={String(counts.lead)} />
          <StatTile label="Dormant" value={String(counts.dormant)} />
        </div>
      )}

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
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ash-dim" />
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
              className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-ash-dim transition-colors hover:bg-coal-3 hover:text-bone"
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
          title={filtering ? "No artists match" : "The roster is empty"}
          description={
            filtering
              ? "Try a different status or clear the search to see everyone."
              : "Add your first artist to start building the studio's CRM."
          }
          action={
            filtering ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setStatus("all");
                  setSearchInput("");
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
              : artists.map((artist) => {
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
                            <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
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
                      <TD className="text-right font-mono tabular-nums text-ash">
                        {artist.sessionCount}
                      </TD>
                      <TD className="text-right font-mono tabular-nums font-medium text-bone">
                        {money(artist.lifetimeValueCents, { compact: true })}
                      </TD>
                      <TD className="text-right text-ash-dim">
                        {artist.lastContactAt ? relativeTime(artist.lastContactAt) : "-"}
                      </TD>
                    </TR>
                  );
                })}
          </TBody>
        </Table>
      )}

      {!loading && !empty && (
        <p className="text-xs text-ash-dim">
          Showing {artists.length} {artists.length === 1 ? "artist" : "artists"}
          {filtering ? " for the current filters" : ""}.
        </p>
      )}

      <AddArtistDialog open={addOpen} onOpenChange={setAddOpen} />
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
