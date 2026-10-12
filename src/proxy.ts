import type { NextRequest } from "next/server";

// The control endpoints have no login, so any web page open in a browser on the LAN could
// otherwise send them commands (a form or a text/plain fetch needs no preflight). Browsers
// send Origin on every POST, PUT, PATCH and DELETE, so a write must come from a page served by
// this host and port. Tools without a browser (curl) send no Origin and still work.

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

export function isCrossSiteWrite(method: string, origin: string | null, host: string | null) {
  if (SAFE_METHODS.includes(method) || origin === null) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    // "null" (sandboxed frames, file:// pages) or garbage.
    return true;
  }
}

export function proxy(request: NextRequest) {
  if (isCrossSiteWrite(request.method, request.headers.get("origin"), request.headers.get("host"))) {
    return Response.json({ error: "cross-site request refused" }, { status: 403 });
  }
}

export const config = {
  matcher: "/api/:path*",
};
