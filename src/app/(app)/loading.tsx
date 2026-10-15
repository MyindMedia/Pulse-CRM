import { PulseLoader } from "@/components/brand/pulse-loader";

/* Route transitions inside the app shell render this between navigation
   events. Always Pulse gold, whatever the studio is themed as. */
export default function AppLoading() {
  return <PulseLoader />;
}
