"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Crown, FileMinus, ScrollText, Wallet } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { meta, LICENSE_TIER } from "@/lib/labels";
import { compactNumber, money, relativeTime } from "@/lib/format";
import { SellLicenseDialog } from "./sell-license-dialog";
import type { BeatLicense } from "./types";

/** Confirm + run deactivation for a single license row. */
function DeactivateAction({ license }: { license: BeatLicense }) {
  const deactivate = useMutation(api.licensing.deactivateLicense);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  async function handle() {
    setWorking(true);
    try {
      await deactivate({ id: license._id });
      toast.success("License deactivated.");
      setOpen(false);
    } catch {
      toast.error("Could not deactivate that license.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="ghost"
        className="text-critical hover:bg-critical/10 hover:text-critical"
        onClick={() => setOpen(true)}
      >
        <FileMinus className="size-3.5" />
        Deactivate
      </Button>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Deactivate license</DialogTitle>
          <DialogDescription>
            Deactivate the {meta(LICENSE_TIER, license.tier).label} sold to{" "}
            {license.buyerName} on “{license.songTitle}”? The sale stays on
            record - it just stops counting as active.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={working}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={handle} disabled={working}>
            {working ? (
              <>
                <Spinner /> Deactivating…
              </>
            ) : (
              "Deactivate"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The full beat-license ledger with summary tiles. */
export function LicenseTable() {
  const licenses = useQuery(api.licensing.allLicenses) as BeatLicense[] | undefined;

  const sorted = useMemo(
    () => (licenses ? [...licenses].sort((a, b) => b.soldAt - a.soldAt) : undefined),
    [licenses],
  );

  const summary = useMemo(() => {
    if (!licenses) return null;
    return {
      revenue: licenses.reduce((acc, l) => acc + l.priceCents, 0),
      active: licenses.filter((l) => l.active).length,
      exclusives: licenses.filter((l) => l.tier === "exclusive").length,
    };
  }, [licenses]);

  return (
    <div className="space-y-5">
      {/* Summary tiles */}
      {!summary ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="License revenue"
            value={money(summary.revenue, { compact: true })}
            icon={Wallet}
            accent
            hint="all sales, lifetime"
          />
          <StatTile label="Active licenses" value={String(summary.active)} icon={ScrollText} />
          <StatTile label="Exclusives sold" value={String(summary.exclusives)} icon={Crown} />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="overline">License ledger</p>
        <SellLicenseDialog />
      </div>

      {/* Table */}
      {sorted === undefined ? (
        <div className="skeleton h-72 w-full rounded-lg" />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No licenses sold yet"
          description="Record a beat license sale and it shows up here with full terms and revenue."
          action={<SellLicenseDialog />}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Beat</TH>
              <TH>Buyer</TH>
              <TH>Tier</TH>
              <TH className="text-right">Price</TH>
              <TH className="text-right">Term</TH>
              <TH className="text-right">Stream cap</TH>
              <TH>State</TH>
              <TH>Sold</TH>
              <TH className="text-right">Action</TH>
            </TR>
          </THead>
          <TBody>
            {sorted.map((license) => {
              const tier = meta(LICENSE_TIER, license.tier);
              return (
                <TR key={license._id} className={license.active ? undefined : "opacity-60"}>
                  <TD className="font-medium">{license.songTitle}</TD>
                  <TD className="text-steel">{license.buyerName}</TD>
                  <TD>
                    <Badge tone={tier.tone}>{tier.label}</Badge>
                  </TD>
                  <TD className="text-right font-meta text-gold">{money(license.priceCents)}</TD>
                  <TD className="text-right font-meta text-steel">
                    {license.termMonths ? `${license.termMonths} mo` : "-"}
                  </TD>
                  <TD className="text-right font-meta text-steel">
                    {license.streamCap !== undefined
                      ? compactNumber(license.streamCap)
                      : "Unlimited"}
                  </TD>
                  <TD>
                    {license.active ? (
                      <Badge tone="positive">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </TD>
                  <TD className="font-meta text-xs text-steel/70">
                    {relativeTime(license.soldAt)}
                  </TD>
                  <TD className="text-right">
                    {license.active ? (
                      <DeactivateAction license={license} />
                    ) : (
                      <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                        -
                      </span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
