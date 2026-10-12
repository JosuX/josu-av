import "server-only";
import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { VIEWER_PORT } from "./config";
import { onShutdown } from "./shutdown";

// A second port for viewers that reaches only the watch page and what it needs; everything
// else, including every control endpoint, gets a 404. Requests that pass are forwarded to the
// panel's own port. This only protects the controls if the firewall keeps viewers off that port.

const DEV = process.env.NODE_ENV === "development";
/** The dev server's hot-reload WebSocket; its client won't start the page without it. */
const DEV_HMR_PATHS = ["/_next/hmr", "/_next/webpack-hmr"];
/** Largest request body a viewer may send; a playback report is a few hundred bytes. */
export const MAX_VIEWER_BODY = 16 * 1024;

export type ViewerRoute = "forward" | "redirect" | "deny";

/** What the viewer port does with a request. */
export function viewerRoute(method: string, url: string): ViewerRoute {
  const path = url.split("?")[0];
  // No path tricks: nothing that a server might normalise into a different route.
  if (/\.\.|%2e|%2f|%5c|\\|\/\//i.test(path)) return "deny";
  if (method === "GET" || method === "HEAD") {
    if (path === "/") return "redirect";
    if (path === "/watch" || path === "/api/watch" || path === "/api/events/watch") return "forward";
    // The app icons (src/app/favicon.ico, icon.svg, apple-icon.png), which the page links to.
    if (path === "/favicon.ico" || path === "/icon.svg" || path === "/apple-icon.png") return "forward";
    if (path.startsWith("/_next/static/")) return "forward";
    // Dev server only: fonts and the hot-reload channel.
    if (DEV && (path.startsWith("/__nextjs_font/") || DEV_HMR_PATHS.includes(path))) return "forward";
  }
  if (method === "POST" && path === "/api/viewers") return "forward";
  return "deny";
}

function panelPort() {
  return Number(process.env.PORT ?? 3000);
}

type Handlers = {
  request: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  upgrade: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;
};

const handlers: Handlers = {
  request(req, res) {
    const route = viewerRoute(req.method ?? "GET", req.url ?? "/");
    if (route === "redirect") {
      res.writeHead(302, { Location: "/watch" }).end();
      return;
    }
    if (route === "deny") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    if (Number(req.headers["content-length"] ?? 0) > MAX_VIEWER_BODY) {
      res.writeHead(413, { "Content-Type": "text/plain", Connection: "close" }).end("Too large");
      req.destroy();
      return;
    }
    // Replace, not append to, any X-Forwarded-For the viewer sent, so the logs show the real
    // address.
    const forwardedFor = req.socket.remoteAddress ?? "";
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: panelPort(),
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-for": forwardedFor },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (res.writableEnded) return;
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("The stream page is unavailable");
    });
    // A viewer that goes away must not leave its request (e.g. an event stream) open on the
    // panel, or the panel can't shut down.
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    // Content-Length can be left out (chunked), so count the bytes as they arrive too.
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received <= MAX_VIEWER_BODY) return;
      upstream.destroy();
      if (!res.headersSent) res.writeHead(413, { "Content-Type": "text/plain", Connection: "close" }).end("Too large");
      req.destroy();
    });
    req.pipe(upstream);
  },

  // WebSocket upgrades: only the dev server's hot-reload channel.
  upgrade(req, socket, head) {
    const path = (req.url ?? "/").split("?")[0];
    if (viewerRoute("GET", req.url ?? "/") !== "forward" || !DEV_HMR_PATHS.includes(path)) {
      socket.destroy();
      return;
    }
    const up = net.connect(panelPort(), "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  },
};

const g = globalThis as unknown as { __avViewerPort?: { server: http.Server; handlers: Handlers } };

// Stop accepting viewers when the panel stops, and drop the ones still connected.
onShutdown(() => {
  const s = g.__avViewerPort?.server;
  s?.close();
  s?.closeAllConnections();
});

/**
 * Open the viewer port once per server process; AV_VIEWER_PORT=0 turns it off. The server
 * calls whichever handlers were installed last, so after a code change in development the
 * next call (from a route) takes effect without reopening the port.
 */
export function ensureViewerPort() {
  if (!VIEWER_PORT) return;
  if (g.__avViewerPort) {
    g.__avViewerPort.handlers = handlers;
    return;
  }
  const state = { server: http.createServer((req, res) => state.handlers.request(req, res)), handlers };
  state.server.on("upgrade", (req, socket, head) => state.handlers.upgrade(req, socket, head));
  state.server.on("error", (e) => console.error(`[viewer-port] can't listen on port ${VIEWER_PORT}: ${e.message}`));
  state.server.listen(VIEWER_PORT, () => console.log(`[viewer-port] viewer page on port ${VIEWER_PORT} (/watch only)`));
  g.__avViewerPort = state;
}
