"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AppWindow,
  Bot,
  Camera,
  Gauge,
  Loader2,
  Play,
  PlugZap,
  RadioTower,
  RotateCw,
  Save,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { BITRATE_MAX, BITRATE_MIN, FPS_OPTIONS, X264_PRESETS, fpsLabel, isValidBitrate } from "@/lib/shared";
import { StateBadge } from "./StateBadge";
import { AutomationSections } from "./AutomationCard";
import { SectionNav, SettingsSection, type NavSection } from "./SettingsSection";
import { EASE, Reveal } from "./motion";
import { useLive } from "./hooks";
import { formatBytes, formatDuration } from "./format";
import type { ObsPayload } from "./types";

type Busy = "url" | "apply" | "restart" | "whip" | "launch" | null;

type ActionResult = {
  ok: true;
  restarted?: boolean;
  effectiveBitrate?: number | null;
  savedBitrate?: number | null;
} | null;

async function obsAction(body: Record<string, unknown>): Promise<ActionResult> {
  try {
    const res = await fetch("/api/obs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      restarted?: boolean;
      effectiveBitrate?: number | null;
      savedBitrate?: number | null;
    };
    if (!res.ok) {
      toast.error(data.error ?? "OBS request failed");
      return null;
    }
    return {
      ok: true,
      restarted: data.restarted,
      effectiveBitrate: data.effectiveBitrate,
      savedBitrate: data.savedBitrate,
    };
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  }
}

const AUTOMATION_SECTIONS: NavSection[] = [
  { id: "automation", label: "Automation", icon: Bot },
  { id: "adaptive", label: "Adaptive bitrate", icon: Gauge },
];

