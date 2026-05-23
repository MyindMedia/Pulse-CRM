import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this project. A package-lock.json in a
  // parent dir was making Next infer the wrong root, which broke the (app)
  // route group in dev.
  turbopack: { root: __dirname },
};

export default nextConfig;
