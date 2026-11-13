import * as React from "react";
import { WAVE_BARS, seedFor, waveHeights } from "./format";

/** The decorative strip under an audio row. Deterministic from the file, so it
 *  never jumps between renders; bars up to `progress` take the studio accent.
 *  Hidden from assistive technology: the play button carries the meaning. */
export function Waveform({ seedKey, progress }: { seedKey: string; progress: number | null }) {
  const heights = React.useMemo(() => waveHeights(seedFor(seedKey)), [seedKey]);
  const lit = progress === null ? 0 : Math.round(Math.max(0, Math.min(1, progress)) * WAVE_BARS);
  return (
    <div className="flex h-7 items-center gap-0.5" aria-hidden="true">
      {heights.map((h, i) => (
        <i
          key={i}
          className={
            i < lit
              ? "min-w-px flex-1 rounded-[1px] bg-[var(--studio)]"
              : "min-w-px flex-1 rounded-[1px] bg-steel opacity-45"
          }
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}
