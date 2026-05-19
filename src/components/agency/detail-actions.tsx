"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { ExternalLink, LogIn, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import type { SubStatus } from "@/components/agency/meta";

/** Prominent action row for the subaccount detail header. */
export function DetailActions({
  orgId,
  slug,
  status,
}: {
  orgId: string;
  slug: string;
  status: SubStatus;
}) {
  const router = useRouter();
  const setStatus = useMutation(api.agency.setStatus);
  const enterAs = useMutation(api.agency.enterAs);
  const [entering, setEntering] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);

  async function enter() {
    if (entering) return;
    setEntering(true);
    try {
      await enterAs({ orgId });
      router.push("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not enter the studio.");
      setEntering(false);
    }
  }

  async function toggleStatus() {
    if (toggling) return;
    const next: SubStatus = status === "active" ? "paused" : "active";
    setToggling(true);
    try {
      await setStatus({ orgId, status: next });
      toast.success(next === "active" ? "Subaccount activated." : "Subaccount paused.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => void enter()} disabled={entering}>
        {entering ? <Spinner className="text-gold-ink" /> : <LogIn />}
        Enter studio
      </Button>
      <Button variant="secondary" onClick={() => void toggleStatus()} disabled={toggling}>
        {toggling ? (
          <Spinner />
        ) : status === "active" ? (
          <Pause />
        ) : (
          <Play />
        )}
        {status === "active" ? "Pause" : "Activate"}
      </Button>
      <Button variant="outline" asChild>
        <a href={`/book/${slug}`} target="_blank" rel="noreferrer">
          <ExternalLink />
          Open booking page
        </a>
      </Button>
    </div>
  );
}
