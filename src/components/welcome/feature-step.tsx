"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "@convex/_generated/api";
import { Lock } from "lucide-react";
import { Switch } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ClockInPreview, PatchPreview, RemindersPreview, ReceptionistPreview,
} from "@/components/welcome/feature-previews";

/* "Switch on what you use" - the last setup step.

   These four are the features owners never find on their own, so this is the
   one place they get shown. Every switch writes real configuration through
   onboarding.setFeaturePrefs; nothing here is a preference that gets applied
   later. Anything the plan does not include shows locked with its tier rather
   than being hidden, because knowing it exists is the point. */

type Key = "timeClock" | "patch" | "clientReminders" | "receptionist";

const CARDS: {
  key: Key;
  title: string;
  blurb: string;
  Preview: (p: { active: boolean }) => React.JSX.Element;
}[] = [
  {
    key: "timeClock",
    title: "Clock in from a phone",
    blurb:
      "Your engineers punch in and out on their own phone. Hours flow into payroll, so nobody reconstructs a week from memory.",
    Preview: ClockInPreview,
  },
  {
    key: "clientReminders",
    title: "Reminders that go out on their own",
    blurb:
      "Clients get a text 48 hours, 24 hours and 2 hours before. It is the single biggest lever on no-shows, and it runs without you.",
    Preview: RemindersPreview,
  },
  {
    key: "receptionist",
    title: "Answer booking texts around the clock",
    blurb:
      "An inbound text at midnight gets your booking link straight back. It never confirms a slot it cannot hold, and your team is copied.",
    Preview: ReceptionistPreview,
  },
  {
    key: "patch",
    title: "Document the patch bay",
    blurb:
      "Every device, port and cable in the room, mapped. New engineers stop guessing what is normalled to what.",
    Preview: PatchPreview,
  },
];

export function FeatureStep() {
  const setup = useQuery(api.onboarding.featureSetup);
  const save = useMutation(api.onboarding.setFeaturePrefs);
  const reduced = useReducedMotion();
  const [pending, setPending] = React.useState<Key | null>(null);

  if (!setup) {
    return <p className="text-sm text-steel">Loading…</p>;
  }

  const state: Record<Key, { on: boolean; owned: boolean; tierLabel: string | null }> = {
    timeClock: {
      on: setup.timeClock.enabled,
      owned: setup.timeClock.owned,
      tierLabel: setup.timeClock.tierLabel,
    },
    patch: { on: setup.patch.enabled, owned: setup.patch.owned, tierLabel: setup.patch.tierLabel },
    clientReminders: { on: setup.clientReminders, owned: true, tierLabel: null },
    receptionist: {
      on: setup.receptionist.owned && setup.receptionist.on,
      owned: setup.receptionist.owned,
      tierLabel: setup.receptionist.tierLabel,
    },
  };

  async function toggle(key: Key, next: boolean) {
    setPending(key);
    try {
      await save({ [key]: next });
    } catch {
      // The switch reflects server state, so a failure simply leaves it as it
      // was. Nothing to undo, and an error toast here would be noise mid-setup.
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {CARDS.map((card, i) => {
        const s = state[card.key];
        const locked = !s.owned;
        return (
          <motion.div
            key={card.key}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={{ delay: reduced ? 0 : i * 0.07, type: "spring", stiffness: 300, damping: 30 }}
            className={cn(
              "rounded-lg border p-4 transition-colors",
              locked
                ? "border-graphite/40 bg-coal/20"
                : s.on
                  ? "border-gold/40 bg-gold/[0.06]"
                  : "border-graphite/50 bg-coal-2",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className={cn("text-sm font-semibold", s.on ? "text-bone" : "text-steel")}>
                    {card.title}
                  </span>
                  {locked && s.tierLabel && <Badge tone="gold">{s.tierLabel}</Badge>}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-steel/80">
                  {locked && s.tierLabel
                    ? `${card.blurb} Included from ${s.tierLabel}.`
                    : card.blurb}
                </p>
              </div>
              {locked ? (
                <Lock className="mt-0.5 size-4 shrink-0 text-steel/40" aria-hidden />
              ) : (
                <Switch
                  checked={s.on}
                  disabled={pending === card.key}
                  onCheckedChange={(v) => toggle(card.key, v)}
                  aria-label={card.title}
                />
              )}
            </div>
            <div className="mt-3">
              <card.Preview active={s.on && !locked} />
            </div>
          </motion.div>
        );
      })}
      <p className="pt-1 text-xs text-steel/60">
        All of these can be changed later in Settings. Nothing here is permanent.
      </p>
    </div>
  );
}
