"use client";

import * as React from "react";

const STREAM =
  "https://stream.mux.com/tLkHO1qZoaaQOUeVWo8hEBeGQfySP02EPS02BmnNFyXys.m3u8";

/** Full-bleed HLS background video for the hero. Uses native HLS on Safari/iOS
 *  and falls back to hls.js elsewhere with enableWorker:false for stability in
 *  sandboxed environments. hls.js is dynamically imported so it stays out of
 *  the main bundle. Decorative only (muted, looping, aria-hidden). */
export function HeroVideo({ className }: { className?: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const video = ref.current;
    if (!video) return;

    // Native HLS (Safari, iOS): point the element straight at the stream.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = STREAM;
      return;
    }

    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      const instance = new Hls({ enableWorker: false });
      instance.loadSource(STREAM);
      instance.attachMedia(video);
      hls = instance;
    });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, []);

  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden
    />
  );
}
