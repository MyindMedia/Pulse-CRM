"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Switch } from "@/components/ui/toggle";

/** Demo/Live data control for a sub-account (agency console detail page).
 *  ON fills the account with sample data; OFF wipes every demo row and
 *  leaves the studio's real configuration untouched. */
export function DemoModeToggle({ orgId }: { orgId: string }) {
  const status = useQuery(api.demoMode.status, { orgId });
  const setDemoMode = useMutation(api.demoMode.setDemoMode);
  const [pending, setPending] = React.useState(false);

  const loaded = status !== undefined;
  const on = status?.demoMode ?? false;

  async function toggle(demo: boolean) {
    if (pending || !loaded) return;
    if (!demo) {
      const ok = window.confirm(
        `Switch off demo data? This deletes every demo row (${status.demoRowCount}) and can't be undone. The studio's real configuration stays untouched.`,
      );
      if (!ok) return;
    }
    setPending(true);
    try {
      await setDemoMode({ orgId, demo });
      toast.success(
        demo
          ? "Demo data loaded - this account is walkthrough-ready."
          : "Demo data wiped - the studio has a fresh start.",
      );
    } catch (err) {
      toast.error(
        err instanceof ConvexError ? String(err.data) : "Could not update demo data.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-graphite/50 bg-coal-2 p-3 transition-colors hover:border-graphite/60">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-bone">Demo data</span>
        <span className="block text-xs text-steel/70">
          {on
            ? `Demo data is live (${status?.demoRowCount ?? 0} rows). Switching off deletes every demo row and leaves the studio's real configuration untouched - a fresh start.`
            : "Fill this account with sample clients, bookings and invoices for a walkthrough."}
        </span>
      </span>
      <Switch
        checked={on}
        onCheckedChange={(v) => void toggle(v)}
        disabled={pending || !loaded}
        aria-label="Toggle demo data"
      />
    </label>
  );
}
