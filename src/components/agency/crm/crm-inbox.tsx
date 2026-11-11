"use client";

import { Hammer } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

/* Placeholder so the CRM page compiles. Another builder replaces this file,
   keeping the path and the export name and props. */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CrmInbox(_props: { openLeadId?: string | null }) {
  return <EmptyState icon={Hammer} title="Coming in this build" description="The Inbox lands here: conversations, threads, send and schedule." />;
}
