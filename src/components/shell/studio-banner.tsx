"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Eye, LogOut } from "lucide-react";
import { Spinner } from "@/components/ui/feedback";

const DEMO_ORG_ID = "pulse-demo";

/** Thin "entered as" strip - shown when the active workspace is a real
    studio subaccount the agency operator stepped into. */
export function StudioBanner() {
  const router = useRouter();
  const org = useQuery(api.orgs.current);
  const enterAs = useMutation(api.agency.enterAs);
  const [exiting, setExiting] = React.useState(false);

  if (!org || org.orgId === DEMO_ORG_ID) return null;

  async function exit() {
    if (exiting) return;
    setExiting(true);
    try {
      await enterAs({});
      router.push("/agency");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not exit to the agency console.");
      setExiting(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-gold-dim/40 bg-gold/[0.08] px-4 py-2 lg:px-6">
      <Eye className="size-4 shrink-0 text-gold" />
      <p className="min-w-0 truncate text-xs text-bone">
        Viewing <span className="font-semibold text-gold-bright">{org.name}</span> as client — edits save to their studio
      </p>
      <button
        onClick={() => void exit()}
        disabled={exiting}
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-gold-dim/60 bg-gold/10 px-2.5 text-[0.6875rem] font-medium text-gold-bright transition-colors hover:bg-gold/20 disabled:opacity-50"
      >
        {exiting ? <Spinner className="size-3 text-gold-bright" /> : <LogOut className="size-3" />}
        Exit to agency
      </button>
    </div>
  );
}
