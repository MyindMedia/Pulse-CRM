"use client";

import { cn } from "@/lib/utils";

/** The nine starting points for a post. "custom" starts blank; every other
 *  key both seeds the AI facts prompt and gates a later section of the
 *  composer (rate_promo/open_slot unlock the promo picker and a brand card,
 *  client_win unlocks the artist picker). */
export const TEMPLATES = [
  { key: "session_bts", label: "Session behind the scenes", hint: "A clip or photo from a session in progress" },
  { key: "before_after", label: "Before / after", hint: "Rough take vs final mix" },
  { key: "client_win", label: "Client win", hint: "Release day or a testimonial. Needs the artist's OK." },
  { key: "room_gear", label: "Room + gear", hint: "A room, a mic, a chain" },
  { key: "tip", label: "Tip", hint: "One thing you fix every week" },
  { key: "rate_promo", label: "Rate promo", hint: "A code with a window. Uses a brand card." },
  { key: "open_slot", label: "Open slot", hint: "A specific day and time that is free" },
  { key: "engineer_story", label: "Engineer story", hint: "Why this room, who runs it" },
  { key: "custom", label: "Custom", hint: "Start blank" },
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]["key"];

export function isTemplateKey(value: string | null | undefined): value is TemplateKey {
  return TEMPLATES.some((t) => t.key === value);
}

export function TemplatePicker({
  value,
  onPick,
  disabled,
}: {
  value: TemplateKey | null;
  onPick: (key: TemplateKey) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {TEMPLATES.map((t) => (
        <button
          key={t.key}
          type="button"
          disabled={disabled}
          onClick={() => onPick(t.key)}
          className={cn(
            "rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            value === t.key
              ? "border-gold bg-gold/10"
              : "border-graphite/50 bg-coal-2 hover:border-gold-dim/60 hover:bg-coal-3/60",
          )}
        >
          <div className="font-grotesk text-sm font-semibold text-bone">{t.label}</div>
          <div className="mt-0.5 text-xs text-steel/70">{t.hint}</div>
        </button>
      ))}
    </div>
  );
}
