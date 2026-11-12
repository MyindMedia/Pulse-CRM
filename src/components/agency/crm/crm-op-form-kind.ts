/* Why an operation needs a confirm, straight from the server's own policy
   (convex/crm/policy.ts), for a given body. This file pulls in the operations
   registry, so the resource screens load it only with import() when an action
   is about to run; it never sits in the first CRM paint (eval P-04). */

import { ZU_OPS } from "@convex/crm/ops.generated";
import { BODY_RULES, confirmKind, type ConfirmKind } from "@convex/crm/policy";

export type { ConfirmKind };

/** The confirm kind for this operation and body. An unknown operation fails
 *  closed as "reaches", the same way the server treats an unclassified write. */
export function kindFor(opId: string, body?: unknown): ConfirmKind | null {
  const op = Object.prototype.hasOwnProperty.call(ZU_OPS, opId) ? ZU_OPS[opId] : undefined;
  if (!op) return "reaches";
  return confirmKind(op, body);
}

/** True when the kind can change with the body (create_lead with run_intake, a
 *  Google post with approve, an optimizer run without dry_run, and so on). */
export function dependsOnBody(opId: string): boolean {
  return Object.prototype.hasOwnProperty.call(BODY_RULES, opId);
}
