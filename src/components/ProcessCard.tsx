"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Play, RotateCw, ScrollText, Square, TriangleAlert, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { StateBadge } from "./StateBadge";
import { procAction, useNow, type ProcAction } from "./hooks";
import { formatDuration } from "./format";
import type { ProcStatus } from "./types";

export function ProcessCard({ proc, onChange }: { proc: ProcStatus; onChange: () => void }) {
  const [busy, setBusy] = useState<ProcAction | null>(null);
  const [showCmd, setShowCmd] = useState(false);
  const now = useNow();

  const run = async (action: ProcAction) => {
    setBusy(action);
    const ok = await procAction(proc.name, action);
    if (ok && action !== "clear-logs") {
      toast.success(`${proc.label}: ${action === "kill-external" ? "external process stopped" : `${action} requested`}`);
    }
    setBusy(null);
    onChange();
  };

  const active = proc.state !== "stopped" && proc.state !== "crashed";
  const external = proc.externalPids.length > 0;
  const displayState = !active && external ? "external" : proc.state;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{proc.label}</CardTitle>
        <CardDescription>{proc.description}</CardDescription>
        <CardAction>
          <StateBadge state={displayState} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <dl className="grid grid-cols-3 gap-2 text-sm sm:gap-3">
          <Stat label="PID" value={proc.pid ?? (external ? proc.externalPids.join(", ") : "—")} />
          <Stat label="Uptime" value={proc.startedAt ? formatDuration(now - proc.startedAt) : "—"} />
          <Stat
            label={proc.autoRestart ? "Restarts" : "Last exit"}
            value={
              proc.autoRestart
                ? proc.restarts
                : proc.exitSignal ?? (proc.exitCode !== null ? `code ${proc.exitCode}` : "—")
            }
          />
        </dl>

        <div className="group relative rounded-md border bg-muted/40 px-3 py-2 pr-9">
          {/* Clamped on phones; tap to expand. */}
          <button
            type="button"
            onClick={() => setShowCmd((v) => !v)}
            className="block w-full text-left sm:pointer-events-none"
            aria-expanded={showCmd}
          >
            <code
              className={cn(
                "block font-mono text-xs leading-relaxed break-all text-muted-foreground",
                !showCmd && "line-clamp-2 sm:line-clamp-none",
              )}
            >
              {proc.command}
            </code>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1.5 right-1.5"
                aria-label="Copy command"
                onClick={() => {
                  void navigator.clipboard.writeText(proc.command);
                  toast.success("Command copied");
                }}
              >
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy command</TooltipContent>
          </Tooltip>
        </div>

        {external && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>Already running outside this app</AlertTitle>
            <AlertDescription>
              <p>
                PID {proc.externalPids.join(", ")} was started elsewhere (terminal or systemd). Stop it before
                starting it here, otherwise ports will conflict.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="mt-2" disabled={busy !== null}>
                    Stop external process
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Stop external {proc.label}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This sends a stop signal to PID {proc.externalPids.join(", ")}. Anything watching the
                      stream through it will disconnect.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => run("kill-external")}>
                      Stop process
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      <CardFooter className="flex-wrap gap-2">
        {active ? (
          <Button variant="destructive" onClick={() => run("stop")} disabled={busy !== null || proc.state === "stopping"}>
            {busy === "stop" || proc.state === "stopping" ? <Loader2 className="animate-spin" /> : <Square />}
            Stop
          </Button>
        ) : (
          <Button onClick={() => run("start")} disabled={busy !== null || external}>
            {busy === "start" ? <Loader2 className="animate-spin" /> : <Play />}
            Start
          </Button>
        )}
        <Button variant="outline" onClick={() => run("restart")} disabled={busy !== null || !active}>
          {busy === "restart" ? <Loader2 className="animate-spin" /> : <RotateCw />}
          Restart
        </Button>
        <Button variant="ghost" className="ml-auto" asChild>
          <Link href={`/logs?view=${proc.name}`}>
            <ScrollText />
            Logs
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
