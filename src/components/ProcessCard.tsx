"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Copy, Loader2, Play, RotateCw, ScrollText, Server, Square, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { EASE } from "./motion";
import type { ProcStatus } from "./types";

export function ProcessCard({ proc, onChange }: { proc: ProcStatus; onChange: () => void }) {
  const [busy, setBusy] = useState<ProcAction | null>(null);
  const [details, setDetails] = useState(false);
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

  const facts = [
    proc.startedAt ? `up ${formatDuration(now - proc.startedAt)}` : null,
    proc.pid ? `pid ${proc.pid}` : external ? `pid ${proc.externalPids.join(", ")}` : null,
    proc.autoRestart
      ? `${proc.restarts} ${proc.restarts === 1 ? "restart" : "restarts"}`
      : proc.exitSignal ?? (proc.exitCode !== null ? `exit ${proc.exitCode}` : null),
  ].filter(Boolean);

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Server className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{proc.label}</h2>
            <StateBadge state={displayState} />
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground tabular-nums">
            {facts.length ? facts.join(" · ") : proc.description}
          </p>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {(proc.state === "crashed" && proc.note) || external ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 px-4 pb-3">
              {proc.state === "crashed" && proc.note && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>Not restarting automatically</AlertTitle>
                  <AlertDescription>
                    {proc.note[0].toUpperCase() + proc.note.slice(1)}. Check the logs, then start it again.
                  </AlertDescription>
                </Alert>
              )}
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
                            This sends a stop signal to PID {proc.externalPids.join(", ")}. Anything watching the stream
                            through it will disconnect.
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
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex items-center gap-1.5 border-t px-3 py-2">
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => run("stop")}
            disabled={busy !== null || proc.state === "stopping"}
          >
            {busy === "stop" || proc.state === "stopping" ? <Loader2 className="animate-spin" /> : <Square />}
            Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => run("start")} disabled={busy !== null || external}>
            {busy === "start" ? <Loader2 className="animate-spin" /> : <Play />}
            Start
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => run("restart")} disabled={busy !== null || !active}>
          {busy === "restart" ? <Loader2 className="animate-spin" /> : <RotateCw />}
          Restart
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/logs?view=${proc.name}`}>
            <ScrollText />
            Logs
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={() => setDetails((d) => !d)}
          aria-expanded={details}
        >
          Details
          <ChevronDown className={cn("transition-transform", details && "rotate-180")} />
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {details && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-2 border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">{proc.description}</p>
              <div className="relative rounded-md border bg-muted/40 px-3 py-2 pr-9">
                <code className="block font-mono text-xs leading-relaxed break-all text-muted-foreground">{proc.command}</code>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1.5 right-1.5"
                      aria-label="Copy command"
                      onClick={() => {
                        if (navigator.clipboard)
                          void navigator.clipboard.writeText(proc.command).then(() => toast.success("Command copied"));
                        else toast.error("Copying needs HTTPS; select the command instead");
                      }}
                    >
                      <Copy />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy command</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
