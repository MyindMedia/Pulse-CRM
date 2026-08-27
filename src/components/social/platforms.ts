import { Briefcase } from "lucide-react";
import type { Platform } from "@convex/lib/ghl";
import {
  GoogleIcon,
  FacebookIcon,
  InstagramIcon,
  TiktokIcon,
  YoutubeIcon,
  PinterestIcon,
  ThreadsIcon,
  BlueskyIcon,
} from "./brand-icons";

/* lucide-react 1.16.0 (the version installed here) dropped its brand marks -
   Facebook, Instagram, Linkedin and the old PlaySquare are all gone from
   node_modules/lucide-react/dist/lucide-react.d.ts. brand-icons.tsx inlines
   the real marks (Simple Icons v16, CC0-1.0) for every platform except
   LinkedIn - see that entry below for why.

   `icon` is typed to the same `{ className?: string }` shape used elsewhere
   in this codebase (see side-panels.tsx, checklists-panel.tsx, etc.) rather
   than the narrower `LucideIcon`, so it accepts both a lucide component
   (Briefcase, for LinkedIn) and one of our inlined brand components. */
type PlatformIcon = React.ComponentType<{ className?: string }>;

export const PLATFORM_META: Record<Platform, { label: string; icon: PlatformIcon; hint: string }> = {
  google: { label: "Google Business Profile", icon: GoogleIcon, hint: "Offer posts with a coupon code and a Book button" },
  facebook: { label: "Facebook Page", icon: FacebookIcon, hint: "Photos, video or text" },
  instagram: { label: "Instagram", icon: InstagramIcon, hint: "Photo, carousel or Reel. Links are not clickable." },
  // LinkedIn is not in Simple Icons - it was removed at LinkedIn's own legal
  // request, so there is no CC0 mark to inline for it here. Briefcase is the
  // neutral lucide stand-in; the label text carries the platform identity.
  // Drop in LinkedIn's official asset from their brand page if desired.
  linkedin: { label: "LinkedIn", icon: Briefcase, hint: "Page or profile" },
  tiktok: { label: "TikTok", icon: TiktokIcon, hint: "Video only" },
  "tiktok-business": { label: "TikTok Business", icon: TiktokIcon, hint: "Video only" },
  youtube: { label: "YouTube", icon: YoutubeIcon, hint: "Video only" },
  pinterest: { label: "Pinterest", icon: PinterestIcon, hint: "One image with a link" },
  threads: { label: "Threads", icon: ThreadsIcon, hint: "500 characters" },
  bluesky: { label: "Bluesky", icon: BlueskyIcon, hint: "300 characters, up to 4 photos" },
};

export const PLATFORM_ORDER: Platform[] = [
  "instagram", "facebook", "google", "tiktok", "tiktok-business",
  "youtube", "linkedin", "threads", "pinterest", "bluesky",
];
