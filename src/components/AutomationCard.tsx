"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bot, Check, Copy, Gauge, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BITRATE_MAX, BITRATE_MIN, isValidBitrate } from "@/lib/shared";
import { EASE, Segmented } from "./motion";
import { SettingsSection } from "./SettingsSection";
import { useLive } from "./hooks";
import type { AutomationPayload, AutomationSettings, BitrateMode } from "./types";

type Switchable = "keepStreamLive" | "reconnectCameras" | "keepWhip" | "launchObs";

const OPTIONS: { key: Switchable; label: string; description: string; whipOnly?: boolean }[] = [
  {
    key: "launchObs",
    label: "Launch OBS",
    description: "Opens OBS when MediaMTX runs and OBS doesn't. Needs a desktop session; turn off before closing OBS.",
  },
  {
    key: "keepStreamLive",
    label: "Keep stream live",
    description: "Starts OBS's stream whenever it's off, e.g. after MediaMTX restarts. Turn off before ending the stream.",
  },
  {
    key: "reconnectCameras",
    label: "Reconnect cameras",
    description: "Reloads a camera source that errors out or stays stuck loading while on screen.",
  },
  {
    key: "keepWhip",
    label: "Keep OBS on WHIP",
    description: "Points OBS back at this panel's WHIP endpoint whenever it changes and the stream is idle.",
    whipOnly: true,
  },
];

const MODES: { value: BitrateMode; label: string; description: string }[] = [
  { value: "off", label: "Off", description: "Viewer stats are shown on the dashboard, nothing more." },
  { value: "recommend", label: "Recommend", description: "Suggests a lower bitrate on the dashboard when viewers struggle." },
  {
    value: "auto",
    label: "Automatic",
    description:
      "Lowers the bitrate live when most viewers struggle, and raises it after 10 smooth minutes. Never above the bitrate in Stream output.",
  },
];

/** The automation switches and adaptive bitrate, as two Settings sections sharing one live feed. */
export function AutomationSections() {
  const { data, setData } = useLive<AutomationPayload>("automation", "/api/automation");
  const [saving, setSaving] = useState<keyof AutomationSettings | null>(null);
  const [minDraft, setMinDraft] = useState<string | null>(null);

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
    <>
      <SettingsSection
        id="automation"
        icon={Bot}
        title="Automation"
        description="Runs in the background, even with no browser open. MediaMTX also restarts itself after a crash."
        action={
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <Link href="/logs?view=automation">
              Activity <ArrowRight />
            </Link>
          </Button>
        }
      >
        {!data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="flex flex-col divide-y">
            {OPTIONS.filter((o) => !o.whipOnly || data.ingest === "whip").map((o) => (
              <div key={o.key} className="flex items-start justify-between gap-6 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`auto-${o.key}`} className="text-sm">
                    {o.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{o.description}</p>
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  {saving === o.key && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                  <Switch
                    id={`auto-${o.key}`}
                    checked={data.settings[o.key]}
                    disabled={saving !== null}
                    onCheckedChange={(v) => save(o.key, v)}
                  />
                </div>
              </div>
            ))}
            {!data.obsConnected && (
              <p className="pt-3 text-xs text-muted-foreground">OBS isn&apos;t connected, so the OBS automations are paused.</p>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        id="adaptive"
        icon={Gauge}
        title="Adaptive bitrate"
        description="Uses viewers' playback stats to pick one bitrate that plays smoothly for most of them."
      >
        {!data ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Segmented
                aria-label="Adaptive bitrate mode"
                size="md"
                value={data.settings.adaptiveBitrate}
                onValueChange={(v) => save("adaptiveBitrate", v as BitrateMode)}
                options={MODES.map((m) => ({ value: m.value, label: m.label, className: "flex-1" }))}
                className="flex w-full sm:w-auto sm:max-w-md"
              />
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={data.settings.adaptiveBitrate}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="text-xs text-muted-foreground"
                >
                  {MODES.find((m) => m.value === data.settings.adaptiveBitrate)?.description}
                </motion.p>
              </AnimatePresence>
            </div>

            <form
              className="flex items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await save("minBitrate", Number(minDraft));
                setMinDraft(null);
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="auto-min">Never below</Label>
                <div className="relative">
                  <Input
                    id="auto-min"
                    type="number"
                    inputMode="numeric"
                    min={BITRATE_MIN}
                    max={BITRATE_MAX}
                    step={100}
                    value={minDraft ?? String(data.settings.minBitrate)}
                    onChange={(e) => setMinDraft(e.target.value)}
                    className="w-40 pr-12 font-mono"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                    kbps
                  </span>
                </div>
              </div>
              <AnimatePresence>
                {minDraft !== null && Number(minDraft) !== data.settings.minBitrate && (
                  <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}>
                    <Button type="submit" disabled={saving !== null || !isValidBitrate(Number(minDraft))}>
                      Save
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>

            {data.abr && <ScriptStatus abr={data.abr} />}
          </div>
        )}
      </SettingsSection>
    </>
  );
}

function ScriptStatus({ abr }: { abr: NonNullable<AutomationPayload["abr"]> }) {
  const { script } = abr;
  if (script.state === "ok")
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs">
        <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Live bitrate script loaded</span>
          {script.encoder ? ` (encoder ${script.encoder})` : ""}.
          {script.encoder && !script.liveCapable && " This encoder only takes a new bitrate when the stream restarts."}
        </p>
      </div>
    );
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
      <p>
        To change the bitrate without restarting the stream, add this script in OBS under{" "}
        <strong className="text-foreground">Tools → Scripts → +</strong>:
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
