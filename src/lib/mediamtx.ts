import "server-only";
import { MEDIAMTX_API, MEDIAMTX_HLS } from "./config";

export interface PathInfo {
  name: string;
  ready: boolean;
  source: string | null;
  tracks: string[];
  readers: number;
  bytesReceived: number;
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
      }[];
    };
    return data.items.map((p) => ({
      name: p.name,
      ready: p.ready,
      source: p.source?.type ?? null,
      tracks: p.tracks ?? [],
      readers: p.readers?.length ?? 0,
      bytesReceived: p.bytesReceived ?? 0,
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
