"use client";

import Link from "next/link";
import { Disc3, Gauge, Music2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { meta, SONG_STAGE, titleCase } from "@/lib/labels";
import { musicalKey, compactNumber } from "@/lib/format";
import { tintFromString } from "@/lib/utils";

type SongCardData = {
  _id: string;
  title: string;
  artistName: string;
  kind: string;
  stage: string;
  genre?: string;
  bpm?: number;
  musicalKey?: string;
  mode?: string;
  moodTags: string[];
  coverColor?: string;
  coverUrl?: string | null;
  revisionsIncluded: number;
  revisionsUsed: number;
  streamCount?: number;
};

/** Catalog grid card - tonal cover, identity, stage, and revision budget at a glance. */
export function SongCard({ song }: { song: SongCardData }) {
  const stage = meta(SONG_STAGE, song.stage);
  const tint = song.coverColor ?? tintFromString(song.title);
  const revPct = song.revisionsIncluded > 0 ? song.revisionsUsed / song.revisionsIncluded : 0;
  const over = song.revisionsUsed > song.revisionsIncluded;

  return (
    <Card interactive className="group overflow-hidden p-0">
      <Link href={`/songs/${song._id}`} className="block">
        {/* Cover block - real art when set, tonal fallback otherwise */}
        <div
          className="relative flex h-28 items-end overflow-hidden p-3"
          style={{
            background: `linear-gradient(135deg, ${tint}33 0%, ${tint}0d 60%, transparent 100%)`,
          }}
        >
          {song.coverUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={song.coverUrl}
              alt=""
              className="absolute inset-0 size-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-105"
            />
          )}
          <div
            className="absolute -right-6 -top-6 grid size-24 place-items-center rounded-full opacity-20 transition-transform duration-300 group-hover:scale-110"
            style={{ background: tint }}
          >
            <Disc3 className="size-10 text-ink" />
          </div>
          <span
            className="grid size-9 place-items-center rounded-md"
            style={{
              backgroundColor: `${tint}22`,
              color: tint,
              boxShadow: `inset 0 0 0 1px ${tint}55`,
            }}
          >
            <Music2 className="size-4" />
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-grotesk text-sm font-semibold text-bone">
                {song.title}
              </p>
              <p className="truncate text-xs text-steel/70">{song.artistName}</p>
            </div>
            <Badge tone={stage.tone}>{stage.label}</Badge>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
            <span className="rounded-sm border border-graphite/50 bg-coal-2 px-1.5 py-0.5 text-steel">
              {titleCase(song.kind)}
            </span>
            {song.genre && (
              <span className="rounded-sm border border-graphite/50 bg-coal-2 px-1.5 py-0.5 text-steel">
                {song.genre}
              </span>
            )}
            {song.bpm != null && (
              <span className="inline-flex items-center gap-1">
                <Gauge className="size-3" />
                {song.bpm}
              </span>
            )}
            {song.musicalKey && <span>{musicalKey(song.musicalKey, song.mode)}</span>}
          </div>

          {song.moodTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {song.moodTags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm bg-gold/[0.07] px-1.5 py-0.5 text-[0.625rem] font-medium text-gold-bright"
                >
                  {tag}
                </span>
              ))}
              {song.moodTags.length > 3 && (
                <span className="text-[0.625rem] text-steel/70">+{song.moodTags.length - 3}</span>
              )}
            </div>
          )}

          <div className="space-y-1.5 border-t border-graphite/50 pt-2.5">
            <div className="flex items-center justify-between font-meta text-[0.625rem] uppercase tracking-wide">
              <span className="text-steel/70">Revisions</span>
              <span className={over ? "text-critical" : "text-steel"}>
                {song.revisionsUsed} / {song.revisionsIncluded}
              </span>
            </div>
            <Progress
              value={song.revisionsUsed}
              max={Math.max(song.revisionsIncluded, song.revisionsUsed, 1)}
              tone={over ? "critical" : revPct >= 0.75 ? "caution" : "gold"}
            />
            {song.stage === "released" && song.streamCount != null && (
              <p className="pt-0.5 font-meta text-[0.625rem] uppercase tracking-wide text-positive">
                {compactNumber(song.streamCount)} streams
              </p>
            )}
          </div>
        </div>
      </Link>
    </Card>
  );
}
