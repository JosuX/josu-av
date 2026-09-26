"use client";

import { useState } from "react";
import { Loader2, Play, Square, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessCard } from "./ProcessCard";
import { StreamCard } from "./StreamCard";
import { SystemCharts } from "./SystemCharts";
import { procAction, useStatus } from "./hooks";

export function Dashboard() {
  const { status, error, refresh } = useStatus();
  const [bulk, setBulk] = useState<"start" | "stop" | null>(null);

  const procs = status?.processes ?? [];
  const anyActive = procs.some((p) => p.state !== "stopped" && p.state !== "crashed");
  const anyExternal = procs.some((p) => p.externalPids.length > 0);

  const startAll = async () => {
    setBulk("start");
    // MediaMTX first so FFmpeg has something to connect to.
    for (const name of ["mediamtx", "ffmpeg"] as const) {
      const p = procs.find((x) => x.name === name);
      if (p && (p.state === "stopped" || p.state === "crashed")) {
        if (!(await procAction(name, "start"))) break;
        if (name === "mediamtx") await new Promise((r) => setTimeout(r, 1000));
      }
    }
    setBulk(null);
    void refresh();
  };

  const stopAll = async () => {
    setBulk("stop");
    await procAction("ffmpeg", "stop");
    await procAction("mediamtx", "stop");
    setBulk(null);
    void refresh();
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Assembly stream</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">Control the media server and the WebRTC transcode.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" onClick={stopAll} disabled={!status || bulk !== null || !anyActive}>
            {bulk === "stop" ? <Loader2 className="animate-spin" /> : <Square />}
            Stop all
          </Button>
          <Button onClick={startAll} disabled={!status || bulk !== null || anyExternal}>
            {bulk === "start" ? <Loader2 className="animate-spin" /> : <Play />}
            Start all
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <WifiOff />
          <AlertTitle>Lost contact with the control server</AlertTitle>
          <AlertDescription>{error}. Retrying…</AlertDescription>
        </Alert>
      )}

      <SystemCharts />

      {/* Video first; process cards sit beside it from landscape tablets up, in a row below it on portrait tablets. */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-3">
          {status ? <StreamCard status={status} /> : <Skeleton className="aspect-video w-full rounded-xl" />}
        </div>
        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
          {status
            ? procs.map((p) => <ProcessCard key={p.name} proc={p} onChange={refresh} />)
            : [0, 1].map((i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}
