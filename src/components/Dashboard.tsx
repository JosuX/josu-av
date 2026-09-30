"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Loader2, Play, Square, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ProcessCard } from "./ProcessCard";
import { StreamCard } from "./StreamCard";
import { SystemCharts } from "./SystemCharts";
import { HealthAlerts } from "./HealthAlerts";
import { KpiStrip } from "./KpiStrip";
import { ViewersPanel } from "./ViewersPanel";
import { Reveal } from "./motion";
import { formatDuration } from "./format";
import { fetchStatus, procAction, useNow, useStatus } from "./hooks";
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
    <div className="flex flex-col gap-4 sm:gap-5">
      <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Assembly stream</h1>
          {status && <LiveStatus status={status} />}
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
      </Reveal>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
              <WifiOff className="size-4 shrink-0 text-destructive" />
              <p>
                <span className="font-medium">Lost contact with the control server.</span>{" "}
                <span className="text-muted-foreground">{error}. Retrying…</span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {status && <HealthAlerts warnings={status.warnings} />}

      {status ? (
        <KpiStrip status={status} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={cn("h-[6.5rem] rounded-xl", i === 2 && "col-span-2 lg:col-span-1")} />
          ))}
        </div>
      )}

      {/* The feed leads; viewers and services sit beside it on wide screens, below it on phones. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal index={2} className="min-w-0 lg:col-span-2">
          {status ? <StreamCard status={status} /> : <Skeleton className="aspect-video w-full rounded-xl" />}
        </Reveal>
        <div className="flex min-w-0 flex-col gap-4">
          {status?.abr && (
            <Reveal index={3}>
              <ViewersPanel abr={status.abr} onChange={refresh} />
            </Reveal>
          )}
          {status
            ? procs.map((p, i) => (
                <Reveal key={p.name} index={4 + i}>
                  <ProcessCard proc={p} onChange={refresh} />
                </Reveal>
              ))
            : [0, 1].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
      </div>

      <Reveal index={6} className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">This machine</h2>
        <SystemCharts />
      </Reveal>
    </div>
  );
}

/** LIVE with how long, or Offline. */
function LiveStatus({ status }: { status: StatusPayload }) {
  const now = useNow();
  const { outputReady, liveSince } = status.stream;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={outputReady ? "live" : "off"}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2 }}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
          outputReady ? "border-live/30 bg-live/10 text-live" : "text-muted-foreground",
        )}
      >
        <span className="relative flex size-2">
          {outputReady && <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-70" />}
          <span className={cn("relative inline-flex size-2 rounded-full", outputReady ? "bg-live" : "bg-muted-foreground/60")} />
        </span>
        {outputReady ? "LIVE" : "Offline"}
        {outputReady && liveSince && (
          <span className="font-mono font-normal tabular-nums text-foreground/80">{formatDuration(now - liveSince)}</span>
        )}
      </motion.span>
    </AnimatePresence>
  );
}
