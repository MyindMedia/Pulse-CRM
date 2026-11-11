/* The Functions catalog built from the operations registry. Imported only
   lazily (crm-functions.tsx `import()`), so the registry is its own chunk and
   never part of the agency shell or the first CRM paint (eval P-04). */

import { ZU_OPS } from "@convex/crm/ops.generated";
import { confirmKind, level } from "@convex/crm/policy";
import type { CatalogEntry } from "./functions-catalog";

export const CATALOG: CatalogEntry[] = Object.values(ZU_OPS).map((op) => ({
  id: op.id,
  method: op.method,
  path: op.path,
  area: op.area,
  summary: op.summary,
  scope: op.scope,
  level: level(op),
  kind: confirmKind(op),
}));
