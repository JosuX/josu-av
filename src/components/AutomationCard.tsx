"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AutomationEvent, AutomationPayload, AutomationSettings } from "./types";

const OPTIONS: { key: keyof AutomationSettings; label: string; description: string; whipOnly?: boolean }[] = [
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

const EVENT_COLOR: Record<AutomationEvent["level"], string> = {
  info: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

export function AutomationCard() {
  const [data, setData] = useState<AutomationPayload | null>(null);
  const [saving, setSaving] = useState<keyof AutomationSettings | null>(null);

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

  const toggle = async (key: keyof AutomationSettings, value: boolean) => {
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
                    onCheckedChange={(v) => toggle(o.key, v)}
                  />
                </div>
              ))}
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
