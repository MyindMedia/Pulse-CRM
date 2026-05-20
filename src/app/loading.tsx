import { PulseLoader } from "@/components/brand/pulse-loader";

/* Root-level route loader (sign-in, sign-up, /book, /onboard, /agency). */
export default function RootLoading() {
  return <PulseLoader message="One moment" />;
}
