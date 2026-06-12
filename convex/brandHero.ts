import { action, internalAction, internalQuery, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { currentOrg } from "./lib/tenant";

/* ============================================================
   AI-generated brand hero for sub-account booking sites.

   When a studio uploads a logo, the extracted accent/palette is
   used to generate a cinematic, low-key studio photograph via
   Gemini (GEMINI_API_KEY on the deployment), tinted in the
   studio's brand color. The image is stored in Convex storage as
   `generatedHeroId` and the public booking page renders it as a
   full-bleed background under a dark fade. A manually uploaded
   hero (bookingHeroId) always wins over the generated one.
   ============================================================ */

const GEMINI_MODEL = "gemini-2.5-flash-image";

/** Rough human hue name so the prompt reads naturally. */
function hueName(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "warm amber";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 24) return "soft neutral";
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  if (h < 15 || h >= 345) return "deep red";
  if (h < 40) return "burnt orange";
  if (h < 65) return "golden amber";
  if (h < 95) return "lime green";
  if (h < 150) return "emerald green";
  if (h < 195) return "teal";
  if (h < 240) return "electric blue";
  if (h < 280) return "violet";
  if (h < 320) return "magenta";
  return "hot pink";
}

/** The caller's active org id (auth propagates into runQuery from actions). */
export const _selfOrgId = internalQuery({
  args: {},
  handler: async (ctx) => currentOrg(ctx),
});

export const _orgBrand = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return null;
    return {
      name: org.name,
      accentColor: org.accentColor ?? "#fdb913",
      palette: org.brandPalette ?? null,
      hasManualHero: Boolean(org.bookingHeroId),
    };
  },
});

export const _setGeneratedHero = internalMutation({
  args: { orgId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { orgId, storageId }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) return;
    // Replace any previous generated hero (free the old file).
    if (org.generatedHeroId) {
      try {
        await ctx.storage.delete(org.generatedHeroId);
      } catch {
        // already gone - fine
      }
    }
    await ctx.db.patch(org._id, { generatedHeroId: storageId });
  },
});

async function callGemini(prompt: string): Promise<Blob | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const base = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "16:9" },
    },
  };
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(base),
  });
  if (res.status === 400) {
    // Older API surface without imageConfig - retry plain.
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: base.contents,
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
  }
  if (!res.ok) {
    console.error("brandHero: Gemini error", res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
  };
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData) return null;
  const binary = atob(part.inlineData.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: part.inlineData.mimeType || "image/png" });
}

function heroPrompt(brand: { name: string; accentColor: string; palette: string[] | null }) {
  const hue = hueName(brand.accentColor);
  const secondary = brand.palette?.[1] ? `, with subtle secondary ${hueName(brand.palette[1])} glows` : "";
  return [
    `Ultra-wide cinematic photograph of a high-end recording studio interior at night.`,
    `A large mixing console and studio monitors in soft focus, atmospheric haze, warm practical lamps.`,
    `The dominant accent lighting is ${hue} (${brand.accentColor})${secondary} - LED strips, button glow and rim light carry that color through the frame.`,
    `Very dark, moody, low-key lighting with deep shadows and a calm, uncluttered left side: this image sits BEHIND white text as a website hero background, so keep overall brightness low and avoid bright hotspots.`,
    `No people, no readable text, no logos, no watermarks. Photorealistic, shallow depth of field, shot on 35mm, slight film grain.`,
  ].join(" ");
}

/** Generate (or regenerate) the AI brand hero for an org. Skips quietly when
    the platform has no Gemini key or the studio uploaded a manual hero. */
export const generate = internalAction({
  args: { orgId: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, force }) => {
    const brand = await ctx.runQuery(internal.brandHero._orgBrand, { orgId });
    if (!brand) return { generated: false as const, reason: "no org" };
    if (brand.hasManualHero && !force) {
      return { generated: false as const, reason: "manual hero set" };
    }
    const blob = await callGemini(heroPrompt(brand));
    if (!blob) return { generated: false as const, reason: "generation unavailable" };
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.brandHero._setGeneratedHero, { orgId, storageId });
    return { generated: true as const };
  },
});

/** Studio-facing trigger from the branding panel: "Generate AI hero". */
export const regenerate = action({
  args: {},
  handler: async (ctx): Promise<{ generated: boolean }> => {
    const orgId: string = await ctx.runQuery(internal.brandHero._selfOrgId, {});
    const result = await ctx.runAction(internal.brandHero.generate, { orgId, force: true });
    if (!result.generated && result.reason === "generation unavailable") {
      throw new ConvexError("AI image generation isn't available right now. Try again shortly.");
    }
    return { generated: result.generated };
  },
});
