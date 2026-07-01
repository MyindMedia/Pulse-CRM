import type { MetadataRoute } from "next";

/* PWA manifest - makes Pulse installable to a phone home screen (Add to Home
   Screen -> launches standalone into the operator home). Colors track the dark
   + gold app theme (see globals.css: --color-ink #08080a, --color-gold #fdb913).

   NOTE: full web push (VAPID keys + a push-subscription table) is a follow-up -
   it needs a schema change, which is out of scope here. This ships
   installability only.

   NOTE: the referenced icon (badge-pulse.png) is the best existing brand mark
   in public/; a dedicated square 192/512 maskable icon is a follow-up. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pulse - Studio Management",
    short_name: "Pulse",
    description:
      "Recording studio management with a built-in AI manager: bookings, scheduling, inventory, splits, and invoicing.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#08080a",
    theme_color: "#08080a",
    icons: [
      {
        src: "/badge-pulse.png",
        sizes: "any",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
