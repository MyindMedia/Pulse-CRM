import { PulseLoader } from "@/components/brand/pulse-loader";

/* Route transitions inside the app shell render this between
   navigation events. The PulseLoader is on-brand and animated. */
export default function AppLoading() {
  return <PulseLoader message="Loading the studio" />;
}
