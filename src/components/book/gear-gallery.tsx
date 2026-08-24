"use client";

import { motion } from "motion/react";
import { fadeUp, staggerChildren } from "@/lib/motion";
import { CategoryIcon } from "@/components/book/gear-photo";

/** One equipment item as returned by `api.booking.room`. */
export type GearItem = {
  _id: string;
  name: string;
  category: string;
  condition?: string;
  photo: string | null;
};

/* A list, at every width.

   This used to be names on mobile and a grid of photo tiles from sm up. The
   tiles read as a shop: four big squares saying "Neumann U87" tell a client
   less than twenty lines do, and a room with thirty pieces became a wall of
   pictures nobody scrolled to the end of. The list is what people actually
   scan, so it is now the only thing rendered - which also means the photos
   stop being downloaded on a page whose job is to take a booking.

   Whether it appears at all is the studio's call: `showGearOnBooking`. */
export function GearGallery({ equipment }: { equipment: GearItem[] }) {
  if (equipment.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-graphite/60 bg-coal/40 px-5 py-8 text-center text-sm text-steel/70">
        Gear details for this room are being updated.
      </p>
    );
  }

  return (
    <motion.ul
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      variants={staggerChildren(0.02)}
      className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal sm:columns-2 sm:gap-0 sm:divide-y-0 lg:columns-3"
    >
      {equipment.map((item) => (
        <motion.li
          key={item._id}
          variants={fadeUp}
          className="flex items-center gap-2.5 border-b border-graphite/40 px-3.5 py-2.5 last:border-b-0 sm:break-inside-avoid"
        >
          <CategoryIcon category={item.category} className="size-4 shrink-0 text-steel/70" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-bone" title={item.name}>
            {item.name}
          </span>
          <span className="shrink-0 font-meta text-[0.65rem] uppercase tracking-[0.06em] text-steel/60">
            {item.category}
          </span>
        </motion.li>
      ))}
    </motion.ul>
  );
}
