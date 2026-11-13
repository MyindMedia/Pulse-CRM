import * as React from "react";
import {
  Download,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileText,
  FileVideo,
  LoaderCircle,
  Lock,
  Music,
  Pause,
  Play,
} from "lucide-react";
import { fileKind, formatBytes, isPlayable, typeLabel, type FileKind } from "./format";
import { Waveform } from "./waveform";

export type DeliveryFile = { versionId: string; name: string; size: number; mimeType: string };

const KIND_ICON: Record<FileKind, React.ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>> = {
  audio: Music,
  video: FileVideo,
  archive: FileArchive,
  image: FileImage,
  doc: FileText,
  file: FileIcon,
};

/* 44 px round controls, as in the mockup's .round. Focus ring is the global
   :focus-visible outline; rounded-full keeps it round. */
const ROUND =
  "grid size-11 flex-none place-items-center rounded-full border border-hairline bg-coal-2 text-bone hover:border-bone disabled:cursor-wait motion-safe:transition-colors";

/* V3-03: the name never gets squeezed by the controls. The row is a size
   container; when it is too narrow for the icon, a 12rem name and the
   controls side by side, the name takes the whole first line and the icon
   and controls share the line under it (the icon is decorative, so moving it
   changes nothing for assistive tech or tab order). The widths are in rem, so
   they track the reader's text size:
     icon 2.25 + gap 0.75 + name 12 + (gap 0.75 + control 2.75) per control
     = 18.5rem with one control, 22rem with two. */
const NAME_STACKS_ONE = "@max-[18.5rem]:order-first @max-[18.5rem]:basis-full";
const NAME_STACKS_TWO = "@max-[22rem]:order-first @max-[22rem]:basis-full";

export function FileRow({
  file,
  locked,
  playing,
  progress,
  playBusy,
  downloadBusy,
  message,
  onPlay,
  onDownload,
}: {
  file: DeliveryFile;
  locked: boolean;
  /** This row's track is the one playing. */
  playing: boolean;
  /** 0..1 when this row's track is loaded, else null. */
  progress: number | null;
  playBusy: boolean;
  downloadBusy: boolean;
  /** The server's message for this row (a refused or rate-limited call). */
  message: string | null;
  onPlay: () => void;
  onDownload: () => void;
}) {
  const kind = fileKind(file.name, file.mimeType);
  const Icon = KIND_ICON[kind];
  const audio = isPlayable(file.mimeType);
  // Two round controls (Play and Download) or one (Download, or the lock).
  const twoControls = audio && !locked;
  return (
    <li className="@container grid gap-2.5 px-3.5 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="grid size-9 flex-none place-items-center rounded-md bg-coal-3 text-[color:var(--gold-text)]">
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
        <div className={`min-w-0 flex-1 ${twoControls ? NAME_STACKS_TWO : NAME_STACKS_ONE}`}>
          <p className="font-semibold [overflow-wrap:anywhere]">{file.name}</p>
          <p className="font-mono text-[0.75rem] tracking-[0.01em] text-steel">
            {typeLabel(file.name, file.mimeType)} · {formatBytes(file.size)}
          </p>
        </div>
        <div className="ml-auto flex flex-none items-center gap-3">
          {locked ? (
            <span role="img" aria-label="Locked" className={`${ROUND} text-steel`}>
              <Lock className="size-4" strokeWidth={1.75} aria-hidden />
            </span>
          ) : (
            <>
              {audio && (
                <button
                  type="button"
                  className={ROUND}
                  onClick={onPlay}
                  aria-label={`${playing ? "Pause" : "Play"} ${file.name}`}
                  aria-busy={playBusy || undefined}
                >
                  {playBusy ? (
                    <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
                  ) : playing ? (
                    <Pause className="size-4" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Play className="size-4" strokeWidth={1.75} aria-hidden />
                  )}
                </button>
              )}
              <button
                type="button"
                className={ROUND}
                onClick={onDownload}
                disabled={downloadBusy}
                aria-label={`Download ${file.name}`}
                aria-busy={downloadBusy || undefined}
              >
                {downloadBusy ? (
                  <LoaderCircle className="size-4 motion-safe:animate-spin" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Download className="size-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </>
          )}
        </div>
      </div>
      {audio && !locked && <Waveform seedKey={file.name} progress={progress} />}
      {message && (
        <p role="status" aria-live="polite" className="text-right text-[0.8125rem] text-[color:var(--bad-text)]">
          {message}
        </p>
      )}
    </li>
  );
}
