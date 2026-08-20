"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { GraduationCap, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLAN_LIMITS, SELLABLE_TIERS, priceLabel } from "@convex/lib/plans";

/** Only the four sellable tiers can be graduated onto. Legacy and
 *  enterprise tiers are assigned by hand, not from this control. */
type SellableTier = "flow" | "studio" | "pro" | "label";

/* Moving a beta studio onto normal terms.

   Nothing migrates. A beta workspace is already a real studio with real
   bookings and real clients; graduating changes its tier and its status and
   leaves every row exactly where it is. Saying that on the card matters,
   because "graduate" sounds like it might move something. */

export function GraduateBeta({
  orgId,
  name,
  betaCohort,
  graduatedAt,
  currentTier,
}: {
  orgId: string;
  name: string;
  betaCohort?: boolean;
  graduatedAt?: number | null;
  currentTier?: string | null;
}) {
  const graduate = useMutation(api.agency.graduateBeta);
  const revert = useMutation(api.agency.revertGraduation);
  const [tier, setTier] = React.useState<SellableTier>("pro");
  const [busy, setBusy] = React.useState(false);

  if (!betaCohort) return null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const d = (e as { data?: string | { message?: string } })?.data;
      toast.error(typeof d === "string" ? d : d?.message ?? "That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <GraduationCap className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-grotesk text-sm font-semibold text-bone">Beta cohort</span>
              {graduatedAt ? (
                <Badge tone="positive">Graduated</Badge>
              ) : (
                <Badge tone="gold">On beta terms</Badge>
              )}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-steel">
              {graduatedAt
                ? `${name} moved onto normal terms on ${new Date(graduatedAt).toLocaleDateString()}. Currently on ${currentTier ?? "an unset tier"}.`
                : `${name} came in through an early-access invite. Graduating sets their plan and switches the workspace to active. Nothing moves and nothing is copied - every booking, client and invoice stays exactly where it is.`}
            </p>
          </div>
        </div>

        {graduatedAt ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => revert({ orgId }), "Back on beta terms.")}
          >
            <Undo2 className="mr-1.5 size-3.5" />
            Put back on beta terms
          </Button>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="font-meta text-[0.65rem] uppercase tracking-[0.08em] text-steel">
                Graduate onto
              </span>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as SellableTier)}
                className="mt-1 rounded-md border border-graphite/60 bg-coal/40 px-3 py-2 text-sm text-bone outline-none focus:border-gold"
              >
                {(SELLABLE_TIERS as SellableTier[]).map((t) => (
                  <option key={t} value={t}>
                    {PLAN_LIMITS[t].label} · {priceLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(
                  () => graduate({ orgId, tier }),
                  `${name} graduated onto ${PLAN_LIMITS[tier].label}.`,
                )
              }
            >
              <GraduationCap className="mr-1.5 size-3.5" />
              {busy ? "Working…" : "Graduate"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
