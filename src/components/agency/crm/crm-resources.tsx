"use client";

import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/* Placeholder so the CRM page compiles. Another builder replaces this file,
   keeping the path and the export name and props. */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CrmResources(_props: { group: "campaigns" | "automations" | "forms" | "calls" | "more" | "settings" }) {
  return <EmptyState icon={Hammer} title="Coming in this build" description="This section of Zuops lands here." />;
}
