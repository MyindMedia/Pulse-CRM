/* The Functions catalog built from the operations registry. Imported only
   lazily (crm-functions.tsx `import()`), so the registry is its own chunk and
   never part of the agency shell or the first CRM paint (eval P-04). */

import { ZU_OPS } from "@convex/crm/ops.generated";
import { BODY_RULES, confirmKind, level, type ConfirmKind } from "@convex/crm/policy";
import type { CatalogEntry, CatalogKind } from "./functions-catalog";

/* The catalog's kind list must match the server's, both ways. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const KINDS_AGREE: Same<CatalogKind, ConfirmKind> = true;
void KINDS_AGREE;

export const CATALOG: CatalogEntry[] = Object.values(ZU_OPS).map((op) => ({
  id: op.id,
  method: op.method,
  path: op.path,
  area: op.area,
  summary: op.summary,
  scope: op.scope,
  level: level(op),
  kind: confirmKind(op),
  dependsOnBody: Object.prototype.hasOwnProperty.call(BODY_RULES, op.id),
}));
