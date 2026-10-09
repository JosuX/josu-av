import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let phones/tablets on the LAN use the dev server by IP (private ranges only).
  // Network exposure itself is limited by the host firewall, not by this list.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  // The Electron app (`pnpm electron:build`) bundles the self-contained server; `next start`
  // does not support standalone output, so it is opt-in.
  output: process.env.AV_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
