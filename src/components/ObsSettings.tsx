"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Gauge, Loader2, Play, PlugZap, RadioTower, RotateCw, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { BITRATE_MAX, BITRATE_MIN, isValidBitrate } from "@/lib/shared";
import { StateBadge } from "./StateBadge";
import { formatBytes, formatDuration } from "./format";
import type { ObsPayload } from "./types";

type Busy = "url" | "bitrate" | "restart" | "whip" | null;

type ActionResult = { ok: true; effectiveBitrate?: number | null; savedBitrate?: number | null } | null;

async function obsAction(body: Record<string, unknown>): Promise<ActionResult> {
  try {
    const res = await fetch("/api/obs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      effectiveBitrate?: number | null;
      savedBitrate?: number | null;
    };
    if (!res.ok) {
      toast.error(data.error ?? "OBS request failed");
      return null;
    }
    return { ok: true, effectiveBitrate: data.effectiveBitrate, savedBitrate: data.savedBitrate };
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  }
}

export function ObsSettings() {
  const [obs, setObs] = useState<ObsPayload | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // Drafts stay untouched by polling until saved or reset.
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [bitrateDraft, setBitrateDraft] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/obs", { cache: "no-store" });
      setObs(await res.json());
    } catch (e) {
      setObs({ connected: false, error: (e as Error).message });
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

  const run = async (kind: Exclude<Busy, null>, body: Record<string, unknown>, success?: string) => {
    setBusy(kind);
    const result = await obsAction(body);
    if (result && success) toast.success(success);
    setBusy(null);
    await refresh();
    return result;
  };

  if (!obs) {
    return (
      <Layout>
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </Layout>
    );
  }

  if (!obs.connected) {
    return (
      <Layout>
        <Alert variant="destructive" className="lg:col-span-2">
          <PlugZap />
          <AlertTitle>Not connected to OBS</AlertTitle>
          <AlertDescription>
            <p>{obs.error}</p>
            <p>
              In OBS open <strong>Tools → WebSocket Server Settings</strong> and tick{" "}
              <strong>Enable WebSocket server</strong>. The password is read from OBS&apos;s config automatically.
            </p>
          </AlertDescription>
        </Alert>
      </Layout>
    );
  }

  const { sources, encoder, stream, service, whipUrl, stoppedByPanel } = obs;
  const needsWhip = whipUrl !== null && !(service.type === "whip_custom" && service.server === whipUrl);
  const bitrate = bitrateDraft ?? String(encoder.bitrate);
  const bitrateNum = Number(bitrate);
  const bitrateValid = isValidBitrate(bitrateNum);
  const bitrateDirty = bitrateDraft !== null && bitrateNum !== encoder.bitrate;
  const applyBitrate = bitrateDirty && bitrateValid && !encoder.unsupported;

  const restart = async () => {
    if (!applyBitrate) {
      await run("restart", { action: "restart-stream" }, stream.active ? "Stream restarted" : "Stream started");
      return;
    }
    const result = await run("bitrate", { action: "set-bitrate", bitrate: bitrateNum, restart: true });
    if (!result) return;
    setBitrateDraft(null);
    const eff = result.effectiveBitrate;
    if (result.savedBitrate !== bitrateNum)
      toast.error(
        `OBS overwrote the saved bitrate (now ${result.savedBitrate ?? "unset"} kbps). Close OBS's Settings dialog and try again.`,
      );
    else if (eff === bitrateNum) toast.success(`OBS is now streaming at ${eff} kbps`);
    else if (eff == null) toast.warning(`Saved ${bitrateNum} kbps, but couldn't confirm it from the OBS log`);
    else toast.error(`Saved ${bitrateNum} kbps, but OBS started at ${eff} kbps`);
  };
  const streamState = stream.reconnecting ? "restarting" : stream.active ? "running" : "stopped";

  return (
    <Layout>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="size-4" />
            Camera source
          </CardTitle>
          <CardDescription>The IP camera URL OBS reads from. Changes apply immediately.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {sources.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No network media sources in OBS. Add a Media Source with “Local File” unticked.
            </p>
          )}
          {sources.map((s) => {
            const draft = urlDrafts[s.name] ?? s.url;
            const dirty = draft.trim() !== s.url;
            const id = `src-${s.name}`;
            return (
              <form
                key={s.name}
                className="flex flex-col gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await run("url", { action: "set-source-url", input: s.name, url: draft }, `${s.name} updated`);
                  if (ok)
                    setUrlDrafts((d) => {
                      const rest = { ...d };
                      delete rest[s.name];
                      return rest;
                    });
                }}
              >
                <Label htmlFor={id}>{s.name}</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={id}
                    value={draft}
                    onChange={(e) => setUrlDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                    placeholder="rtsp://user:pass@192.168.1.10:554/stream"
                    className="font-mono text-sm"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <Button type="submit" disabled={!dirty || busy !== null}>
                    {busy === "url" ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                </div>
              </form>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="size-4" />
            Stream output
          </CardTitle>
          <CardDescription>
            Profile “{encoder.profile}” · {encoder.encoder} · {encoder.rateControl}
          </CardDescription>
          <CardAction>
            <StateBadge state={streamState} />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {stoppedByPanel && !stream.active && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>The stream is OFF</AlertTitle>
              <AlertDescription>
                <p>OBS stopped for a restart and did not start again: {stoppedByPanel}</p>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={busy !== null}
                  onClick={() => run("restart", { action: "restart-stream" }, "Stream started")}
                >
                  {busy === "restart" ? <Loader2 className="animate-spin" /> : <Play />}
                  Start stream
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {needsWhip && (
            <Alert>
              <RadioTower />
              <AlertTitle>OBS isn&apos;t publishing over WHIP</AlertTitle>
              <AlertDescription>
                <p>
                  OBS streams to <code className="font-mono">{service.server ?? service.type}</code>. The panel plays
                  the feed straight from OBS over WebRTC, so OBS must publish to{" "}
                  <code className="font-mono break-all">{whipUrl}</code>.
                </p>
                {stream.active ? (
                  <ConfirmRestart
                    title="Switch OBS to WHIP and restart the stream?"
                    trigger={
                      <Button size="sm" className="mt-2" disabled={busy !== null}>
                        {busy === "whip" ? <Loader2 className="animate-spin" /> : <RadioTower />}
                        Switch to WHIP
                      </Button>
                    }
                    onConfirm={() => run("whip", { action: "use-whip" }, "OBS now publishes over WHIP")}
                  />
                ) : (
                  <Button
                    size="sm"
                    className="mt-2"
                    disabled={busy !== null}
                    onClick={() => run("whip", { action: "use-whip" }, "OBS now publishes over WHIP")}
                  >
                    {busy === "whip" ? <Loader2 className="animate-spin" /> : <RadioTower />}
                    Switch to WHIP
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Live for</dt>
              <dd className="font-mono tabular-nums">{stream.active ? formatDuration(stream.durationMs) : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Sent</dt>
              <dd className="font-mono tabular-nums">{stream.active ? formatBytes(stream.bytes) : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Encoding at</dt>
              <dd className="font-mono tabular-nums">
                {encoder.effectiveBitrate != null ? `${encoder.effectiveBitrate} kbps` : "—"}
              </dd>
            </div>
          </dl>

          {encoder.unsupported ? (
            <Alert>
              <AlertTitle>Bitrate can&apos;t be changed here</AlertTitle>
              <AlertDescription>{encoder.unsupported}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="bitrate">Video bitrate (kbps)</Label>
              <Input
                id="bitrate"
                type="number"
                inputMode="numeric"
                min={BITRATE_MIN}
                max={BITRATE_MAX}
                step={100}
                value={bitrate}
                onChange={(e) => setBitrateDraft(e.target.value)}
                className="font-mono sm:max-w-48"
                aria-invalid={!bitrateValid}
              />
              <p className="text-xs text-muted-foreground">
                {encoder.effectiveBitrate != null && encoder.effectiveBitrate !== encoder.bitrate
                  ? `Saved ${encoder.bitrate} kbps takes effect on the next stream restart. `
                  : ""}
                OBS only applies a new bitrate when the stream starts, so applying it restarts the stream.
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <ConfirmRestart
            title={
              applyBitrate
                ? `Apply ${bitrateNum} kbps and restart the stream?`
                : stream.active
                  ? "Restart the stream?"
                  : "Start the stream?"
            }
            trigger={
              <Button
                variant={applyBitrate ? "default" : "outline"}
                disabled={busy !== null || (bitrateDirty && !bitrateValid)}
              >
                {busy === "restart" || busy === "bitrate" ? <Loader2 className="animate-spin" /> : <RotateCw />}
                {applyBitrate ? "Apply & restart stream" : stream.active ? "Restart stream" : "Start stream"}
              </Button>
            }
            onConfirm={restart}
          />
          {bitrateDirty && (
            <Button variant="ghost" onClick={() => setBitrateDraft(null)} disabled={busy !== null}>
              Reset
            </Button>
          )}
        </CardFooter>
      </Card>
    </Layout>
  );
}

function ConfirmRestart({
  title,
  trigger,
  onConfirm,
}: {
  title: string;
  trigger: React.ReactNode;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            OBS stops and restarts its output. The live feed drops for a few seconds while it reconnects.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">OBS camera source and stream encoder.</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">{children}</div>
    </div>
  );
}
