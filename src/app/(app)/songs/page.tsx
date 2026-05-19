"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Music4, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { SONG_STAGE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { SongCard } from "@/components/songs/song-card";
import { NewSongDialog } from "@/components/songs/new-song-dialog";

const STAGE_KEYS = [
  "writing",
  "demo",
  "tracking",
  "editing",
  "mixing",
  "mastering",
  "delivered",
  "released",
] as const;

const KIND_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "single", label: "Singles" },
  { value: "album_track", label: "Album tracks" },
  { value: "ep", label: "EPs" },
  { value: "beat", label: "Beats" },
  { value: "spec", label: "Spec" },
];

function SongsCatalog() {
  const searchParams = useSearchParams();

  const [stage, setStage] = useState<string>("all");
  const [kind, setKind] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Auto-open the New Song dialog when ?new=1 is present.
  const handledNewParam = useRef(false);
  useEffect(() => {
    if (!handledNewParam.current && searchParams.get("new") === "1") {
      handledNewParam.current = true;
      setDialogOpen(true);
    }
  }, [searchParams]);

  // Debounce the search input before it drives the query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryArgs = useMemo(
    () => ({
      stage: stage === "all" ? undefined : (stage as (typeof STAGE_KEYS)[number]),
      kind:
        kind === "all"
          ? undefined
          : (kind as "single" | "album_track" | "beat" | "spec" | "ep"),
      search: debouncedSearch || undefined,
    }),
    [stage, kind, debouncedSearch],
  );

  const songs = useQuery(api.songs.list, queryArgs);
  const stageCounts = useQuery(api.songs.byStage);

  const filtersActive = stage !== "all" || kind !== "all" || debouncedSearch.length > 0;

  function clearFilters() {
    setStage("all");
    setKind("all");
    setSearchInput("");
    setDebouncedSearch("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Catalog"
        title="Songs"
        description="Every track in the studio — from a working title in writing to a released record. The catalog is the spine of the whole product."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            New song
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ash-dim" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search songs by title…"
              className="pl-9"
              aria-label="Search songs"
            />
          </div>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_FILTERS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="size-4" />
              Clear
            </Button>
          )}
        </div>

        {/* Stage chips */}
        <div className="no-scrollbar -mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1">
          <StageChip
            label="All stages"
            active={stage === "all"}
            onClick={() => setStage("all")}
            count={
              stageCounts
                ? Object.values(stageCounts).reduce((a, b) => a + b, 0)
                : undefined
            }
          />
          {STAGE_KEYS.map((key) => (
            <StageChip
              key={key}
              label={SONG_STAGE[key].label}
              active={stage === key}
              onClick={() => setStage(key)}
              count={stageCounts?.[key]}
            />
          ))}
        </div>
      </div>

      {/* Results */}
      {songs === undefined ? (
        <SkeletonCards cards={8} />
      ) : songs.length === 0 ? (
        <EmptyState
          icon={Music4}
          title={filtersActive ? "No songs match these filters" : "No songs yet"}
          description={
            filtersActive
              ? "Adjust the stage, kind, or search to widen the catalog."
              : "Start the catalog with your first track — it carries sessions, deliverables, splits and the release plan."
          }
          action={
            filtersActive ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="size-4" />
                New song
              </Button>
            )
          }
        />
      ) : (
        <>
          <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-ash-dim">
            {songs.length} {songs.length === 1 ? "song" : "songs"}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {songs.map((song) => (
              <SongCard key={song._id} song={song} />
            ))}
          </div>
        </>
      )}

      <NewSongDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function StageChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-gold-dim bg-gold/10 text-gold-bright"
          : "border-hairline bg-coal text-ash hover:border-hairline-2 hover:text-bone",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "font-mono text-[0.625rem]",
            active ? "text-gold-bright/70" : "text-ash-dim",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function SongsPage() {
  return (
    <Suspense fallback={<SkeletonCards cards={8} />}>
      <SongsCatalog />
    </Suspense>
  );
}
