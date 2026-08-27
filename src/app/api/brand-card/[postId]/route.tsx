import { ImageResponse } from "next/og";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// Studio-branded post image: rendered from the studio's own logo and accent
// colour so a post about a rate promo or an open slot always has something
// to post, even with no photo on hand. Carries the studio's identity only -
// no Pulse mark belongs on this card, per the glossary.
export const runtime = "nodejs";
const W = 1080, H = 1350;

// Fetch a TTF from Google Fonts for satori (which cannot consume woff2).
// Subsetting via text= keeps the payload tiny. Returns null on failure so a
// network hiccup degrades the card to the default font instead of failing
// the route. (Same pattern as src/app/opengraph-image.tsx.)
async function loadGoogleFont(family: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(
        `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&text=${encodeURIComponent(text)}`,
      )
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await (await fetch(url)).arrayBuffer();
  } catch {
    return null;
  }
}

// Baseline glyph coverage plus whatever the actual card copy needs - a
// studio or room name can contain any character, so the subset is widened
// per request rather than fixed at build time.
const BASE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 %$/:.,-'";

export async function GET(req: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const kind = new URL(req.url).searchParams.get("kind") ?? "promo";

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return new Response("Not found", { status: 404 });

  const client = new ConvexHttpClient(convexUrl);
  let d;
  try {
    d = await client.query(api.marketing.brandCard.data, { postId: postId as Id<"socialPosts"> });
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!d) return new Response("Not found", { status: 404 });

  const accent = d.accent;
  const headline =
    kind === "rate_card" ? (d.rateLabel ?? "Book the room")
    : kind === "open_slot" ? "This slot is open"
    : d.promoPct ? `${d.promoPct}% off` : "Book now";
  const sub =
    kind === "rate_card" ? (d.roomName ?? d.studioName)
    : kind === "open_slot" ? (d.windowLabel ?? d.roomName ?? "")
    : [d.roomName, d.windowLabel].filter(Boolean).join(", ");

  const glyphText = BASE_GLYPHS + headline + sub + d.studioName + (d.promoCode ?? "");
  const [headlineFont, boldFont, mediumFont] = await Promise.all([
    loadGoogleFont("Archivo Black", glyphText),
    loadGoogleFont("Inter:wght@700", glyphText),
    loadGoogleFont("Inter:wght@500", glyphText),
  ]);
  const fonts = [
    headlineFont && { name: "Archivo Black", data: headlineFont, weight: 400 as const, style: "normal" as const },
    boldFont && { name: "Inter", data: boldFont, weight: 700 as const, style: "normal" as const },
    mediumFont && { name: "Inter", data: mediumFont, weight: 500 as const, style: "normal" as const },
  ].filter(Boolean) as NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];

  // satori fetches an <img src> itself at render time, so a remote Convex
  // storage URL that's briefly unreachable would otherwise throw mid-render
  // and 500 the whole route. Resolve it ourselves first and degrade to a
  // logoless card on any failure - the same shape as the font fallback above.
  let logoDataUrl: string | null = null;
  if (d.logoUrl) {
    try {
      const res = await fetch(d.logoUrl);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const contentType = res.headers.get("content-type") ?? "image/png";
        logoDataUrl = `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
      }
    } catch {
      logoDataUrl = null;
    }
  }

  try {
    return new ImageResponse(
      (
        <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 96, background: "#0b0b0c", color: "#f5f5f4", fontFamily: "Inter" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {logoDataUrl ? <img src={logoDataUrl} width={96} height={96} style={{ borderRadius: 24, objectFit: "cover" }} /> : null}
            <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{d.studioName}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ fontSize: 168, fontWeight: 400, lineHeight: 0.95, letterSpacing: -6, color: accent, fontFamily: "Archivo Black" }}>{headline}</div>
            <div style={{ fontSize: 56, fontWeight: 500, opacity: 0.9 }}>{sub}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            {d.promoCode && kind !== "rate_card" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 28, opacity: 0.7, letterSpacing: 4 }}>CODE</div>
                <div style={{ fontSize: 72, fontWeight: 700, padding: "12px 32px", border: `4px solid ${accent}`, borderRadius: 20 }}>{d.promoCode}</div>
              </div>
            ) : <div />}
            <div style={{ fontSize: 28, opacity: 0.6 }}>Book online</div>
          </div>
        </div>
      ),
      { width: W, height: H, headers: { "Cache-Control": "public, max-age=31536000, immutable" }, fonts: fonts && fonts.length > 0 ? fonts : undefined },
    );
  } catch {
    return new Response("Failed to generate the image", { status: 500 });
  }
}
