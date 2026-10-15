"use client";

import { PageHeader } from "@/components/ui/page";
import { FeatureRequestsPanel } from "@/components/feature-requests/feature-board";

/* The feature request board for everyone in a studio. Settings is limited to
 * people who can edit branding, so engineers and interns reach the same form
 * and board here, from the profile menu. */
export default function FeatureRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        overline="Pulse"
        title="Feature requests"
        description="Ask for what would make Pulse better for your studio, and vote for what you want built next."
      />
      <FeatureRequestsPanel />
    </div>
  );
}
