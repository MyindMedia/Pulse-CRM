import { PulseLoader } from "@/components/brand/pulse-loader";

/* Root-level route loader (sign-in, sign-up, /book, /onboard, /agency):
   the Pulse logo drawing itself on a loop, like the iOS launch screen. */
export default function RootLoading() {
  return <PulseLoader />;
}
