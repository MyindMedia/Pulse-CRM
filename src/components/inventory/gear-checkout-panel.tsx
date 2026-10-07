"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ScanLine, Tags, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/feedback";
import { GearScanDialog } from "./gear-scan-dialog";

/**
 * "Who has what" and "overdue" for checked-out gear, plus the scan button and
 * the link to the label sheet. Renders nothing when the studio's plan does not
 * include gear check-out (the sidebar already shows what is locked).
 */
export function GearCheckoutPanel() {
  const org = useQuery(api.orgs.current);
  const locked = org?.tierLockedFeatures ?? [];
  const available = org !== undefined && org !== null && !locked.includes("gearCheckout");
  const out = useQuery(api.gearCheckout.listOut, available ? {} : "skip");
  const checkIn = useMutation(api.gearCheckout.checkIn);
  const [scanOpen, setScanOpen] = React.useState(false);
  const [onlyLate, setOnlyLate] = React.useState(false);

  if (!available) return null;

  const rows = (out ?? []).filter((r) => !onlyLate || r.overdue);
  const lateCount = (out ?? []).filter((r) => r.overdue).length;

  async function giveBack(id: Id<"equipment">, name: string) {
    try {
      await checkIn({ equipmentId: id });
      toast.success(`${name} checked in`);
    } catch (e) {
      toast.error((e as { data?: { message?: string } }).data?.message ?? "Could not check that in.");
    }
  }

  return (
    <section aria-labelledby="gear-out-title" className="space-y-3 rounded-lg border border-hairline p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="gear-out-title" className="text-base font-semibold text-bone">Gear checked out</h2>
          {lateCount > 0 && <Badge tone="critical">{lateCount} overdue</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {lateCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setOnlyLate((v) => !v)} aria-pressed={onlyLate}>
              {onlyLate ? "Show all" : "Overdue only"}
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link href="/inventory/labels"><Tags className="size-4" /> Labels</Link>
          </Button>
          <Button size="sm" onClick={() => setScanOpen(true)}>
            <ScanLine className="size-4" /> Scan gear
          </Button>
        </div>
      </div>

      {out === undefined ? null : rows.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title={onlyLate ? "Nothing is overdue" : "Everything is on the shelf"}
          description="Scan a label to check gear out to a person, client, session or rental."
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-bone">{r.equipmentName}</p>
                <p className="text-xs text-steel">
                  {r.holderLabel} · out {new Date(r.outAt).toLocaleDateString()}
                  {r.dueAt ? ` · due ${new Date(r.dueAt).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.overdue && <Badge tone="critical">Overdue</Badge>}
                <Button size="sm" variant="ghost" onClick={() => giveBack(r.equipmentId, r.equipmentName)}>Check in</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <GearScanDialog open={scanOpen} onOpenChange={setScanOpen} />
    </section>
  );
}
