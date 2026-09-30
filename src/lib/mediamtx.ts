import "server-only";
import { MEDIAMTX_API, MEDIAMTX_HLS } from "./config";

export interface PathInfo {
  name: string;
  ready: boolean;
  source: string | null;
  tracks: string[];
  readers: number;
  bytesReceived: number;
  /** When the path became ready (ms since epoch), null while not ready. */
  readyTime: number | null;
}

/**
 * Live paths from the MediaMTX control API. Returns null when the API is unreachable
 * (e.g. MediaMTX started outside this app, where the API is disabled in the config).
 */
export async function listPaths(): Promise<PathInfo[] | null> {
  try {
    const res = await fetch(`${MEDIAMTX_API}/v3/paths/list`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items: {
        name: string;
        ready: boolean;
        source: { type: string } | null;
        tracks: string[];
        readers: unknown[];
        bytesReceived: number;
        readyTime: string | null;
      }[];
    };
    return data.items.map((p) => ({
      name: p.name,
      ready: p.ready,
      source: p.source?.type ?? null,
      tracks: p.tracks ?? [],
      readers: p.readers?.length ?? 0,
      bytesReceived: p.bytesReceived ?? 0,
      readyTime: p.readyTime ? Date.parse(p.readyTime) || null : null,
    }));
  } catch {
    return null;
  }
}

/** Fallback readiness check through the HLS server when the API is off. */
export async function probePathReady(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${MEDIAMTX_HLS}/${path}/index.m3u8`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface WebRTCSession {
  id: string;
  /** "read" (a player), "publish" (e.g. OBS over WHIP), or "" while still negotiating. */
  state: "read" | "publish" | "";
  path: string;
  remoteAddr: string;
  created: number;
  /** RTP packets lost on the way in (for a publisher: between OBS and MediaMTX). */
  packetsLost: number;
}

/** WebRTC sessions (players and publishers), or null when the API is unreachable. */
export async function listWebRTCSessions(): Promise<WebRTCSession[] | null> {
  try {
    const res = await fetch(`${MEDIAMTX_API}/v3/webrtcsessions/list`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items: {
        id: string;
        state: string;
        path: string;
        remoteAddr: string;
        created: string;
        inboundRTPPacketsLost?: number;
        rtpPacketsLost?: number;
      }[];
    };
    return data.items.map((s) => ({
      id: s.id,
      state: s.state === "read" || s.state === "publish" ? s.state : "",
      path: s.path,
      remoteAddr: s.remoteAddr,
      created: Date.parse(s.created) || Date.now(),
      packetsLost: s.inboundRTPPacketsLost ?? s.rtpPacketsLost ?? 0,
    }));
  } catch {
    return null;
  }
}