export function ObsSettings() {
  const { data: obs, refresh } = useLive<ObsPayload>("obs", "/api/obs");
  const [busy, setBusy] = useState<Busy>(null);
  // Drafts stay untouched by live updates until saved or reset.
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [bitrateDraft, setBitrateDraft] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState<string | null>(null);
  const [fpsDraft, setFpsDraft] = useState<string | null>(null);

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
      <Layout sections={AUTOMATION_SECTIONS}>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </Layout>
    );
  }

  if (!obs.connected) {
    return (
      <Layout sections={[{ id: "obs", label: "OBS", icon: PlugZap }, ...AUTOMATION_SECTIONS]}>
        <Reveal>
          <SettingsSection
            id="obs"
            icon={PlugZap}
            title="Not connected to OBS"
            description="The camera and stream settings appear once the panel can reach OBS."
            className="border-destructive/30"
          >
            <div className="flex flex-col gap-3 text-sm">
              <p className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">{obs.error}</p>
              <p className="text-muted-foreground">
                In OBS open <strong className="text-foreground">Tools → WebSocket Server Settings</strong> and tick{" "}
                <strong className="text-foreground">Enable WebSocket server</strong>. The password is read from OBS&apos;s
                config automatically.
              </p>
              <Button
                className="w-max"
                disabled={busy !== null}
                onClick={() => run("launch", { action: "launch" }, "Opening OBS…")}
              >
                {busy === "launch" ? <Loader2 className="animate-spin" /> : <AppWindow />}
                Launch OBS
              </Button>
            </div>
          </SettingsSection>
        </Reveal>
        <AutomationSections />
      </Layout>
    );
  }

  const { sources, encoder, stream, service, whipUrl, stoppedByPanel } = obs;
  const needsWhip = whipUrl !== null && !(service.type === "whip_custom" && service.server === whipUrl);
  const bitrate = bitrateDraft ?? String(encoder.bitrate);
  const bitrateNum = Number(bitrate);
  const bitrateValid = isValidBitrate(bitrateNum);
  const bitrateDirty = bitrateDraft !== null && bitrateNum !== encoder.bitrate && !encoder.unsupported;
  const presetDirty = presetDraft !== null && presetDraft !== encoder.preset;
  const currentFps = fpsLabel(encoder.fps);
  const fpsDirty = fpsDraft !== null && fpsDraft !== currentFps;
  const dirty = bitrateDirty || presetDirty || fpsDirty;
  const changes = [
    bitrateDirty && `${bitrateNum.toLocaleString("en-US")} kbps`,
    presetDirty && `preset ${presetDraft}`,
    fpsDirty && `${fpsDraft} fps`,
  ].filter(Boolean) as string[];
  const resetDrafts = () => {
    setBitrateDraft(null);
    setPresetDraft(null);
    setFpsDraft(null);
  };

  const apply = async () => {
    const result = await run("apply", {
      action: "apply-output",
      ...(bitrateDirty && { bitrate: bitrateNum }),
      ...(presetDirty && { preset: presetDraft }),
      ...(fpsDirty && { fps: FPS_OPTIONS.find((o) => o.label === fpsDraft)?.fps }),
    });
    if (!result) return;
    resetDrafts();
    if (!result.restarted) {
      toast.success(fpsDirty && !bitrateDirty && !presetDirty ? "Frame rate changed" : "Saved; it applies when the stream starts");
      return;
    }
    if (!bitrateDirty) {
      toast.success("Applied; the stream restarted");
      return;
    }
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

  const sections: NavSection[] = [
    { id: "camera", label: "Camera", icon: Camera },
    { id: "output", label: "Stream output", icon: SlidersHorizontal },
    ...AUTOMATION_SECTIONS,
  ];

  return (
    <Layout sections={sections}>
      <Reveal>
        <SettingsSection id="camera" icon={Camera} title="Camera source" description="The IP camera URL OBS reads from. Changes apply immediately.">
          <div className="flex flex-col gap-4">
            {sources.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No network media sources in OBS. Add a Media Source with “Local File” unticked.
              </p>
            )}
            {sources.map((s) => {
              const draft = urlDrafts[s.name] ?? s.url;
              const changed = draft.trim() !== s.url;
              const id = `src-${s.name}`;
              return (
                <form
                  key={s.name}
                  className="flex flex-col gap-1.5"
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
                  <div className="flex gap-2">
                    <Input
                      id={id}
                      value={draft}
                      onChange={(e) => setUrlDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                      placeholder="rtsp://user:pass@192.168.1.10:554/stream"
                      className="font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button type="submit" disabled={!changed || busy !== null}>
                      {busy === "url" ? <Loader2 className="animate-spin" /> : <Save />}
                      Save
                    </Button>
                  </div>
                </form>
              );
            })}
          </div>
        </SettingsSection>
      </Reveal>

      <Reveal index={1}>
        <SettingsSection
          id="output"
          icon={SlidersHorizontal}
          title="Stream output"
          description={`Profile “${encoder.profile}” · ${encoder.encoder} · ${encoder.rateControl}`}
          action={<StateBadge state={streamState} />}
        >
          <div className="flex flex-col gap-5">
            <AnimatePresence initial={false}>
              {stoppedByPanel && !stream.active && (
                <Collapse key="off">
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
                </Collapse>
              )}
              {needsWhip && (
                <Collapse key="whip">
                  <Alert>
                    <RadioTower />
                    <AlertTitle>OBS isn&apos;t publishing over WHIP</AlertTitle>
                    <AlertDescription>
                      <p>
                        OBS streams to <code className="font-mono">{service.server ?? service.type}</code>; it must publish
                        to <code className="font-mono break-all">{whipUrl}</code>.
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
                </Collapse>
              )}
            </AnimatePresence>

            <dl className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30">
              <MiniStat label="Live for" value={stream.active ? formatDuration(stream.durationMs) : "—"} />
              <MiniStat label="Sent" value={stream.active ? formatBytes(stream.bytes) : "—"} />
              <MiniStat
                label="Encoding at"
                value={encoder.effectiveBitrate != null ? `${encoder.effectiveBitrate.toLocaleString("en-US")} kbps` : "—"}
              />
            </dl>

            {encoder.unsupported && (
              <Alert>
                <AlertTitle>Bitrate can&apos;t be changed here</AlertTitle>
                <AlertDescription>{encoder.unsupported}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              {!encoder.unsupported && (
                <Field label="Video bitrate" htmlFor="bitrate" dirty={bitrateDirty}>
                  <div className="relative">
                    <Input
                      id="bitrate"
                      type="number"
                      inputMode="numeric"
                      min={BITRATE_MIN}
                      max={BITRATE_MAX}
                      step={100}
                      value={bitrate}
                      onChange={(e) => setBitrateDraft(e.target.value)}
                      className="pr-12 font-mono"
                      aria-invalid={!bitrateValid}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                      kbps
                    </span>
                  </div>
                </Field>
              )}
              {encoder.preset !== null && (
                <Field label="Encoder preset" htmlFor="preset" dirty={presetDirty}>
                  <select
                    id="preset"
                    value={presetDraft ?? encoder.preset}
                    onChange={(e) => setPresetDraft(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {X264_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Frame rate" htmlFor="fps" dirty={fpsDirty}>
                <select id="fps" value={fpsDraft ?? currentFps} onChange={(e) => setFpsDraft(e.target.value)} className={SELECT_CLASS}>
                  {!FPS_OPTIONS.some((o) => o.label === currentFps) && <option value={currentFps}>{currentFps}</option>}
                  {FPS_OPTIONS.map((o) => (
                    <option key={o.label} value={o.label}>
                      {o.label} fps
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              OBS takes these when the stream starts, so applying them to a live stream restarts it.
              {encoder.preset !== null && " If OBS drops frames from encoding lag, pick a faster preset or a lower frame rate."}
            </p>

            <div className="flex">
              <ConfirmRestart
                title={stream.active ? "Restart the stream?" : "Start the stream?"}
                trigger={
                  <Button variant="outline" disabled={busy !== null}>
                    {busy === "restart" ? <Loader2 className="animate-spin" /> : <RotateCw />}
                    {stream.active ? "Restart stream" : "Start stream"}
                  </Button>
                }
                onConfirm={() => run("restart", { action: "restart-stream" }, stream.active ? "Stream restarted" : "Stream started")}
              />
            </div>
          </div>
        </SettingsSection>
      </Reveal>

      <AutomationSections />

      {/* Unapplied stream changes: a bar that slides up until they're applied or reset. */}
      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl items-center gap-3 rounded-xl border bg-popover/95 px-4 py-3 shadow-2xl backdrop-blur-xl sm:bottom-6"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Unapplied changes</p>
              <p className="truncate text-xs text-muted-foreground">{changes.join(" · ")}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={resetDrafts} disabled={busy !== null}>
              Reset
            </Button>
            {stream.active ? (
              <ConfirmRestart
                title={`Apply ${changes.join(", ")} and restart the stream?`}
                trigger={
                  <Button size="sm" disabled={busy !== null || (bitrateDirty && !bitrateValid)}>
                    {busy === "apply" ? <Loader2 className="animate-spin" /> : <RotateCw />}
                    Apply &amp; restart
                  </Button>
                }
                onConfirm={apply}
              />
            ) : (
              <Button size="sm" onClick={apply} disabled={busy !== null || (bitrateDirty && !bitrateValid)}>
                {busy === "apply" ? <Loader2 className="animate-spin" /> : <Save />}
                Apply
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
}

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&_option]:bg-popover";

function Field({
  label,
  htmlFor,
  dirty,
  children,
}: {
  label: string;
  htmlFor: string;
  dirty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="gap-1.5">
        {label}
        <AnimatePresence>
          {dirty && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="size-1.5 rounded-full bg-warning"
              aria-label="changed"
            />
          )}
        </AnimatePresence>
      </Label>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function Collapse({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
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

function Layout({ sections, children }: { sections: NavSection[]; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Reveal>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">Camera, stream output and automation.</p>
      </Reveal>
      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <SectionNav sections={sections} />
        <div className="flex max-w-3xl min-w-0 flex-col gap-4 pb-24">{children}</div>
      </div>
    </div>
  );
}
