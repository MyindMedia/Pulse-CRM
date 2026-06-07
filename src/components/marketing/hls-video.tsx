"use client";

import * as React from "react";

/* Default background loop. Swap to a self-hosted file (e.g. "/bg-loop.webm")
   once the generated Seedance/Higgsfield loop lands in /public; .m3u8 sources
   stream via hls.js, anything else is set as a direct video src. */
const DEFAULT_SRC =
  "https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8";

/** Decorative looping background video. Streams HLS via hls.js (dynamic import,
 *  enableWorker:false for sandboxed stability) with a native-HLS fallback for
 *  Safari/iOS; plays a plain file src directly. Muted, looping, aria-hidden. */
export function HlsVideo({
  src = DEFAULT_SRC,
  className,
  style,
}: {
  src?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const isHls = src.endsWith(".m3u8");
    // Plain file, or native HLS (Safari/iOS): point the element straight at it.
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      return;
    }

    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      const instance = new Hls({ enableWorker: false });
      instance.loadSource(src);
      instance.attachMedia(video);
      hls = instance;
    });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  return (
    <video
      ref={ref}
      className={className}
      style={style}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}
