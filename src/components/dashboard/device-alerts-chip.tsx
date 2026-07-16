"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { BellRing, Check } from "lucide-react";
import { pushSupported, currentEndpoint, enableDeviceAlerts } from "@/lib/push";
import { cn } from "@/lib/utils";

/* The "enable device alerts" affordance in the prep widgets' headers. Shows
   only where push is supported; flips to a quiet check once this device is
   registered. Alerts fire from the T-10 cron (arrivals, wrap-up, shift
   change, studio refresh) with the device's own sound + haptics. */

export function DeviceAlertsChip() {
  const vapidKey = useQuery(api.push.publicKey);
  const subscribeMutation = useMutation(api.push.subscribe);

  const [supported, setSupported] = React.useState(false);
  const [endpoint, setEndpoint] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setSupported(pushSupported());
    void currentEndpoint().then(setEndpoint);
  }, []);

  const registered = useQuery(api.push.isSubscribed, endpoint ? { endpoint } : { endpoint: undefined });

  if (!supported || !vapidKey) return null;

  if (endpoint && registered) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/5 px-2 py-0.5 text-[0.625rem] font-medium text-positive"
        title="This device gets studio alerts"
      >
        <Check className="size-3" strokeWidth={3} />
        Alerts on
      </span>
    );
  }

  async function enable() {
    if (busy || !vapidKey) return;
    setBusy(true);
    try {
      const sub = await enableDeviceAlerts(vapidKey);
      await subscribeMutation(sub);
      setEndpoint(sub.endpoint);
      toast.success("Device alerts on - arrivals, wrap-ups and shift changes will ping this device.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not enable alerts on this device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5",
        "text-[0.6875rem] font-medium text-gold transition-colors hover:bg-gold/15",
      )}
    >
      <BellRing className="size-3" />
      {busy ? "Enabling..." : "Enable device alerts"}
    </button>
  );
}
