import "server-only";
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
