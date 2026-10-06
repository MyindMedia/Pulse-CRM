import type { NextConfig } from "next";
import { R2_PUBLIC_URL } from "./src/lib/media";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project. A package-lock.json in a
  // parent dir was making Next infer the wrong root, which broke the (app)
  // route group in dev.
  turbopack: { root: __dirname },
  // Gear and room photos moved to Cloudflare R2. Database rows still store
  // /gear/... and /rooms/... paths, so those redirect to the bucket instead of
  // being rewritten in the data. 307 (not 301) keeps the host swappable.
  async redirects() {
    return [
      { source: "/gear/:path*", destination: `${R2_PUBLIC_URL}/gear/:path*`, permanent: false },
      { source: "/rooms/:path*", destination: `${R2_PUBLIC_URL}/rooms/:path*`, permanent: false },
    ];
  },
};

export default nextConfig;
