"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

type Phase = "connecting" | "playing" | "error";

/** Minimal WHEP player for a MediaMTX WebRTC path. */
export function VideoFeed({ path, port }: { path: string; port: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const endpoint = `${location.protocol}//${location.hostname}:${port}/${path}/whep`;
    const pc = new RTCPeerConnection();
    let sessionUrl: string | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const fail = (msg: string) => {
      if (cancelled) return;
      setPhase("error");
      setError(msg);
      retry = setTimeout(() => setAttempt((a) => a + 1), 3000);
    };

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (ev) => {
      const v = videoRef.current;
      if (v && ev.streams[0] && v.srcObject !== ev.streams[0]) v.srcObject = ev.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setPhase("playing");
        setError(null);
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        fail(`connection ${pc.connectionState}`);
      }
    };

    (async () => {
      setPhase("connecting");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Wait (briefly) for ICE gathering so the offer carries candidates.
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const t = setTimeout(resolve, 1500);
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
      clearTimeout(retry);
      pc.close();
      if (sessionUrl) fetch(sessionUrl, { method: "DELETE" }).catch(() => {});
    };
  }, [path, port, attempt]);

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
        <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white">/{path}</span>
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
