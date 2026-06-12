"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Rocket, ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** "Stage for onboarding" - the hand-off moment after a deal closes.
 *  Wipes every demo row, keeps the branded configuration (logo, colors,
 *  rooms, team), and resets the onboarding flag so the new owner's first
 *  login walks the premium /welcome wizard on a clean slate.
 *  Two-stage confirmation: review what happens, then type the slug. */
export function StageOnboardingButton({
  orgId,
  slug,
  name,
}: {
  orgId: string;
  slug: string;
  name: string;
}) {
  const status = useQuery(api.demoMode.status, { orgId });
  const stage = useMutation(api.demoMode.stageForOnboarding);
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2>(1);
  const [confirmText, setConfirmText] = React.useState("");
  const [pending, setPending] = React.useState(false);

  const rowCount = status?.demoRowCount ?? 0;
  const confirmed = confirmText.trim().toLowerCase() === slug.toLowerCase();

  function reset(openNext: boolean) {
    setOpen(openNext);
    if (!openNext) {
      setStep(1);
      setConfirmText("");
    }
  }

  async function run() {
    if (!confirmed || pending) return;
    setPending(true);
    try {
      const res = await stage({ orgId });
      toast.success(
        `${name} is staged for onboarding - ${res.removed} demo rows cleared. The owner's first login starts the welcome experience.`,
      );
      reset(false);
    } catch (err) {
      toast.error(
        err instanceof ConvexError ? String(err.data) : "Could not stage the account.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-md border border-graphite/50 bg-coal-2 p-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-bone">Stage for onboarding</span>
          <span className="block text-xs text-steel/70">
            Deal closed? Clear the demo data and hand the owner a clean, fully branded
            account that opens with the welcome onboarding on first login.
          </span>
        </span>
        <Button variant="outline" size="sm" onClick={() => reset(true)}>
          <Rocket className="size-4" />
          Stage
        </Button>
      </div>

      <Dialog open={open} onOpenChange={reset}>
        <DialogContent className="max-w-md">
          {step === 1 ? (
            <>
              <DialogHeader>
                <DialogTitle>Stage {name} for onboarding</DialogTitle>
                <DialogDescription>
                  This prepares the account for its real owner.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-3 text-sm">
                <div className="rounded-md border border-critical/30 bg-critical/10 px-3.5 py-3">
                  <p className="font-medium text-bone">Deleted - cannot be undone</p>
                  <p className="mt-1 text-xs text-steel">
                    All {rowCount} demo rows: sample clients, songs, sessions, payments,
                    invoices, pipeline deals, insights and activity.
                  </p>
                </div>
                <div className="rounded-md border border-positive/30 bg-positive/10 px-3.5 py-3">
                  <p className="font-medium text-bone">Kept</p>
                  <p className="mt-1 text-xs text-steel">
                    Branding (logo, colors, hero), rooms and photos, real team members,
                    booking page copy and Stripe configuration.
                  </p>
                </div>
                <div className="rounded-md border border-graphite/50 bg-coal-2 px-3.5 py-3">
                  <p className="font-medium text-bone">Then</p>
                  <p className="mt-1 text-xs text-steel">
                    Onboarding resets - the owner&apos;s first login opens the premium
                    welcome wizard to finish setup on a clean slate.
                  </p>
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => reset(false)}>
                  Cancel
                </Button>
                <Button onClick={() => setStep(2)}>Continue</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-critical" />
                  Confirm the hand-off
                </DialogTitle>
                <DialogDescription>
                  Type the studio slug to permanently clear {rowCount} demo rows.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Field label={`Type "${slug}" to confirm`} htmlFor="stage-confirm">
                  <Input
                    id="stage-confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={slug}
                    autoComplete="off"
                  />
                </Field>
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button disabled={!confirmed || pending} onClick={() => void run()}>
                  {pending ? "Staging…" : "Clear demo data and stage"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
