import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let phones/tablets on the LAN use the dev server by IP (private ranges only).
  // Network exposure itself is limited by the host firewall, not by this list.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
};

export default nextConfig;
