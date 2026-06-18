"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Pencil, Trash2, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  softwareCategoryMeta,
  SOFTWARE_STATUS,
  INTERVAL_SUFFIX,
} from "./constants";

export type SoftwareRow = {
  _id: Id<"softwareLicenses">;
  name: string;
  vendor?: string;
  category: string;
  licenseType: string;
  seats?: number;
  costCents: number;
  billingInterval: string;
  renewalDate?: number;
  licenseKey?: string;
  seatHolder?: string;
  status: string;
  notes?: string;
};

export function SoftwareTable({
  items,
  loading,
  filtering,
  onEdit,
}: {
  items: SoftwareRow[];
  loading: boolean;
  filtering: boolean;
  onEdit: (s: SoftwareRow) => void;
}) {
  const remove = useMutation(api.software.remove);
  // Lazy state init keeps Date.now() out of the render path (purity rule);
  // declared before any early return so the hook order stays stable.
  const [now] = React.useState(() => Date.now());

  async function del(s: SoftwareRow) {
    if (!window.confirm(`Remove ${s.name} from software inventory?`)) return;
    try {
      await remove({ id: s._id });
      toast.success(`${s.name} removed.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove.");
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-graphite/60 py-10 text-center text-sm text-steel/70">
        {filtering ? "No software for the current filters." : "No software tracked yet."}
      </p>
    );
  }

  const soon = now + 30 * 86_400_000;

  return (
    <div className="overflow-x-auto rounded-lg border border-graphite/50">
      <table className="w-full min-w-[60rem] text-sm">
        <thead>
          <tr className="border-b border-graphite/50 bg-coal-2 text-left text-[0.6875rem] uppercase tracking-wide text-steel/70">
            <th className="px-3 py-2 font-medium">Software</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 text-center font-medium">Seats</th>
            <th className="px-3 py-2 font-medium">Renewal</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => {
            const cat = softwareCategoryMeta(s.category);
            const st = SOFTWARE_STATUS[s.status] ?? { label: s.status, tone: "neutral" as const };
            const renewSoon = s.renewalDate && s.renewalDate <= soon && s.status === "active";
            const renewPast = s.renewalDate && s.renewalDate < now;
            return (
              <tr
                key={s._id}
                onClick={() => onEdit(s)}
                className="cursor-pointer border-b border-graphite/60 last:border-0 transition-colors duration-150 hover:bg-coal-2/60"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <cat.icon className="size-4 shrink-0 text-steel/70" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-bone">{s.name}</p>
                      <p className="truncate text-[0.6875rem] text-steel/70">
                        {s.vendor ?? "—"}
                        {s.licenseKey ? <KeyRound className="ml-1 inline size-3 text-steel/70" /> : null}
                        {s.seatHolder ? ` · ${s.seatHolder}` : ""}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-steel">{cat.label}</td>
                <td className="px-3 py-2.5 capitalize text-steel">{s.licenseType}</td>
                <td className="px-3 py-2.5 text-right font-meta text-bone">
                  {money(s.costCents)}
                  <span className="text-steel/70">{INTERVAL_SUFFIX[s.billingInterval] ?? ""}</span>
                </td>
                <td className="px-3 py-2.5 text-center text-steel">{s.seats ?? "—"}</td>
                <td className={cn("px-3 py-2.5 font-meta text-xs", renewPast ? "text-critical" : renewSoon ? "text-caution" : "text-steel/70")}>
                  {s.renewalDate ? shortDate(s.renewalDate) : "—"}
                </td>
                <td className="px-3 py-2.5"><Badge tone={st.tone} dot>{st.label}</Badge></td>
                <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => onEdit(s)} aria-label={`Edit ${s.name}`}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => del(s)} aria-label={`Remove ${s.name}`}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
