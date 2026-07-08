import type { MetadataRoute } from "next";

/* PWA manifest - makes Pulse installable to a phone home screen (Add to Home
   Screen -> launches standalone into the operator home). Colors track the dark
   + gold app theme (see globals.css: --color-ink #08080a, --color-gold #fdb913).

   NOTE: full web push (VAPID keys + a push-subscription table) is a follow-up -
   it needs a schema change, which is out of scope here. This ships
   installability only. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pulse - Studio Management",
    short_name: "Pulse",
    description:
      "Recording studio management with a built-in AI manager: bookings, scheduling, inventory, splits, and invoicing.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#08080a",
    theme_color: "#08080a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
