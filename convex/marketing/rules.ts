import type { Platform } from "../lib/ghl";

export type MediaKind = "image" | "video";

const LIMITS: Record<Platform, number> = {
  google: 1500, facebook: 63206, instagram: 2200, linkedin: 3000, tiktok: 2200,
  "tiktok-business": 2200, youtube: 5000, pinterest: 500, threads: 500, bluesky: 300,
};

export function captionLimit(platform: Platform): number {
  return LIMITS[platform];
}

const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

/** Pure validation, one message per problem. Empty array means the post is
 *  acceptable for that platform as far as Pulse can tell; GHL may still
 *  reject it and that message is surfaced verbatim. */
export function validateForPlatform(
  platform: Platform,
  input: { caption: string; media: MediaKind[]; hasLink: boolean },
): string[] {
  const out: string[] = [];
  const images = input.media.filter((m) => m === "image").length;
  const videos = input.media.filter((m) => m === "video").length;
  if (input.caption.length > LIMITS[platform]) {
    out.push(`${label(platform)} allows ${LIMITS[platform].toLocaleString("en-US")} characters.`);
  }
  switch (platform) {
    case "tiktok":
    case "tiktok-business":
      if (videos !== 1 || images > 0) out.push("TikTok needs one video.");
      break;
    case "youtube":
      if (videos !== 1 || images > 0) out.push("YouTube needs one video.");
      break;
    case "instagram":
      if (images + videos === 0) out.push("Instagram needs a photo or video.");
      if (images > 10) out.push("Instagram allows up to 10 photos.");
      if (videos > 1) out.push("Instagram allows one video per post.");
      break;
    case "pinterest":
      if (images !== 1 || videos > 0) out.push("Pinterest needs one image.");
      break;
    case "google":
      if (images > 1 || videos > 0) out.push("Google allows one photo.");
      if (PHONE.test(input.caption)) out.push("Google rejects phone numbers in the text. Use the call button instead.");
      break;
    case "bluesky":
      if (images > 4 || videos > 0) out.push("Bluesky allows up to 4 photos.");
      break;
    case "threads":
      if (images + videos > 20) out.push("Threads allows up to 20 items.");
      break;
    case "facebook":
    case "linkedin":
      break;
  }
  return out;
}

function label(p: Platform): string {
  return { google: "Google", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok", "tiktok-business": "TikTok", youtube: "YouTube", pinterest: "Pinterest", threads: "Threads", bluesky: "Bluesky" }[p];
}
