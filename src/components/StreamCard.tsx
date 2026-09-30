"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Copy, ExternalLink, QrCode, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { VideoFeed } from "./VideoFeed";
import { ReadyDot } from "./StateBadge";
import { Segmented } from "./motion";
import ShinyText from "./reactbits/ShinyText";
import type { StatusPayload } from "./types";

/** "assembly": the path straight from MediaMTX; "watch": the viewer page, as viewers see it. */
type Tab = "assembly" | "watch";
const TAB_KEY = "av:feed-tab";

const isLocalHost = (h: string) => h === "localhost" || h === "::1" || h === "[::1]" || h.startsWith("127.");

export function StreamCard({ status }: { status: StatusPayload }) {
  const { stream, processes } = status;
  const whip = stream.ingest === "whip";
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
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight">Live feed</h2>
          <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            <span>OBS</span>
            <ChevronRight className="size-3" />
            {whip ? (
              <span>WHIP</span>
            ) : (
              <>
                <code className="font-mono">/{stream.input}</code>
                <ChevronRight className="size-3" />
                <span>FFmpeg</span>
              </>
            )}
            <ChevronRight className="size-3" />
            <code className="font-mono">/{stream.output}</code>
            <ChevronRight className="size-3" />
            <span>WebRTC</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Segmented
            aria-label="Preview"
            value={activeTab}
            onValueChange={pickTab}
            options={[
              { value: "assembly", label: `/${stream.output}`, className: "font-mono" },
              { value: "watch", label: "/watch", className: "font-mono", disabled: !watchAvailable },
            ]}
          />
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
        </div>
      </div>

      <div className="relative bg-black">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={stream.outputReady ? activeTab : "offline"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {stream.outputReady ? (
              activeTab === "watch" ? (
                <iframe
                  key={watchUrl}
                  // Muted: the preview shouldn't start playing sound in the control panel.
                  src={`${watchUrl}?muted=1`}
                  title="Viewer page"
                  allow="autoplay; fullscreen"
                  className="block aspect-video w-full border-0 bg-black"
                />
              ) : (
                <VideoFeed path={stream.output} port={stream.webrtcPort} />
              )
            ) : (
              <div className="grid aspect-video place-items-center bg-[radial-gradient(ellipse_at_center,var(--color-neutral-900),black_75%)]">
                <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
                  <span className="grid size-12 place-items-center rounded-full bg-white/5 ring-1 ring-white/10">
                    <VideoOff className="size-5 text-white/60" />
                  </span>
                  <p className="text-sm font-medium text-white">/{stream.output} is offline</p>
                  <ShinyText
                    className="text-xs"
                    color="rgba(255,255,255,0.5)"
                    shineColor="rgba(255,255,255,0.95)"
                    speed={3}
                    text={
                      whip
                        ? !isUp("mediamtx")
                          ? "Start MediaMTX. The feed appears as soon as OBS publishes."
                          : "Waiting for OBS to publish over WHIP…"
                        : !isUp("ffmpeg")
                          ? "Start MediaMTX and FFmpeg to bring the feed up."
                          : stream.inputReady !== true
                            ? `FFmpeg is waiting for OBS to publish to /${stream.input}…`
                            : "Waiting for FFmpeg to publish…"
                    }
                  />
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {!whip && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5">
          <ReadyDot ready={stream.inputReady} label={`/${stream.input}`} />
          <ReadyDot ready={stream.outputReady} label={`/${stream.output}`} />
        </div>
      )}
    </Card>
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
