"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AbrStatus, ViewerInfo } from "./types";

const MODE_LABEL: Record<AbrStatus["mode"], string> = { off: "Off", recommend: "Recommend", auto: "Automatic" };

const HEALTH: Record<ViewerInfo["health"], { label: string; className: string }> = {
  good: { label: "Smooth", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  network: { label: "Losing packets", className: "bg-destructive/15 text-destructive" },
  device: { label: "Device lagging", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  unknown: { label: "Measuring…", className: "bg-muted text-muted-foreground" },
};

/** Viewers' playback quality and the adaptive bitrate state. */
export function ViewerHealthCard({ abr, onChange }: { abr: AbrStatus; onChange: () => void }) {
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" /> Viewers &amp; bitrate
        </CardTitle>
        <CardDescription>Playback quality reported by this panel&apos;s players.</CardDescription>
        <CardAction>
          <Badge variant="outline">Adaptive: {MODE_LABEL[abr.mode]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Stat
            label="Bitrate"
            value={abr.current ? `${abr.current}${abr.ceiling && abr.ceiling !== abr.current ? ` / ${abr.ceiling}` : ""} kbps` : "—"}
          />
          <Stat label="Measured output" value={abr.outputKbps != null ? `${abr.outputKbps} kbps` : "—"} />
          <Stat label="Floor" value={`${abr.min} kbps`} />
        </dl>

        {rec && (
          <Alert>
            {rec.direction === "down" ? <ArrowDown /> : <ArrowUp />}
            <AlertTitle>
              {rec.direction === "down" ? "Lower" : "Raise"} the bitrate to {rec.target} kbps?
            </AlertTitle>
            <AlertDescription>
              <p>{rec.reason}.</p>
              {canApplyLive ? (
                <Button size="sm" className="mt-2" disabled={applying} onClick={() => apply(rec.target)}>
                  {applying && <Loader2 className="animate-spin" />}
                  Apply without restarting
                </Button>
              ) : (
                <p>
                  {abr.script.state !== "ok"
                    ? "Add the live bitrate script in OBS (see Settings → Automation) to apply it without a restart, or"
                    : `The encoder "${abr.script.encoder}" needs a restart for a new bitrate;`}{" "}
                  set it under Settings → Stream output, which restarts the stream.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {abr.lastChange && (
          <p className="text-xs text-muted-foreground">
            Last change {new Date(abr.lastChange.ts).toLocaleTimeString([], { hour12: false })}:{" "}
            {abr.lastChange.from} → {abr.lastChange.to} kbps ({abr.lastChange.auto ? "automatic" : "manual"},{" "}
            {abr.lastChange.reason}).
          </p>
        )}

        {abr.viewers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {abr.streamActive ? "No one is watching through the panel." : "The stream is off."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 font-normal">Viewer</th>
                  <th className="pb-1 font-normal">Status</th>
                  <th className="pb-1 text-right font-normal">Loss</th>
                  <th className="pb-1 text-right font-normal">Dropped</th>
                  <th className="pb-1 text-right font-normal">Frozen</th>
                  <th className="pb-1 text-right font-normal">Receiving</th>
                  <th className="hidden pb-1 text-right font-normal sm:table-cell">Picture</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {abr.viewers.map((v) => (
                  <tr key={v.id} className={cn("border-t", v.hidden && "opacity-60")}>
                    <td className="py-1.5 pr-2 font-sans whitespace-nowrap">
                      {v.label}
                      {v.hidden && <span className="text-xs text-muted-foreground"> (in background)</span>}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className={cn("rounded px-1.5 py-0.5 font-sans text-xs whitespace-nowrap", HEALTH[v.health].className)}>
                        {HEALTH[v.health].label}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{v.lossPct.toFixed(1)}%</td>
                    <td className="py-1.5 text-right">{v.dropPct.toFixed(1)}%</td>
                    <td className="py-1.5 text-right">{v.freezeSec.toFixed(1)}s</td>
                    <td className="py-1.5 text-right whitespace-nowrap">{v.kbps} kbps</td>
                    <td className="hidden py-1.5 text-right whitespace-nowrap sm:table-cell">
                      {v.resolution ?? "—"}
                      {v.fps != null ? ` @${Math.round(v.fps)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {abr.unmeasured > 0 && (
          <p className="text-xs text-muted-foreground">
            {abr.unmeasured} other {abr.unmeasured === 1 ? "viewer watches" : "viewers watch"} outside the panel (e.g.
            MediaMTX&apos;s player page) and can&apos;t be measured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}
