import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

/* The share card for the sales team's link.
 *
 * Deliberately not the marketing card. When a rep drops this link in a group
 * chat, the preview has to say two things at a glance: this is the internal
 * one, and you will need the password. It carries the studio operating system
 * line and studiopulse.tech, which is the address every shared Pulse link
 * should use.
 *
 * No price appears here, same rule as the page itself. */

export const alt = "Pulse. The studio operating system. Internal sales page.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function asset(name: string, mime: "png" | "jpeg"): string {
  const file = fs.readFileSync(path.join(process.cwd(), "public", name));
  return `data:image/${mime};base64,${file.toString("base64")}`;
}

// satori cannot read woff2, so the faces come from Google as TTF, subset to
// the glyphs actually drawn. A network failure degrades to the default face
// rather than failing the build.
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

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ·./:-";

export default async function Image() {
  const logo = asset("pulse-logo-main.png", "png");
  const still = asset("pulse-commercial-poster.jpg", "jpeg");

  const [anton, plexMono] = await Promise.all([
    loadGoogleFont("Anton", GLYPHS),
    loadGoogleFont("IBM Plex Mono:wght@500", GLYPHS),
  ]);
  const fonts = [
    anton && { name: "Anton", data: anton, weight: 400 as const, style: "normal" as const },
    plexMono && { name: "Plex Mono", data: plexMono, weight: 500 as const, style: "normal" as const },
  ].filter(Boolean) as NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#0d0d0e",
          color: "#f6f6f5",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* The still from the commercial, faded off behind the type. */}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 660,
            height: 630,
            display: "flex",
          }}
        >
          <img
            src={still}
            width={660}
            height={630}
            alt=""
            style={{ objectFit: "cover", width: "100%", height: "100%", opacity: 0.5 }}
          />
        </div>
        {/* Ink wash left to right, so the headline always sits on flat black. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(90deg, #0d0d0e 0%, #0d0d0e 46%, rgba(13,13,14,0.72) 70%, rgba(13,13,14,0.45) 100%)",
            display: "flex",
          }}
        />
        {/* Gold glow behind the lockup. */}
        <div
          style={{
            position: "absolute",
            top: -240,
            left: -120,
            width: 720,
            height: 560,
            background:
              "radial-gradient(50% 50% at 50% 50%, rgba(253,185,19,0.26), rgba(13,13,14,0) 70%)",
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 0 0 72px",
            width: 700,
          }}
        >
          <img src={logo} width={210} alt="" />

          <div
            style={{
              fontFamily: "Plex Mono",
              fontSize: 18,
              letterSpacing: 4,
              color: "#fdb913",
              marginTop: 34,
              display: "flex",
            }}
          >
            INTERNAL · SALES TEAM
          </div>

          <div
            style={{
              fontFamily: "Anton",
              fontSize: 76,
              lineHeight: 1.02,
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              letterSpacing: 1,
            }}
          >
            <span>EVERYTHING</span>
            <span>PULSE</span>
            <span style={{ color: "#fdb913" }}>ACTUALLY DOES</span>
          </div>

          <div
            style={{
              fontFamily: "Plex Mono",
              fontSize: 17,
              letterSpacing: 3,
              color: "#9a9aa2",
              marginTop: 32,
              display: "flex",
            }}
          >
            155 FEATURES · 14 GROUPS · 3 PLANS
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                border: "1px solid rgba(253,185,19,0.45)",
                borderRadius: 8,
                padding: "6px 12px",
                fontFamily: "Plex Mono",
                fontSize: 15,
                letterSpacing: 3,
                color: "#fdb913",
              }}
            >
              PASSWORD REQUIRED
            </div>
          </div>
        </div>

        {/* Bottom scrim. The rail runs past the flat-black column and over the
            photo, so it needs its own dark ground to stay readable. */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 130,
            background: "linear-gradient(180deg, rgba(13,13,14,0) 0%, rgba(13,13,14,0.92) 62%, #0d0d0e 100%)",
            display: "flex",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 72,
            bottom: 34,
            display: "flex",
            fontFamily: "Plex Mono",
            fontSize: 15,
            letterSpacing: 3,
            color: "#6e6e76",
          }}
        >
          THE STUDIO OPERATING SYSTEM · STUDIOPULSE.TECH/MYPULSE
        </div>
      </div>
    ),
    { ...size, fonts: fonts && fonts.length > 0 ? fonts : undefined },
  );
}
