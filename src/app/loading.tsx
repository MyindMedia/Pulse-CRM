import { PulseLoader } from "@/components/brand/pulse-loader";
import { BootChassis } from "@/components/shell/boot-chassis";
import { RouteLoaderSwitch } from "@/components/shell/route-loader-switch";

/* Root-level route loader. On the public routes (sign-in, sign-up, /book,
   /onboard, /agency): the Pulse logo drawing itself on a loop, like the iOS
   launch screen.

   On app routes this boundary is also what a cold load paints first, while
   the page streams in behind it. There it is the app's own chassis in the
   studio's cached colors (the same frame the session gate's BootShell fills
   next), so a cold load goes straight from nothing to the shell, never
   through a full-screen logo. Both are rendered here on the server; the
   switch only picks one by route, so the public pages load next to nothing
   extra for it. */
export default function RootLoading() {
  return <RouteLoaderSwitch app={<BootChassis />} other={<PulseLoader />} />;
}
