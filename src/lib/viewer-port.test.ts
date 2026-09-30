import { describe, expect, it, vi } from "vitest";
import { viewerRoute } from "./viewer-port";

describe("viewerRoute", () => {
  it("serves the watch page and what it needs", () => {
    expect(viewerRoute("GET", "/")).toBe("redirect");
    expect(viewerRoute("GET", "/watch")).toBe("forward");
    expect(viewerRoute("GET", "/watch?_rsc=abc")).toBe("forward");
    expect(viewerRoute("GET", "/_next/static/chunks/app.js")).toBe("forward");
    expect(viewerRoute("GET", "/api/watch")).toBe("forward");
    expect(viewerRoute("GET", "/api/events/watch")).toBe("forward");
    expect(viewerRoute("POST", "/api/viewers")).toBe("forward");
  });

  it("refuses the controls", () => {
    for (const [method, url] of [
      ["GET", "/settings"],
      ["GET", "/logs"],
      ["GET", "/api/status"],
      ["GET", "/api/events/status"],
      ["GET", "/api/events/obs"],
      ["GET", "/api/events/automation"],
      ["GET", "/api/logs/mediamtx"],
      ["POST", "/api/process/mediamtx"],
      ["POST", "/api/obs"],
      ["POST", "/api/automation"],
      ["POST", "/api/abr"],
      ["POST", "/watch"],
      ["GET", "/api/viewers"],
    ])
      expect(viewerRoute(method, url), `${method} ${url}`).toBe("deny");
  });

  it("refuses path tricks", () => {
    for (const url of [
      "/_next/static/../../settings",
      "/_next/static/%2e%2e/api/status",
      "/_next/static/..%2fapi%2fstatus",
      "/_next/static\\..\\settings",
      "//settings",
    ])
      expect(viewerRoute("GET", url), url).toBe("deny");
  });
});

describe("viewerRoute in development", () => {
  it("lets the dev server's hot-reload socket through, without which the page never starts", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { viewerRoute: devRoute } = await import("./viewer-port");
    expect(devRoute("GET", "/_next/hmr?id=abc")).toBe("forward");
    expect(devRoute("GET", "/settings")).toBe("deny");
    vi.unstubAllEnvs();
  });
});
