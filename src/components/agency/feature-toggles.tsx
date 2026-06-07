"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Switch } from "@/components/ui/toggle";
import { TOGGLEABLE_FEATURES } from "@/lib/features";

/** Per-sub-account nav feature toggles (agency console). `disabled` is the
 *  org's current disabledFeatures; toggling writes the full updated list. */
export function FeatureToggles({
  orgId,
  disabled,
}: {
  orgId: string;
  disabled: string[];
}) {
  const setFeatures = useMutation(api.agency.setFeatures);
  const [pending, setPending] = React.useState<string | null>(null);
  const off = new Set(disabled);

  async function toggle(key: string, label: string, enable: boolean) {
    const next = new Set(off);
    if (enable) next.delete(key);
    else next.add(key);
    setPending(key);
    try {
      await setFeatures({ orgId, disabledFeatures: [...next] });
      toast.success(`${label} ${enable ? "enabled" : "hidden"} for this studio.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update features.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {TOGGLEABLE_FEATURES.map((f) => {
        const enabled = !off.has(f.key);
        return (
          <label
            key={f.key}
            className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-coal-2 p-3 transition-colors hover:border-hairline-2"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-bone">{f.label}</span>
              <span className="block truncate text-xs text-ash-dim">{f.blurb}</span>
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => toggle(f.key, f.label, v)}
              disabled={pending === f.key}
              aria-label={`Toggle ${f.label}`}
            />
          </label>
        );
      })}
    </div>
  );
}
