"use client";

import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/* Placeholder so the CRM page compiles. Another builder replaces this file,
   keeping the path and the export name and props. */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CrmCalendar(_props: { bookLeadId?: string | null }) {
  return <EmptyState icon={Hammer} title="Coming in this build" description="The Calendar lands here: appointments, open slots and booking." />;
}
