"use client";

import { useState } from "react";
import { Loader2, Play, Square, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessCard } from "./ProcessCard";
import { StreamCard } from "./StreamCard";
import { SystemCharts } from "./SystemCharts";
import { HealthAlerts } from "./HealthAlerts";
import { fetchStatus, procAction, useStatus } from "./hooks";
import type { ProcName, StatusPayload } from "./types";

const READY_TIMEOUT_MS = 5000;

/**
 * Whether `name` is up far enough for the next process to use it. For MediaMTX that is
 * its control API answering (paths !== null), which happens once it is listening.
 */
function isReady(s: StatusPayload, name: ProcName) {
  const p = s.processes.find((x) => x.name === name);
  if (p?.state !== "running") return false;
  return name !== "mediamtx" || s.paths !== null;
}

async function waitUntilReady(name: ProcName) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const s = await fetchStatus().catch(() => null);
    if (s && isReady(s, name)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function Dashboard() {
  const { status, error, refresh } = useStatus();
  const [bulk, setBulk] = useState<"start" | "stop" | null>(null);

  const procs = status?.processes ?? [];
  const anyActive = procs.some((p) => p.state !== "stopped" && p.state !== "crashed");
  const anyExternal = procs.some((p) => p.externalPids.length > 0);

  // The server lists processes in dependency order (MediaMTX before FFmpeg).
  const startAll = async () => {
    setBulk("start");
    for (const [i, p] of procs.entries()) {
      if (p.state === "stopped" || p.state === "crashed") {
        if (!(await procAction(p.name, "start"))) break;
      }
      // Give the next process something to connect to.
      if (i < procs.length - 1) await waitUntilReady(p.name);
    }
    setBulk(null);
    void refresh();
  };

  const stopAll = async () => {
    setBulk("stop");
    for (const p of procs.toReversed()) await procAction(p.name, "stop");
    setBulk(null);
    void refresh();
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Assembly stream</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">Control the media server and the WebRTC feed.</p>
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

      {status && <HealthAlerts warnings={status.warnings} />}

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
