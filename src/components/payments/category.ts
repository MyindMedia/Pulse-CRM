/* Visual mapping for invoice categories. Server derives the category
 * label from session.serviceType (with line-item fallback); the UI maps
 * each label to a tone + icon for quick scanning. */
import {
  Mic2,
  SlidersHorizontal,
  Sparkles,
  Music2,
  PenLine,
  ScrollText,
  MessageSquare,
  Coins,
  type LucideIcon,
} from "lucide-react";

type Tone = "neutral" | "gold" | "positive" | "caution" | "critical" | "info" | "solid";

export const CATEGORY_META: Record<
  string,
  { label: string; tone: Tone; icon: LucideIcon }
> = {
  "Studio time": { label: "Studio time", tone: "gold", icon: Mic2 },
  Production: { label: "Production", tone: "info", icon: Music2 },
  Mixing: { label: "Mixing", tone: "positive", icon: SlidersHorizontal },
  Mastering: { label: "Mastering", tone: "caution", icon: Sparkles },
  Writing: { label: "Writing", tone: "neutral", icon: PenLine },
  Consultation: { label: "Consultation", tone: "neutral", icon: MessageSquare },
  License: { label: "License", tone: "solid", icon: ScrollText },
  Other: { label: "Other", tone: "neutral", icon: Coins },
};

export function categoryMeta(label: string | undefined | null) {
  if (!label) return CATEGORY_META.Other;
  return CATEGORY_META[label] ?? CATEGORY_META.Other;
}
