import { toast } from "sonner";

/* Change approvals (bookingFeatures.changeApproval): a booking mutation may
   come back as a proposal instead of an edit. Callers pass the result here
   first; when it was a proposal it says so and returns true, so the caller
   skips its usual "done" toast. */

export type MaybeProposal = { proposed?: boolean; approverName?: string } | null | undefined | void;

export function isProposal(res: MaybeProposal): res is { proposed: true; approverName: string } {
  return Boolean(res && typeof res === "object" && res.proposed === true);
}

export function proposalNotice(res: MaybeProposal): boolean {
  if (!isProposal(res)) return false;
  toast.success(`Change sent to ${res.approverName} for approval`);
  return true;
}
