"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { ArrowLeft, Printer, Tags } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { GearLabel } from "@/components/inventory/gear-label";

export default function GearLabelsPage() {
  const org = useQuery(api.orgs.current);
  const available = org !== undefined && org !== null && !(org.tierLockedFeatures ?? []).includes("gearCheckout");
  const labels = useQuery(api.gearCheckout.labels, available ? {} : "skip");
  const assign = useMutation(api.gearCheckout.assignMissingCodes);
  const [busy, setBusy] = React.useState(false);

  async function generate() {
    setBusy(true);
    try {
      const { assigned } = await assign({});
      toast.success(assigned ? `${assigned} new ${assigned === 1 ? "code" : "codes"} created` : "Every item already has a code");
    } catch {
      toast.error("Could not create codes. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Print only the sheet: hide the app chrome. */}
      <style>{`@media print {
        aside, nav, header, [data-print-hide] { display: none !important; }
        body, main { background: #fff !important; }
        .gear-sheet { grid-template-columns: repeat(3, 1fr) !important; gap: 6mm !important; }
        @page { margin: 10mm; }
      }`}</style>
      <div data-print-hide>
        <PageHeader
          overline="Assets"
          title="Gear labels"
          description="Print a QR and bar code for each piece of gear. Stick them on, then scan to check gear in and out."
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" asChild><Link href="/inventory"><ArrowLeft className="size-4" /> Inventory</Link></Button>
              <Button variant="ghost" onClick={generate} disabled={busy || !available}>
                <Tags className="size-4" /> Create missing codes
              </Button>
              <Button onClick={() => window.print()} disabled={!labels?.length}>
                <Printer className="size-4" /> Print
              </Button>
            </div>
          }
        />
      </div>
      {!available && org !== undefined ? (
        <EmptyState icon={Tags} title="Gear labels are not available here" description="This workspace does not include gear check-out." />
      ) : labels && labels.length === 0 ? (
        <div data-print-hide>
          <EmptyState icon={Tags} title="No labels yet" description="Create codes for your gear, then print the sheet." />
        </div>
      ) : (
        <div className="gear-sheet grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(labels ?? []).map((l) => (
            <GearLabel key={l.equipmentId} name={l.name} code={l.barcode} />
          ))}
        </div>
      )}
    </div>
  );
}
