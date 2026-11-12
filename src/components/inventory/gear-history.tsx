"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useCapabilities } from "@/lib/use-capabilities";

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * One item's label code and check-out history, inside the equipment dialog.
 * The plan says Pulse "keeps the history on the item" and lets a studio
 * "assign a label"; before this the web had neither (only the iPhone app read
 * the history, and nothing called assignCode). Renders nothing when the plan
 * does not include gear check-out.
 */
export function GearHistory({ equipmentId, barcode }: { equipmentId: Id<"equipment">; barcode?: string | null }) {
  const org = useQuery(api.orgs.current);
  const locked = org?.tierLockedFeatures ?? [];
  const available = org !== undefined && org !== null && !locked.includes("gearCheckout");
  const rows = useQuery(api.gearCheckout.history, available ? { equipmentId, limit: 20 } : "skip");
  const assignCode = useMutation(api.gearCheckout.assignCode);
  const { can } = useCapabilities();
  const [code, setCode] = React.useState(barcode ?? "");
  const [busy, setBusy] = React.useState(false);

  if (!available) return null;

  async function saveCode() {
    setBusy(true);
    try {
      const next = await assignCode({ equipmentId, code: code.trim() || undefined });
      setCode(next);
      toast.success(`Label code set to ${next}`);
    } catch (e) {
      toast.error((e as { data?: { message?: string } }).data?.message ?? "Could not set that label code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {can("equipment.edit") && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-steel">Label code</p>
          <div className="flex items-center gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Scan or type the code on its label, or leave empty to make one"
              aria-label="Label code"
            />
            <Button type="button" size="sm" variant="secondary" disabled={busy || (barcode ? code.trim() === barcode : false)} onClick={saveCode}>
              {code.trim() ? "Assign" : "Make one"}
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-steel">Check-out history</p>
        {rows === undefined ? null : rows.length === 0 ? (
          <p className="text-xs text-steel/70">Never checked out.</p>
        ) : (
          <ul className="divide-y divide-graphite/40 rounded-md border border-graphite/50">
            {rows.map((r) => (
              <li key={r._id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 truncate text-bone">{r.holderLabel}</span>
                <span className="shrink-0 text-steel/80">
                  {when(r.outAt)} {r.inAt ? `to ${when(r.inAt)}` : ""}
                </span>
                {r.inAt ? null : r.overdue ? <Badge tone="critical">Overdue</Badge> : <Badge tone="caution">Out</Badge>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
