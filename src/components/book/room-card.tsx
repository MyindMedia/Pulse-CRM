"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/format";
import { fadeUp } from "@/lib/motion";
import { RoomCover } from "@/components/book/room-cover";

/** Shape of one room card from `api.booking.studioFront`. */
export type RoomCardData = {
  _id: string;
  name: string;
  roomType?: string;
  hourlyRateCents: number;
  minimumHours: number;
  depositPct: number;
  gearCount: number;
  gearPreview: string[];
  photos: string[];
};

export function RoomCard({ room, slug }: { room: RoomCardData; slug: string }) {
  return (
    <motion.div variants={fadeUp}>
      <Link
        href={`/book/${slug}/${room._id}`}
        className="group block h-full overflow-hidden rounded-lg border border-graphite/50 bg-coal transition-all duration-150 hover:border-graphite/60 hover:bg-coal-2"
      >
        <RoomCover photos={room.photos} name={room.name} className="aspect-[16/10]" />

        <div className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-grotesk text-base font-semibold tracking-tight text-bone group-hover:text-gold-bright">
                {room.name}
              </h3>
              {room.roomType && (
                <p className="mt-0.5 text-xs capitalize text-steel">{room.roomType}</p>
              )}
            </div>
            <ArrowUpRight className="size-4 shrink-0 text-steel/70 transition-colors group-hover:text-gold" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-meta text-sm text-bone">
              {money(room.hourlyRateCents)}
              <span className="text-steel/70"> / hr</span>
            </span>
            <Badge tone="neutral">
              <Clock className="size-3" />
              {room.minimumHours}h minimum
            </Badge>
          </div>

          <div className="space-y-1.5 border-t border-graphite/50 pt-3">
            <p className="flex items-center gap-1.5 text-xs text-steel">
              <Sparkles className="size-3 text-gold-dim" />
              {room.gearCount} {room.gearCount === 1 ? "instrument" : "pieces of gear"}
            </p>
            {room.gearPreview.length > 0 && (
              <p className="truncate text-xs text-steel/70">
                {room.gearPreview.join(" · ")}
              </p>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
