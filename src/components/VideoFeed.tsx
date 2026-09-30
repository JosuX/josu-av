"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ViewerReport } from "@/lib/shared";
import { deviceLabel } from "./format";

type Phase = "connecting" | "playing" | "error";

/** How long to wait for ICE gathering before sending the offer. Host candidates on a LAN take a few ms. */
const ICE_GATHER_MS = 250;
/** A "disconnected" peer connection often recovers by itself; only reconnect if it doesn't within this. */
const DISCONNECT_GRACE_MS = 2000;
/** Reconnect backoff: 500 ms, doubling up to 5 s, reset once playing. */
const RETRY_MIN_MS = 500;
const RETRY_MAX_MS = 5000;
/** How often playback stats go to the server for adaptive bitrate. */
const STATS_EVERY_MS = 5000;

/** The inbound video stats of a connection, in the shape the server expects. */
async function readStats(
  pc: RTCPeerConnection,
  id: string,
  label: string,
  source: ViewerReport["source"],
): Promise<ViewerReport | null> {
  let v: Record<string, number | string | undefined> | undefined;
  (await pc.getStats()).forEach((s) => {
    if (s.type === "inbound-rtp" && s.kind === "video") v = s;
  });
  if (!v) return null;
  const n = (k: string) => (typeof v![k] === "number" ? Math.max(0, v![k] as number) : 0);
  const opt = (k: string) => (typeof v![k] === "number" ? (v![k] as number) : null);
  return {
    id,
    label,
    source,
    hidden: document.visibilityState === "hidden",
    packetsLost: n("packetsLost"),
    packetsReceived: n("packetsReceived"),
    framesDecoded: n("framesDecoded"),
    framesDropped: n("framesDropped"),
    freezeSec: n("totalFreezesDuration"),
    bytesReceived: n("bytesReceived"),
    fps: opt("framesPerSecond"),
    width: opt("frameWidth"),
    height: opt("frameHeight"),
  };
}

/** Minimal WHEP player for a MediaMTX WebRTC path. */
export function VideoFeed({
  path,
  port,
  source = "dashboard",
}: {
  path: string;
  port: number;
  /** Where the player runs; shown next to the device in the viewer list. */
  source?: "dashboard" | "watch page";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);

  useEffect(() => {
    const endpoint = `${location.protocol}//${location.hostname}:${port}/${path}/whep`;
    const pc = new RTCPeerConnection();
    let sessionUrl: string | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    // One id per connection: its counters start from zero. (crypto.randomUUID needs HTTPS.)
    const viewerId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const label = `${deviceLabel(navigator.userAgent)} (${source})`;
    const statsTimer = setInterval(() => {
      if (pc.connectionState !== "connected") return;
      readStats(pc, viewerId, label, source)
        .then((r) =>
          r
            ? fetch("/api/viewers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(r),
              })
            : null,
        )
        .catch(() => {});
    }, STATS_EVERY_MS);

    const fail = (msg: string) => {
      if (cancelled || retry) return;
      setPhase("error");
      setError(msg);
      const delay = Math.min(RETRY_MIN_MS * 2 ** failures.current, RETRY_MAX_MS);
      failures.current++;
      retry = setTimeout(() => setAttempt((a) => a + 1), delay);
    };

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (ev) => {
      // Play as soon as frames arrive instead of building up a playout buffer (LAN, low jitter).
      if ("jitterBufferTarget" in ev.receiver) ev.receiver.jitterBufferTarget = 0;
      const v = videoRef.current;
      if (v && ev.streams[0] && v.srcObject !== ev.streams[0]) v.srcObject = ev.streams[0];
    };
    pc.onconnectionstatechange = () => {
      clearTimeout(grace);
      if (pc.connectionState === "connected") {
        failures.current = 0;
        setPhase("playing");
        setError(null);
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        fail(`connection ${pc.connectionState}`);
      } else if (pc.connectionState === "disconnected") {
        grace = setTimeout(() => fail("connection lost"), DISCONNECT_GRACE_MS);
      }
    };

    (async () => {
      setPhase("connecting");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Wait (briefly) for ICE gathering so the offer carries candidates.
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const t = setTimeout(resolve, ICE_GATHER_MS);
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(t);
            resolve();
          }
        });
      });
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription!.sdp,
      });
      if (!res.ok) throw new Error(`WHEP ${res.status} ${res.statusText}`);
      const loc = res.headers.get("Location");
      if (loc) sessionUrl = new URL(loc, endpoint).toString();
      const answer = await res.text();
      if (cancelled) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    })().catch((e: Error) => fail(e.message));

    return () => {
      cancelled = true;
      clearInterval(statsTimer);
      clearTimeout(retry);
      clearTimeout(grace);
      pc.close();
      if (sessionUrl) fetch(sessionUrl, { method: "DELETE" }).catch(() => {});
    };
  }, [path, port, attempt, source]);

  return (
    <div className="relative overflow-hidden rounded-lg bg-black aspect-video">
      <video ref={videoRef} autoPlay playsInline muted={muted} controls={phase === "playing"} className="h-full w-full" />
      {phase !== "playing" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
          <Loader2 className="size-4 animate-spin" />
          {phase === "connecting" ? "Connecting…" : `Reconnecting — ${error}`}
        </div>
      )}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        {source === "dashboard" && (
          <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white">/{path}</span>
        )}
        {phase === "playing" && (
          <span className="flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
            <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden /> LIVE
          </span>
        )}
      </div>
      {phase === "playing" && muted && (
        <Button size="sm" variant="secondary" onClick={() => setMuted(false)} className="absolute top-3 right-3">
          <VolumeX /> Unmute
        </Button>
      )}
    </div>
  );
}
