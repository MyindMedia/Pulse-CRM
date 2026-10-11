import type { Doc } from "@convex/_generated/dataModel";
import { draftCheckBadge, type DraftBadgeKind } from "@convex/lib/jev/draftCheck";
import { Badge } from "@/components/ui/badge";

const TONE: Record<DraftBadgeKind, "positive" | "caution" | "critical" | "neutral"> = {
  ready: "positive",
  money: "caution",
  placeholder: "critical",
  review: "neutral",
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Jev's (TypeSafe) read on an agent's email draft, as one small badge.
 *  Renders nothing when the draft was not checked, so the card looks as it
 *  always has. A label only: approve, dismiss and snooze work the same. */
export function DraftCheckBadge({ check }: { check: Doc<"opsActions">["draftCheck"] }) {
  const badge = draftCheckBadge(check);
  if (!badge || !check) return null;
  return (
    <Badge
      tone={TONE[badge.kind]}
      title={`AI check of this draft: ready to send ${pct(check.safeToSend)}, mentions money ${pct(check.mentionsMoney)}, placeholders ${pct(check.hasPlaceholder)}. Nothing sends until you approve.`}
    >
      <span className="sr-only">AI check: </span>
      {badge.label}
    </Badge>
  );
}
