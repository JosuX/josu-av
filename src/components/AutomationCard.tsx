"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Copy } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BITRATE_MAX, BITRATE_MIN, isValidBitrate } from "@/lib/shared";
import type { AutomationEvent, AutomationPayload, AutomationSettings, BitrateMode } from "./types";

type Switchable = "keepStreamLive" | "reconnectCameras" | "keepWhip" | "launchObs";

const MODES: { value: BitrateMode; label: string; description: string }[] = [
  { value: "off", label: "Off", description: "Viewer stats are shown on the dashboard, nothing more." },
  {
    value: "recommend",
    label: "Recommend",
    description: "Suggests a bitrate on the dashboard when viewers struggle, for you to apply.",
  },
  {
    value: "auto",
    label: "Automatic",
    description:
      "Lowers the bitrate when most viewers lose packets and raises it after 10 quiet minutes, live, without restarting the stream. Never above the bitrate saved in Stream output.",
  },
];

const OPTIONS: { key: Switchable; label: string; description: string; whipOnly?: boolean }[] = [
  {
    key: "launchObs",
    label: "Launch OBS",
    description:
      "Opens OBS on the desktop when MediaMTX is running and OBS isn't. Needs someone logged in to the desktop. Turn this off before closing OBS.",
  },
  {
    key: "keepStreamLive",
    label: "Keep stream live",
    description:
      "Starts OBS's stream whenever it is off, e.g. after MediaMTX restarts. Turn this off before ending the stream.",
  },
  {
    key: "reconnectCameras",
    label: "Reconnect cameras",
    description: "Reloads a camera source that errors out or stays stuck loading while it is on screen.",
  },
  {
    key: "keepWhip",
    label: "Keep OBS on WHIP",
    description: "Points OBS back at this panel's WHIP endpoint whenever its stream service changes and it is idle.",
    whipOnly: true,
  },
];

function ScriptStatus({ abr }: { abr: NonNullable<AutomationPayload["abr"]> }) {
  const { script } = abr;
  if (script.state === "ok")
    return (
      <p className="text-xs text-muted-foreground">
        Live bitrate script: loaded{script.encoder ? ` (encoder ${script.encoder})` : ""}.
        {script.encoder && !script.liveCapable && " This encoder only takes a new bitrate when the stream restarts."}
      </p>
    );
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <p>
        To change the bitrate without restarting the stream, add this script in OBS under{" "}
        <strong>Tools → Scripts → +</strong>:
      </p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 rounded border bg-muted/40 px-2 py-1 font-mono break-all">{script.path}</code>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy script path"
          onClick={() => {
            // The clipboard API only exists on HTTPS or localhost.
            if (navigator.clipboard) void navigator.clipboard.writeText(script.path).then(() => toast.success("Path copied"));
            else toast.error("Copying needs HTTPS; select the path instead");
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

const EVENT_COLOR: Record<AutomationEvent["level"], string> = {
  info: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

export function AutomationCard() {
  const [data, setData] = useState<AutomationPayload | null>(null);
  const [saving, setSaving] = useState<keyof AutomationSettings | null>(null);
  const [minDraft, setMinDraft] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/automation", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // The dashboard shows lost contact; keep the last data here.
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const t = setInterval(refresh, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [refresh]);

  const save = async <K extends keyof AutomationSettings>(key: K, value: AutomationSettings[K]) => {
    setSaving(key);
    try {
      const res = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const body = await res.json();
      if (!res.ok) toast.error(body.error ?? "Could not save the setting");
      else setData(body);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSaving(null);
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" />
          Automation
        </CardTitle>
        <CardDescription>
          Runs in the background, even with no browser open. MediaMTX restarts itself after a crash.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        {!data ? (
          <Skeleton className="h-40 w-full lg:col-span-2" />
        ) : (
          <>
            <div className="flex flex-col gap-4">
              {OPTIONS.filter((o) => !o.whipOnly || data.ingest === "whip").map((o) => (
                <div key={o.key} className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`auto-${o.key}`}>{o.label}</Label>
                    <p className="text-xs text-muted-foreground">{o.description}</p>
                  </div>
                  <Switch
                    id={`auto-${o.key}`}
                    checked={data.settings[o.key]}
                    disabled={saving !== null}
                    onCheckedChange={(v) => save(o.key, v)}
                  />
                </div>
              ))}
              <div className="flex flex-col gap-2 border-t pt-4">
                <Label>Adaptive bitrate</Label>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={data.settings.adaptiveBitrate}
                  disabled={saving !== null}
                  onValueChange={(v) => v && save("adaptiveBitrate", v as BitrateMode)}
                  className="w-full [&>*]:flex-1"
                >
                  {MODES.map((m) => (
                    <ToggleGroupItem key={m.value} value={m.value}>
                      {m.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  {MODES.find((m) => m.value === data.settings.adaptiveBitrate)?.description}
                </p>
                <form
                  className="flex items-end gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await save("minBitrate", Number(minDraft));
                    setMinDraft(null);
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="auto-min" className="text-xs font-normal text-muted-foreground">
                      Never below (kbps)
                    </Label>
                    <Input
                      id="auto-min"
                      type="number"
                      inputMode="numeric"
                      min={BITRATE_MIN}
                      max={BITRATE_MAX}
                      step={100}
                      value={minDraft ?? String(data.settings.minBitrate)}
                      onChange={(e) => setMinDraft(e.target.value)}
                      className="h-8 w-28 font-mono"
                    />
                  </div>
                  {minDraft !== null && Number(minDraft) !== data.settings.minBitrate && (
                    <Button size="sm" type="submit" disabled={saving !== null || !isValidBitrate(Number(minDraft))}>
                      Save
                    </Button>
                  )}
                </form>
                {data.abr && <ScriptStatus abr={data.abr} />}
              </div>
              {!data.obsConnected && (
                <p className="text-xs text-muted-foreground">OBS is not connected; OBS automations are paused.</p>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-sm font-medium">Recent activity</p>
              {data.events.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-xs leading-relaxed">
                  {data.events.map((e) => (
                    <li key={e.id} className={cn("break-words", EVENT_COLOR[e.level])}>
                      <span className="text-muted-foreground tabular-nums">
                        {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
                      </span>{" "}
                      {e.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
