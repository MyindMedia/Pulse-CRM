import { ImageResponse } from "next/og";

// Branded social share card (gold/black) shown when the site is linked on
// social networks and messaging apps. Generated at build time by next/og,
// no external assets or fonts required.
export const alt = "Pulse - the operating system for music businesses";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "84px",
          background: "#08080a",
          color: "#f6f6f5",
          position: "relative",
        }}
      >
        {/* gold glow */}
        <div
          style={{
            position: "absolute",
            top: -220,
            left: 280,
            width: 760,
            height: 520,
            background:
              "radial-gradient(50% 50% at 50% 50%, rgba(253,185,19,0.28), rgba(8,8,10,0) 70%)",
            display: "flex",
          }}
        />
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 9999,
              background: "#fdb913",
              display: "flex",
            }}
          />
          <div
            style={{
              fontSize: 34,
              letterSpacing: 10,
              color: "#fdb913",
              fontWeight: 700,
            }}
          >
            PULSE
          </div>
        </div>
        {/* headline */}
        <div
          style={{
            fontSize: 82,
            fontWeight: 800,
            lineHeight: 1.05,
            marginTop: 44,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>The operating system</span>
          <span>
            for music businesses<span style={{ color: "#fdb913" }}>.</span>
          </span>
        </div>
        {/* tagline */}
        <div
          style={{
            fontSize: 30,
            color: "#a3a3ad",
            marginTop: 38,
            display: "flex",
            maxWidth: 920,
          }}
        >
          Sessions, splits, releases: one unbroken chain from inquiry to royalty.
        </div>
      </div>
    ),
    { ...size },
  );
}
