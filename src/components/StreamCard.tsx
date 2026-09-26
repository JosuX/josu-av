"use client";

import { ChevronRight, ExternalLink, MonitorPlay, TriangleAlert, VideoOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VideoFeed } from "./VideoFeed";
import { ReadyDot } from "./StateBadge";
import type { StatusPayload } from "./types";

export function StreamCard({ status }: { status: StatusPayload }) {
  const { stream, paths, processes } = status;
  const out = paths?.find((p) => p.name === stream.output);
  const ffmpegUp = processes.some(
    (p) => p.name === "ffmpeg" && (p.state !== "stopped" && p.state !== "crashed" || p.externalPids.length > 0),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorPlay className="size-4 text-muted-foreground" /> Live feed
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span>OBS</span>
          <span className="hidden sm:contents">
            <ChevronRight className="size-3" />
            <code className="font-mono">/{stream.input}</code>
            <ChevronRight className="size-3" />
            <span>FFmpeg</span>
          </span>
          <ChevronRight className="size-3" />
          <code className="font-mono">/{stream.output}</code>
          <ChevronRight className="size-3" />
          <span>WebRTC</span>
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {out && stream.outputReady && (
            <Badge variant="secondary" className="font-mono">
              {out.readers} {out.readers === 1 ? "viewer" : "viewers"}
            </Badge>
          )}
          {stream.outputReady && (
            <Button variant="ghost" size="icon-sm" asChild aria-label="Open MediaMTX player">
              <a
                href={`//${typeof window !== "undefined" ? location.hostname : "localhost"}:${stream.webrtcPort}/${stream.output}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink />
              </a>
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {stream.outputReady ? (
          <VideoFeed path={stream.output} port={stream.webrtcPort} />
        ) : (
          <div className="grid aspect-video place-items-center rounded-lg border border-dashed bg-muted/30">
            <div className="flex max-w-xs flex-col items-center gap-2 text-center">
              <VideoOff className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">/{stream.output} is offline</p>
              <p className="text-xs text-muted-foreground">
                {!ffmpegUp
                  ? "Start MediaMTX and FFmpeg. The feed appears as soon as the WebRTC path is live."
                  : stream.inputReady !== true
                    ? `FFmpeg is waiting for OBS to publish to /${stream.input}.`
                    : "Waiting for FFmpeg to publish…"}
              </p>
            </div>
          </div>
        )}
        {stream.outputReady && out?.tracks.includes("H265") && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>The video is H.265 (HEVC)</AlertTitle>
            <AlertDescription>
              Most browsers can&apos;t play H.265 over WebRTC, so the feed may not appear. Set OBS&apos;s video
              encoder to an H.264 option (x264, NVENC H.264 or QuickSync H.264) and restart streaming.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <ReadyDot ready={stream.inputReady} label={`/${stream.input}`} />
          <ReadyDot ready={stream.outputReady} label={`/${stream.output}`} />
          {out?.tracks.length ? (
            <span className="text-xs text-muted-foreground">Tracks: {out.tracks.join(", ")}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
