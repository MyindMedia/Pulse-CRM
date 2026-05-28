"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, MessageSquarePlus, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

/* In-browser audio review with a real (or procedurally-rendered) waveform,
   click-to-seek, click-to-comment, and live timestamped comment markers. */

const BARS = 160;

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Pseudo-waveform peaks derived deterministically from a string seed -
 *  used until the real audio-decoded peaks land (or if decoding fails). */
function pseudoPeaks(seed: string, bars: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    const v = Math.abs((h | 0) / 2147483647);
    // Smoothed shape: louder in the middle, quieter at edges.
    const envelope = 1 - Math.abs(i / bars - 0.5) * 1.6;
    out.push(Math.max(0.05, Math.min(1, v * 0.85 + envelope * 0.4)));
  }
  return out;
}

/** Best-effort decode of the audio file to real peaks. Returns null on any
 *  failure (CORS, decode error, no AudioContext) so the caller falls back. */
async function decodePeaks(url: string, bars: number): Promise<number[] | null> {
  try {
    const Ctx = (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return null;
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const audioCtx = new Ctx();
    try {
      const decoded = await audioCtx.decodeAudioData(buf);
      const channel = decoded.getChannelData(0);
      const samplesPerBar = Math.max(1, Math.floor(channel.length / bars));
      const peaks: number[] = [];
      for (let i = 0; i < bars; i++) {
        let max = 0;
        const start = i * samplesPerBar;
        const end = Math.min(channel.length, start + samplesPerBar);
        for (let j = start; j < end; j++) {
          const v = Math.abs(channel[j]);
          if (v > max) max = v;
        }
        peaks.push(max);
      }
      return peaks;
    } finally {
      audioCtx.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

export function WaveformPlayer({
  deliverableId,
  authorName,
}: {
  deliverableId: Id<"deliverables">;
  authorName: string;
}) {
  const dl = useQuery(api.files.downloadUrl, deliverableId ? { deliverableId } : "skip");
  const comments = useQuery(api.deliverables.comments, { deliverableId });
  const addComment = useMutation(api.deliverables.addComment);

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [peaks, setPeaks] = React.useState<number[]>(() => pseudoPeaks(deliverableId, BARS));
  const [draftAt, setDraftAt] = React.useState<number | null>(null);
  const [draftBody, setDraftBody] = React.useState("");
  const [posting, setPosting] = React.useState(false);

  // Try to swap pseudo peaks for real ones once the URL resolves.
  React.useEffect(() => {
    let cancelled = false;
    if (!dl?.url) return;
    decodePeaks(dl.url, BARS).then((real) => {
      if (!cancelled && real) setPeaks(real);
    });
    return () => {
      cancelled = true;
    };
  }, [dl?.url]);

  // Draw the waveform + playhead + comment markers.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const progress = duration > 0 ? currentTime / duration : 0;
    const barWidth = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth;
      const peak = peaks[i];
      const barH = Math.max(2, peak * (h * 0.85));
      const playedHere = i / peaks.length <= progress;
      ctx.fillStyle = playedHere ? "#fdb913" : "rgba(255,255,255,0.18)";
      ctx.fillRect(x + 0.5, (h - barH) / 2, Math.max(1, barWidth - 1), barH);
    }

    // Playhead.
    if (duration > 0) {
      const px = progress * w;
      ctx.fillStyle = "rgba(253,185,19,0.9)";
      ctx.fillRect(px - 0.5, 0, 1, h);
    }

    // Comment markers (small triangle at top).
    if (duration > 0 && comments) {
      for (const c of comments) {
        const cx = (c.timestampSec / duration) * w;
        ctx.fillStyle = c.resolved ? "rgba(255,255,255,0.4)" : "#fdb913";
        ctx.beginPath();
        ctx.moveTo(cx - 4, 0);
        ctx.lineTo(cx + 4, 0);
        ctx.lineTo(cx, 6);
        ctx.closePath();
        ctx.fill();
      }
    }
  }, [peaks, currentTime, duration, comments]);

  function clickedTime(e: React.MouseEvent<HTMLCanvasElement>): number {
    const canvas = canvasRef.current;
    if (!canvas || duration === 0) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return Math.max(0, Math.min(duration, (x / rect.width) * duration));
  }

  function handleSeek(e: React.MouseEvent<HTMLCanvasElement>) {
    const t = clickedTime(e);
    if (audioRef.current) audioRef.current.currentTime = t;
    setCurrentTime(t);
  }

  function handleAddCommentClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const t = clickedTime(e);
    setDraftAt(t);
  }

  async function postComment() {
    if (draftAt == null || !draftBody.trim()) return;
    setPosting(true);
    try {
      await addComment({
        deliverableId,
        timestampSec: Math.round(draftAt * 10) / 10,
        body: draftBody.trim(),
        authorName,
      });
      toast.success("Comment added.");
      setDraftBody("");
      setDraftAt(null);
    } catch {
      toast.error("Could not add the comment.");
    } finally {
      setPosting(false);
    }
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => undefined);
    else a.pause();
  }

  if (dl === undefined) return <div className="flex items-center gap-2 py-6 text-xs text-ash"><Loader2 className="size-4 animate-spin" /> Loading audio…</div>;
  if (dl === null) return <p className="py-6 text-center text-xs text-ash-dim">No audio file available.</p>;

  return (
    <div className="space-y-3">
      <audio
        ref={audioRef}
        src={dl.url}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        preload="metadata"
        className="hidden"
      />

      <div className="rounded-md border border-hairline bg-ink-2 p-3">
        <canvas
          ref={canvasRef}
          onClick={handleSeek}
          onDoubleClick={handleAddCommentClick}
          className="block h-24 w-full cursor-crosshair rounded-sm"
          aria-label="Waveform - click to seek, double-click to comment at that point"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" variant="secondary" onClick={togglePlay}>
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <span className="font-mono text-xs tabular-nums text-ash">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[0.625rem] text-ash-dim">
            <MessageSquarePlus className="size-3.5" />
            Double-click the waveform to leave a timestamped note.
          </span>
        </div>
      </div>

      {draftAt != null && (
        <div className="rounded-md border border-gold/40 bg-gold/5 p-3">
          <p className="font-mono text-[0.625rem] uppercase tracking-wide text-gold">
            Add note at {fmtTime(draftAt)}
          </p>
          <textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={3}
            placeholder="e.g. tighten the kick at this hit, vox slightly behind the beat..."
            className="mt-2 w-full rounded-md border border-hairline bg-ink-2 px-3 py-2 text-sm text-bone outline-none focus-visible:ring-2 focus-visible:ring-gold/30"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setDraftAt(null); setDraftBody(""); }}>Cancel</Button>
            <Button size="sm" disabled={posting || !draftBody.trim()} onClick={postComment}>
              {posting ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
