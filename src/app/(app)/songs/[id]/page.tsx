"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowLeft,
  Disc3,
  Gauge,
  MoreHorizontal,
  Music4,
  Play,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { meta, SONG_STAGE, titleCase } from "@/lib/labels";
import { musicalKey, compactNumber } from "@/lib/format";
import { tintFromString } from "@/lib/utils";
import { StageStepper } from "@/components/songs/stage-stepper";
import { OverviewCard } from "@/components/songs/overview-card";
import { OverviewTab } from "@/components/songs/overview-tab";
import { AiActivityTab } from "@/components/songs/ai-activity-tab";
import { DeliverablesTab } from "@/components/songs/deliverables-tab";
import { SplitsTab } from "@/components/songs/splits-tab";
import {
  SessionsTab,
  SyncReleaseTab,
  ActivityTab,
} from "@/components/songs/song-tabs-extra";

export default function SongDetailPage() {
  const { id } = useParams<{ id: string }>();
  const songId = id as Id<"songs">;
  const song = useQuery(api.songs.get, { id: songId });

  if (song === undefined) {
    return <DetailSkeleton />;
  }

  if (song === null) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={Music4}
          title="Song not found"
          description="This track may have been removed, or the link is no longer valid."
          action={
            <Button asChild>
              <Link href="/songs">Back to catalog</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <SongHero song={song} />
      <OverviewCard songId={songId} />
      <StageStepper songId={songId} current={song.stage} />

      <Tabs defaultValue="overview" className="space-y-4">
        <div className="no-scrollbar overflow-x-auto">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="deliverables">
              Deliverables
              {song.deliverables.length > 0 && (
                <span className="font-mono text-[0.625rem] text-ash-dim">
                  {song.deliverables.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="splits">Splits</TabsTrigger>
            <TabsTrigger value="sessions">
              Sessions
              {song.sessions.length > 0 && (
                <span className="font-mono text-[0.625rem] text-ash-dim">
                  {song.sessions.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sync">Sync &amp; Release</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <OverviewTab song={song} />
        </TabsContent>
        <TabsContent value="deliverables">
          <DeliverablesTab songId={songId} />
        </TabsContent>
        <TabsContent value="splits">
          <SplitsTab songId={songId} />
        </TabsContent>
        <TabsContent value="sessions">
          <SessionsTab sessions={song.sessions} />
        </TabsContent>
        <TabsContent value="sync">
          <SyncReleaseTab songId={songId} syncs={song.syncs} />
        </TabsContent>
        <TabsContent value="ai">
          <AiActivityTab songId={songId} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab songId={songId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/songs"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-ash transition-colors hover:text-bone"
    >
      <ArrowLeft className="size-3.5" />
      Catalog
    </Link>
  );
}

/* ── Hero header ── */
type HeroSong = {
  _id: Id<"songs">;
  title: string;
  kind: string;
  stage: string;
  genre?: string;
  bpm?: number;
  musicalKey?: string;
  mode?: string;
  moodTags: string[];
  coverColor?: string;
  streamCount?: number;
  openComments: number;
  artist: { _id: string; name: string } | null;
};

function SongHero({ song }: { song: HeroSong }) {
  const router = useRouter();
  const removeSong = useMutation(api.songs.remove);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const stage = meta(SONG_STAGE, song.stage);
  const tint = song.coverColor ?? tintFromString(song.title);

  async function remove() {
    setDeleting(true);
    try {
      await removeSong({ id: song._id });
      toast.success(`"${song.title}" removed from the catalog.`);
      router.push("/songs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the song.");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-hairline bg-coal">
        <div
          className="flex flex-wrap items-center gap-5 p-5"
          style={{
            background: `linear-gradient(120deg, ${tint}26 0%, ${tint}0a 45%, transparent 80%)`,
          }}
        >
          {/* Cover */}
          <div
            className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-lg"
            style={{
              background: `linear-gradient(135deg, ${tint} 0%, ${tint}55 100%)`,
            }}
          >
            <Disc3 className="size-12 text-ink/70" />
          </div>

          {/* Identity */}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={stage.tone}>{stage.label}</Badge>
              <Badge tone="neutral">{titleCase(song.kind)}</Badge>
              {song.openComments > 0 && (
                <Badge tone="caution">
                  {song.openComments} open {song.openComments === 1 ? "note" : "notes"}
                </Badge>
              )}
            </div>
            <h1 className="truncate font-display text-2xl font-bold tracking-tight text-bone">
              {song.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ash">
              {song.artist ? (
                <Link
                  href={`/roster/${song.artist._id}`}
                  className="font-medium text-gold hover:underline"
                >
                  {song.artist.name}
                </Link>
              ) : (
                <span className="text-ash-dim">Unknown artist</span>
              )}
              {song.genre && (
                <>
                  <Dot />
                  <span>{song.genre}</span>
                </>
              )}
              {song.bpm != null && (
                <>
                  <Dot />
                  <span className="inline-flex items-center gap-1">
                    <Gauge className="size-3.5 text-ash-dim" />
                    {song.bpm} BPM
                  </span>
                </>
              )}
              {song.musicalKey && (
                <>
                  <Dot />
                  <span>{musicalKey(song.musicalKey, song.mode)}</span>
                </>
              )}
              {song.stage === "released" && song.streamCount != null && (
                <>
                  <Dot />
                  <span className="inline-flex items-center gap-1 text-positive">
                    <Play className="size-3.5" />
                    {compactNumber(song.streamCount)} streams
                  </span>
                </>
              )}
            </div>
            {song.moodTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {song.moodTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-sm bg-gold/[0.08] px-2 py-0.5 text-[0.6875rem] font-medium text-gold-bright"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="Song actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Song</DropdownMenuLabel>
              {song.artist && (
                <DropdownMenuItem asChild>
                  <Link href={`/roster/${song.artist._id}`}>View artist</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                <Trash2 className="size-4" />
                Delete song
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Delete confirm */}
      <Dialog open={confirmOpen} onOpenChange={(next) => !deleting && setConfirmOpen(next)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this song?</DialogTitle>
            <DialogDescription>
              &ldquo;{song.title}&rdquo; will be removed from the catalog. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-ash">
              Deliverables, splits and the release plan attached to this track will no longer be
              reachable.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" disabled={deleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button variant="danger" onClick={remove} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete song"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Dot() {
  return <span className="text-ash-dim">·</span>;
}

/* ── Loading skeleton ── */
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-36 w-full rounded-xl" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-9 w-96" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 w-full lg:col-span-2" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
