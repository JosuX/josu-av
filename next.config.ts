import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let phones/tablets on the LAN use the dev server by IP (private ranges only).
  // Network exposure itself is limited by the host firewall, not by this list.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  // The desktop app (electron/) runs the self-contained server in .next/standalone. Only for
  // that build, since `next start` doesn't serve a standalone build.
  ...(process.env.AV_STANDALONE === "1" && { output: "standalone" as const }),
};

export default nextConfig;
