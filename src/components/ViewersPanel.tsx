"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, Globe, LayoutDashboard, Loader2, Monitor, Smartphone, Tablet, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EASE } from "./motion";
import type { AbrStatus, ViewerInfo } from "./types";

const MODE_LABEL: Record<AbrStatus["mode"], string> = { off: "Adaptive off", recommend: "Recommend", auto: "Automatic" };

const HEALTH: Record<ViewerInfo["health"], { label: string; className: string }> = {
  good: { label: "Smooth", className: "bg-success/15 text-success" },
  network: { label: "Losing packets", className: "bg-destructive/15 text-destructive" },
  device: { label: "Lagging", className: "bg-warning/15 text-warning" },
  unknown: { label: "Measuring…", className: "bg-muted text-muted-foreground" },
};

function DeviceIcon({ label }: { label: string }) {
  const Icon = /iPhone|Android/.test(label) ? Smartphone : /iPad/.test(label) ? Tablet : Monitor;
  return <Icon className="size-4" />;
}

/** Who is watching through the panel, how their playback is going, and adaptive bitrate. */
export function ViewersPanel({ abr, onChange }: { abr: AbrStatus; onChange: () => void }) {
  const [applying, setApplying] = useState(false);
  const canApplyLive = abr.script.state === "ok" && abr.script.liveCapable;
  const rec = abr.recommendation;

  const apply = async (bitrate: number) => {
    setApplying(true);
    try {
      const res = await fetch("/api/abr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bitrate }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) toast.success(`Bitrate set to ${bitrate} kbps`);
      else toast.error(data.error ?? "Could not change the bitrate");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setApplying(false);
    onChange();
  };

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Users className="size-4 text-muted-foreground" />
        <h2 className="font-semibold">Viewers</h2>
        <Badge variant="outline" className="ml-auto font-normal">
          {MODE_LABEL[abr.mode]}
        </Badge>
      </div>

      <AnimatePresence initial={false}>
        {rec && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="m-3 mb-0 flex gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              {rec.direction === "down" ? (
                <ArrowDown className="mt-0.5 size-4 shrink-0 text-warning" />
              ) : (
                <ArrowUp className="mt-0.5 size-4 shrink-0 text-success" />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium">
                  {rec.direction === "down" ? "Lower" : "Raise"} the bitrate to {rec.target.toLocaleString("en-US")} kbps?
                </p>
                <p className="text-xs text-muted-foreground">{rec.reason}.</p>
                {canApplyLive ? (
                  <Button size="sm" className="mt-1 w-max" disabled={applying} onClick={() => apply(rec.target)}>
                    {applying && <Loader2 className="animate-spin" />}
                    Apply without restarting
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {abr.script.state !== "ok"
                      ? "Load the live bitrate script (Settings → Adaptive bitrate) to apply it without a restart, or set it under Stream output."
                      : `The encoder "${abr.script.encoder}" needs a restart; set it under Settings → Stream output.`}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {abr.viewers.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <Users className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {abr.streamActive ? "No one is watching through the panel" : "The stream is off"}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col py-1">
          <AnimatePresence initial={false}>
            {abr.viewers.map((v) => (
              <motion.li
                key={v.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: v.hidden ? 0.55 : 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex items-center gap-3 px-4 py-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <DeviceIcon label={v.label} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{v.label.replace(/ \((dashboard|watch page)\)$/, "")}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      {v.source === "watch page" ? <Globe className="size-3" /> : <LayoutDashboard className="size-3" />}
                      ({v.source})
                    </span>
                  </div>
                  <p className="flex flex-wrap gap-x-1.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                    <span>{v.kbps.toLocaleString("en-US")} kbps</span>
                    {v.resolution && <span>· {v.resolution}{v.fps != null ? `@${Math.round(v.fps)}` : ""}</span>}
                    {v.lossPct >= 0.1 && <span className="text-destructive">· {v.lossPct.toFixed(1)}% lost</span>}
                    {v.dropPct >= 0.1 && <span className="text-warning">· {v.dropPct.toFixed(1)}% dropped</span>}
                    {v.freezeSec >= 0.1 && <span className="text-warning">· {v.freezeSec.toFixed(1)}s frozen</span>}
                    {v.hidden && <span>· in background</span>}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", HEALTH[v.health].className)}>
                  {HEALTH[v.health].label}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {(abr.unmeasured > 0 || abr.lastChange) && (
        <div className="flex flex-col gap-1 border-t px-4 py-2.5 text-xs text-muted-foreground">
          {abr.unmeasured > 0 && (
            <p>
              +{abr.unmeasured} {abr.unmeasured === 1 ? "player" : "players"} outside the panel (not measurable)
            </p>
          )}
          {abr.lastChange && (
            <p>
              Last change {new Date(abr.lastChange.ts).toLocaleTimeString([], { hour12: false })}:{" "}
              {abr.lastChange.from.toLocaleString("en-US")} → {abr.lastChange.to.toLocaleString("en-US")} kbps (
              {abr.lastChange.auto ? "automatic" : "manual"}, {abr.lastChange.reason})
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
