"use client";

import { PageHeader } from "@/components/ui/page";
import { FeatureBoard } from "@/components/feature-requests/feature-board";

/* The platform owner's view of the feature request board: who asked, and the
   controls to set a status, tidy the wording or merge a duplicate. */
export default function AgencyFeatureRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        overline="Agency"
        title="Feature requests"
        description="Every studio's requests in one list. Set a status so people can see what is coming, and merge duplicates so the votes add up."
      />
      <FeatureBoard admin />
    </div>
  );
}
