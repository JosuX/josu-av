import "server-only";
import { networkInterfaces } from "node:os";
import { INGEST, INPUT_PATH, OUTPUT_PATH, VIEWER_PORT, WEBRTC_PORT, WHIP_URL } from "./config";
import { listPaths, probePathReady } from "./mediamtx";
import {
  getEncoder,
  getStreamService,
  getStreamStatus,
  listNetworkSources,
  stoppedByPanel,
  withObs,
  type ObsPayload,
} from "./obs";
import { procman } from "./procman";
import { supervisor } from "./supervisor";
import type { StatusPayload, WatchPayload } from "./shared";

// What the API routes return, shared with the live push (live.ts) so both send the same thing.

/** Virtual interfaces (containers, VPNs) whose addresses other LAN devices can't reach. */
const VIRTUAL_IFACE = /^(lo|docker|br-|veth|virbr|vmnet|tailscale|tun|tap|wg|wt|zt)/;

/** The first IPv4 address on a physical interface, e.g. 192.168.1.25. */
export function lanHost(): string | null {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL_IFACE.test(name)) continue;
    const a = addrs?.find((x) => x.family === "IPv4" && !x.internal);
    if (a) return a.address;
  }
  return null;
}

const RATE_WINDOW_MS = 10_000;
let received: { ts: number; bytes: number }[] = [];

/** kbps received on the output path over the last ~10 s, from MediaMTX's byte counter. */
function receiveRate(bytes: number | undefined, now = Date.now()): number | null {
  if (bytes === undefined) {
    received = [];
    return null;
  }
  if (received.length && bytes < received.at(-1)!.bytes) received = []; // path restarted
  received.push({ ts: now, bytes });
  while (received.length > 2 && now - received[1].ts >= RATE_WINDOW_MS) received.shift();
  const [first, last] = [received[0], received.at(-1)!];
  return last.ts - first.ts >= 1000 ? Math.round(((last.bytes - first.bytes) * 8) / (last.ts - first.ts)) : null;
}

export async function getStatus(): Promise<StatusPayload> {
  const [processes, paths] = await Promise.all([procman.status(), listPaths()]);

  let outputReady: boolean;
  let inputReady: boolean | null;
  if (paths) {
    outputReady = paths.some((p) => p.name === OUTPUT_PATH && p.ready);
    inputReady = paths.some((p) => p.name === INPUT_PATH && p.ready);
  } else {
    // API unavailable: only probe when something is plausibly serving the path.
    const mtxUp = processes.some((p) => p.name === "mediamtx" && (p.pid || p.externalPids.length));
    outputReady = mtxUp ? await probePathReady(OUTPUT_PATH) : false;
    inputReady = null;
  }

  const out = paths?.find((p) => p.name === OUTPUT_PATH && p.ready);
  return {
    processes,
    paths,
    warnings: supervisor.warnings,
    abr: supervisor.abrStatus,
    stream: {
      ingest: INGEST,
      input: INPUT_PATH,
      output: OUTPUT_PATH,
      inputReady,
      outputReady,
      webrtcPort: WEBRTC_PORT,
      viewerPort: VIEWER_PORT || null,
      liveSince: out?.readyTime ?? null,
      inKbps: receiveRate(out?.bytesReceived),
      lanHost: lanHost(),
    },
  };
}

export async function getObsPayload(): Promise<ObsPayload> {
  try {
    const [sources, encoder, stream, service] = await withObs((obs) =>
      Promise.all([listNetworkSources(obs), getEncoder(obs), getStreamStatus(obs), getStreamService(obs)]),
    );
    return {
      connected: true,
      sources,
      encoder,
      stream,
      service,
      whipUrl: INGEST === "whip" ? WHIP_URL : null,
      stoppedByPanel: stoppedByPanel(stream),
    };
  } catch (e) {
    return { connected: false, error: (e as Error).message };
  }
}

/** Public: served on the viewer port too, so it says whether the stream is live and nothing else. */
export async function getWatch(): Promise<WatchPayload> {
  const paths = await listPaths();
  const live = paths ? paths.some((p) => p.name === OUTPUT_PATH && p.ready) : await probePathReady(OUTPUT_PATH);
  return { live, path: OUTPUT_PATH, webrtcPort: WEBRTC_PORT };
}
