import { Coins, Share2, Trash2, Users, Zap } from "lucide-react";
import type { CatalogKind } from "./functions-catalog";

/* The icon beside each confirm kind's word ("Uses credits", "Deletes", ...).
   Always shown next to the word, never alone. */

const ICON = { reaches: Users, changes_sending: Zap, spends: Coins, exposes: Share2, delete: Trash2 } as const;

export function KindIcon({ kind, className = "size-3" }: { kind: CatalogKind; className?: string }) {
  const Icon = ICON[kind];
  return <Icon className={className} aria-hidden />;
}
