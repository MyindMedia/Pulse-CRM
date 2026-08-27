import { Globe, Users, Camera, Briefcase, Music2, SquarePlay, Pin, AtSign, Cloud, type LucideIcon } from "lucide-react";
import type { Platform } from "@convex/lib/ghl";

/* lucide-react 1.16.0 (the version installed here) dropped its brand marks -
   Facebook, Instagram, Linkedin and the old PlaySquare are all gone from
   node_modules/lucide-react/dist/lucide-react.d.ts. The icons below are
   neutral stand-ins (SquarePlay replaces the renamed PlaySquare); the label
   text carries the platform identity, not the glyph. */
export const PLATFORM_META: Record<Platform, { label: string; icon: LucideIcon; hint: string }> = {
  google: { label: "Google Business Profile", icon: Globe, hint: "Offer posts with a coupon code and a Book button" },
  facebook: { label: "Facebook Page", icon: Users, hint: "Photos, video or text" },
  instagram: { label: "Instagram", icon: Camera, hint: "Photo, carousel or Reel. Links are not clickable." },
  linkedin: { label: "LinkedIn", icon: Briefcase, hint: "Page or profile" },
  tiktok: { label: "TikTok", icon: Music2, hint: "Video only" },
  "tiktok-business": { label: "TikTok Business", icon: Music2, hint: "Video only" },
  youtube: { label: "YouTube", icon: SquarePlay, hint: "Video only" },
  pinterest: { label: "Pinterest", icon: Pin, hint: "One image with a link" },
  threads: { label: "Threads", icon: AtSign, hint: "500 characters" },
  bluesky: { label: "Bluesky", icon: Cloud, hint: "300 characters, up to 4 photos" },
};

export const PLATFORM_ORDER: Platform[] = [
  "instagram", "facebook", "google", "tiktok", "tiktok-business",
  "youtube", "linkedin", "threads", "pinterest", "bluesky",
];
