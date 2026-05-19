"use client";

import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { fadeUp, staggerChildren } from "@/lib/motion";
import { GearPhoto } from "@/components/book/gear-photo";

/** One equipment item as returned by `api.booking.room`. */
export type GearItem = {
  _id: string;
  name: string;
  category: string;
  condition?: string;
  photo: string | null;
};

const CONDITION_TONE: Record<string, "positive" | "caution" | "critical" | "neutral"> = {
  pristine: "positive",
  excellent: "positive",
  good: "positive",
  fair: "caution",
  worn: "caution",
  poor: "critical",
  needs_repair: "critical",
};

function conditionTone(condition?: string) {
  if (!condition) return "neutral" as const;
  return CONDITION_TONE[condition.toLowerCase()] ?? "neutral";
}

export function GearGallery({ equipment }: { equipment: GearItem[] }) {
  if (equipment.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline-2 bg-coal/40 px-5 py-8 text-center text-sm text-ash-dim">
        Gear details for this room are being updated.
      </p>
    );
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      variants={staggerChildren(0.04)}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      {equipment.map((item) => (
        <motion.div
          key={item._id}
          variants={fadeUp}
          className="overflow-hidden rounded-lg border border-hairline bg-coal"
        >
          <GearPhoto
            photo={item.photo}
            category={item.category}
            alt={item.name}
            className="aspect-square w-full rounded-none border-0"
          />
          <div className="space-y-1.5 p-3">
            <p className="truncate text-sm font-medium text-bone" title={item.name}>
              {item.name}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" className="capitalize">
                {item.category}
              </Badge>
              {item.condition && (
                <Badge tone={conditionTone(item.condition)} className="capitalize">
                  {item.condition.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
