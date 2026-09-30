"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ChevronRight, Copy, ExternalLink, MonitorPlay, QrCode, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { VideoFeed } from "./VideoFeed";
import { ReadyDot } from "./StateBadge";
import { formatDuration } from "./format";
import { useNow } from "./hooks";
import type { StatusPayload } from "./types";

/** "assembly": the path straight from MediaMTX; "watch": the viewer page, as viewers see it. */
type Tab = "assembly" | "watch";
const TAB_KEY = "av:feed-tab";

const isLocalHost = (h: string) => h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127.");

export function StreamCard({ status }: { status: StatusPayload }) {
  const { stream, processes } = status;
  const whip = stream.ingest === "whip";
  const now = useNow();
  const [tab, setTab] = useState<Tab>("assembly");
  const [host, setHost] = useState("localhost");

  useEffect(() => {
    // Browser-only values, read after hydration so the server render matches.
    const t = setTimeout(() => {
      setHost(location.hostname);
      try {
        if (localStorage.getItem(TAB_KEY) === "watch") setTab("watch");
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const pickTab = (v: string) => {
    if (v !== "assembly" && v !== "watch") return;
    setTab(v);
    try {
      localStorage.setItem(TAB_KEY, v);
    } catch {}
  };

  const isUp = (name: string) =>
    processes.some(
      (p) => p.name === name && ((p.state !== "stopped" && p.state !== "crashed") || p.externalPids.length > 0),
    );

  const watchAvailable = stream.viewerPort !== null;
  const activeTab: Tab = tab === "watch" && watchAvailable ? "watch" : "assembly";
  const mediamtxUrl = `http://${host}:${stream.webrtcPort}/${stream.output}`;
  const watchUrl = watchAvailable ? `http://${host}:${stream.viewerPort}/watch` : null;
  // A link other devices can open: this machine's LAN address when the panel is open as localhost.
  const shareHost = isLocalHost(host) && stream.lanHost ? stream.lanHost : host;
  const shareUrl = watchAvailable ? `http://${shareHost}:${stream.viewerPort}/` : null;
  const openUrl = activeTab === "watch" ? watchUrl! : mediamtxUrl;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorPlay className="size-4 text-muted-foreground" /> Live feed
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span>OBS</span>
          {whip ? (
            <>
              <ChevronRight className="size-3" />
              <span>WHIP</span>
            </>
          ) : (
            <span className="hidden sm:contents">
              <ChevronRight className="size-3" />
              <code className="font-mono">/{stream.input}</code>
              <ChevronRight className="size-3" />
              <span>FFmpeg</span>
            </span>
          )}
          <ChevronRight className="size-3" />
          <code className="font-mono">/{stream.output}</code>
          <ChevronRight className="size-3" />
          <span>WebRTC</span>
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          {shareUrl && <ShareViewerPage url={shareUrl} />}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" asChild aria-label={`Open ${activeTab === "watch" ? "/watch" : `/${stream.output}`}`}>
                <a href={openUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Open {activeTab === "watch" ? "the viewer page" : "MediaMTX's player"} in a new tab
            </TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={activeTab} onValueChange={pickTab}>
            <ToggleGroupItem value="assembly" className="font-mono">
              /{stream.output}
            </ToggleGroupItem>
            <ToggleGroupItem value="watch" className="font-mono" disabled={!watchAvailable}>
              /watch
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="text-xs text-muted-foreground">
            {activeTab === "watch" ? "The viewer page, as viewers see it" : "Straight from MediaMTX over WebRTC"}
          </span>
        </div>

        {stream.outputReady ? (
          activeTab === "watch" ? (
            <iframe
              key={watchUrl}
              // Muted: the preview shouldn't start playing sound in the control panel.
              src={`${watchUrl}?muted=1`}
              title="Viewer page"
              allow="autoplay; fullscreen"
              className="aspect-video w-full rounded-lg border-0 bg-black"
            />
          ) : (
            <VideoFeed path={stream.output} port={stream.webrtcPort} />
          )
        ) : (
          <div className="grid aspect-video place-items-center rounded-lg border border-dashed bg-muted/30">
            <div className="flex max-w-xs flex-col items-center gap-2 text-center">
              <VideoOff className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">/{stream.output} is offline</p>
              <p className="text-xs text-muted-foreground">
                {whip
                  ? !isUp("mediamtx")
                    ? "Start MediaMTX. The feed appears as soon as OBS publishes."
                    : "Waiting for OBS to publish over WHIP. Start streaming in OBS, and check its stream service in Settings."
                  : !isUp("ffmpeg")
                    ? "Start MediaMTX and FFmpeg. The feed appears as soon as the WebRTC path is live."
                    : stream.inputReady !== true
                      ? `FFmpeg is waiting for OBS to publish to /${stream.input}.`
                      : "Waiting for FFmpeg to publish…"}
              </p>
            </div>
          </div>
        )}

        <StreamStats status={status} now={now} />
        <ViewerBreakdown status={status} />

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {!whip && <ReadyDot ready={stream.inputReady} label={`/${stream.input}`} />}
          <ReadyDot ready={stream.outputReady} label={`/${stream.output}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function StreamStats({ status, now }: { status: StatusPayload; now: number }) {
  const { stream, paths, abr } = status;
  const out = paths?.find((p) => p.name === stream.output);
  // Every viewer receives the same stream; any one that reports a picture size will do.
  const picture = abr?.viewers.find((v) => v.resolution);
  const target = abr?.streamActive ? abr.current : null;

  const cells: [string, string, string?][] = [
    ["Live for", stream.outputReady && stream.liveSince ? formatDuration(now - stream.liveSince) : "—"],
    [
      "Picture",
      picture ? `${picture.resolution}${picture.fps != null ? ` @ ${Math.round(picture.fps)}` : ""}` : "—",
      picture ? undefined : "Shown once a player reports",
    ],
    [
      "Bitrate",
      stream.inKbps != null ? `${stream.inKbps} kbps` : "—",
      target ? `OBS target ${target} kbps` : undefined,
    ],
    ["Codecs", out?.tracks.length ? out.tracks.join(" · ") : "—"],
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-4">
      {cells.map(([label, value, hint]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="truncate font-mono tabular-nums">{value}</dd>
          {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

function ViewerBreakdown({ status }: { status: StatusPayload }) {
  const { abr, paths, stream } = status;
  const readers = paths?.find((p) => p.name === stream.output)?.readers ?? 0;
  if (!abr) {
    return (
      <p className="text-xs text-muted-foreground">
        {readers} {readers === 1 ? "viewer" : "viewers"} connected
      </p>
    );
  }
  const count = (source: string) => abr.viewers.filter((v) => v.source === source).length;
  const struggling = abr.viewers.filter((v) => !v.hidden && (v.health === "network" || v.health === "device")).length;
  const total = abr.viewers.length + abr.unmeasured;

  const chips: { label: string; n: number; tone?: "bad" }[] = [
    { label: "Dashboard", n: count("dashboard") },
    { label: "Watch page", n: count("watch page") },
    { label: "Other players", n: abr.unmeasured },
    { label: "Struggling", n: struggling, tone: struggling ? "bad" : undefined },
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 font-medium">
        {total} {total === 1 ? "viewer" : "viewers"}
      </span>
      {chips.map((c) => (
        <span
          key={c.label}
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-muted-foreground",
            c.tone === "bad" && "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {c.label} <span className="font-mono tabular-nums">{c.n}</span>
        </span>
      ))}
    </div>
  );
}

/** The viewer page's LAN link, with a QR code for phones. */
function ShareViewerPage({ url }: { url: string }) {
  const [qr, setQr] = useState<string | null>(null);

  const open = (isOpen: boolean) => {
    if (isOpen && !qr)
      QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: "#000000", light: "#ffffff" } })
        .then(setQr)
        .catch(() => {});
  };

  const copy = () => {
    // The clipboard API only exists on HTTPS or localhost.
    if (navigator.clipboard) void navigator.clipboard.writeText(url).then(() => toast.success("Link copied"));
    else toast.error("Copying needs HTTPS; select the link instead");
  };

  return (
    <AlertDialog onOpenChange={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Share the viewer page">
              <QrCode />
            </Button>
          </AlertDialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Share the viewer page</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Share the viewer page</AlertDialogTitle>
          <AlertDialogDescription>
            Anyone on this network can scan the code or open the link to watch. It shows only the video, not the
            controls.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col items-center gap-3">
          <div className="grid size-56 place-items-center rounded-lg bg-white p-2">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
              <img src={qr} alt={`QR code for ${url}`} className="size-full" />
            ) : null}
          </div>
          <div className="flex w-full items-center gap-2">
            <Input readOnly value={url} className="font-mono" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
              <Copy />
            </Button>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
