import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";

// Branded social share card (chrome/gold) shown when the site is linked on
// social networks and messaging apps. Composites the real brand assets - the
// Pulse logo lockup and the MacBook render with the dashboard on its screen -
// in the site's display face (Anton) and metadata voice (IBM Plex Mono).
// Generated at build time by next/og.
export const alt = "Pulse - the operating system for recording studios";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function publicAsset(name: string): string {
  const file = fs.readFileSync(path.join(process.cwd(), "public", name));
  return `data:image/png;base64,${file.toString("base64")}`;
}

// Fetch a TTF from Google Fonts for satori (which cannot consume woff2).
// Subsetting via text= keeps the payload tiny. Returns null on failure so a
// network hiccup degrades the card to the default font instead of failing
// the build.
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

// Full glyph coverage for the subset fetch - missing glyphs silently render
// in the fallback face.
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ·.,$/:-";

export default async function Image() {
  const logo = publicAsset("pulse-logo-main.png");
  const macbook = publicAsset("macbook.png");
  const dashboard = publicAsset("dashboard-screen.png");

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
        {/* vertical hairlines, chrome structure */}
        {[300, 600, 900].map((x) => (
          <div
            key={x}
            style={{
              position: "absolute",
              left: x,
              top: 0,
              width: 1,
              height: 630,
              background: "rgba(255,255,255,0.05)",
              display: "flex",
            }}
          />
        ))}
        {/* gold glow, center-top */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: 220,
            width: 760,
            height: 560,
            background:
              "radial-gradient(50% 50% at 50% 50%, rgba(253,185,19,0.30), rgba(13,13,14,0) 70%)",
            display: "flex",
          }}
        />
        {/* floor glow under the laptop */}
        <div
          style={{
            position: "absolute",
            right: -140,
            bottom: -220,
            width: 720,
            height: 420,
            background:
              "radial-gradient(50% 50% at 50% 50%, rgba(253,185,19,0.12), rgba(13,13,14,0) 70%)",
            display: "flex",
          }}
        />

        {/* left column: lockup + headline + meta */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 0 0 72px",
            width: 660,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={236} alt="" />
          <div
            style={{
              fontFamily: "Anton",
              fontSize: 66,
              lineHeight: 1.06,
              marginTop: 40,
              display: "flex",
              flexDirection: "column",
              letterSpacing: 1,
            }}
          >
            <span>RUN YOUR STUDIO.</span>
            <span>EVERY SCREEN,</span>
            <span style={{ color: "#fdb913" }}>ONE PULSE.</span>
          </div>
          <div
            style={{
              fontFamily: "Plex Mono",
              fontSize: 19,
              letterSpacing: 3,
              color: "#9a9aa2",
              marginTop: 44,
              display: "flex",
            }}
          >
            BOOKINGS · DEPOSITS · ROOMS · PAYMENTS
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 22,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 9999,
                background: "#fdb913",
                display: "flex",
              }}
            />
            <div
              style={{
                fontFamily: "Plex Mono",
                fontSize: 19,
                letterSpacing: 3,
                color: "#fdb913",
                display: "flex",
              }}
            >
              STUDIO OS · FROM $49/MO
            </div>
          </div>
        </div>

        {/* right column: MacBook render with the live dashboard on screen,
            cropped off the right edge like a product still */}
        <div
          style={{
            position: "absolute",
            right: -190,
            bottom: 48,
            width: 720,
            height: 493,
            display: "flex",
          }}
        >
          {/* the render's screen area is flat near-black, so the dashboard is
              simply layered on top inside the measured screen rectangle
              (insets 12.9% / 4.6% / 12.9% / 22.2% of the render). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={macbook} width={720} height={493} alt="" style={{ objectFit: "contain" }} />
          <div
            style={{
              position: "absolute",
              left: "13.2%",
              top: "5.0%",
              width: "73.8%",
              height: "72.6%",
              display: "flex",
              overflow: "hidden",
              background: "#101012",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dashboard}
              width={561}
              height={378}
              alt=""
              style={{ objectFit: "cover", width: "100%", height: "100%" }}
            />
          </div>
        </div>

        {/* bottom meta rail */}
        <div
          style={{
            position: "absolute",
            left: 72,
            bottom: 34,
            display: "flex",
            fontFamily: "Plex Mono",
            fontSize: 16,
            letterSpacing: 3,
            color: "#6e6e76",
          }}
        >
          PULSE BY MYIND SOUND · PULSE.MYINDSOUND.COM
        </div>
      </div>
    ),
    { ...size, fonts: fonts && fonts.length > 0 ? fonts : undefined },
  );
}
