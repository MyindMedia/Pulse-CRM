"use client";

import dynamic from "next/dynamic";

/* `next/dynamic` with `ssr: false` is not allowed inside a Server Component,
   so the lazy boundary lives here instead of in page.tsx. Keeping it lazy also
   keeps three.js out of the server bundle entirely - it is the largest thing on
   this page and nothing on the server has any use for it.

   The loading state is the same poster the reduced-motion and WebGL-failure
   paths use, so the hero is a picture of the app at every moment of its life,
   never an empty box. */
const Phone3D = dynamic(() => import("./phone-3d").then((m) => m.Phone3D), {
  ssr: false,
  loading: () => (
    <div className="rounded-[2.6rem] bg-obsidian p-[0.6rem] ring-1 ring-hairline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mobile/app-loop-poster.jpg"
        alt="My Studio Pulse open on an iPhone, showing a recording session with its booking details and actions"
        width={720}
        height={1564}
        className="block h-auto w-full rounded-[2.1rem]"
      />
    </div>
  ),
});

export function Phone3DMount() {
  return <Phone3D />;
}
