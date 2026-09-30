import "server-only";
import { INGEST, OUTPUT_PATH } from "./config";
import { listPaths, type PathInfo } from "./mediamtx";
import {
  ObsBusyError,
  encoderCodec,
  ensureStreamLive,
  getEncoderId,
  getFrameStats,
  getMediaState,
  getStreamService,
  getSavedBitrate,
  getStreamStatus,
  isRestarting,
  isSourceActive,
  isWhipService,
  stoppedByPanel,
  listNetworkSources,
  reloadMediaSource,
  switchToWhip,
  withObs,
  type ObsSession,
  type StreamStatus,
} from "./obs";
import { procman } from "./procman";
import { displayEnv, isObsRunning, launchObs } from "./obs-launch";
import { loadAutomationSettings, saveAutomationSettings } from "./automation-settings";
import { decide } from "./abr";
import {
  SCRIPT_PATH,
  clearBitrateRequest,
  isLiveCapable,
  readScriptStatus,
  requestBitrate,
} from "./live-bitrate";
import { viewerInfo, viewers } from "./viewers";
import { eventLogs } from "./eventlog";
import { listWebRTCSessions, type WebRTCSession } from "./mediamtx";
import { formatDuration } from "@/components/format";
import {
  isValidBitrate,
  type AbrStatus,
  type AutomationEvent,
  type AutomationPayload,
  type AutomationSettings,
  type HealthWarning,
  type ViewerInfo,
} from "./shared";

// Background checks that keep the feed up and flag problems, whether or not a browser has the
// panel open. Started from instrumentation.ts when the server boots.

const TICK_MS = 3000;
const EVENTS_MAX = 100;

/** Keep-live: wait this long after a failed start, doubling per failure, then give up. */
const KEEP_LIVE_RETRY_MS = 5000;
const KEEP_LIVE_RETRY_MAX_MS = 60_000;
const KEEP_LIVE_GIVE_UP = 5;

/** A camera in ERROR/ENDED/STOPPED is reloaded after this long; one stuck opening or buffering, after the longer one. */
const CAMERA_FAILED_MS = 5000;
const CAMERA_STALLED_MS = 20_000;
/** Minimum time between two reloads of the same camera. */
const CAMERA_RELOAD_EVERY_MS = 30_000;

/** Frame-drop windows and the share of dropped frames that raises a warning. */
const QUALITY_WINDOW_MS = 15_000;
const DROP_WARN_RATIO = 0.02;
const CONGESTION_WARN = 0.5;

/** Launch OBS: time to let it open before trying again, attempts before giving up, and how
 * long it must stay connected for the attempts to count from zero again. */
const OBS_LAUNCH_WAIT_MS = 30_000;
const OBS_LAUNCH_GIVE_UP = 3;
const OBS_STABLE_MS = 60_000;

/** Window for measuring OBS's actual output bitrate. */
const OUTPUT_RATE_WINDOW_MS = 10_000;

/** Switching OBS back to WHIP is retried at most this often. */
const WHIP_RETRY_MS = 30_000;

// ---------------------------------------------------------------------------
// Decisions, kept pure for testing

export type CameraAction = "ok" | "wait" | "reload";

const FAILED_STATES = new Set(["OBS_MEDIA_STATE_ERROR", "OBS_MEDIA_STATE_ENDED", "OBS_MEDIA_STATE_STOPPED"]);

/** What to do about a camera that has been in `mediaState` since `since`. */
export function cameraAction(mediaState: string, since: number, lastReload: number, now: number): CameraAction {
  if (mediaState === "OBS_MEDIA_STATE_PLAYING" || mediaState === "OBS_MEDIA_STATE_PAUSED") return "ok";
  const limit = FAILED_STATES.has(mediaState) ? CAMERA_FAILED_MS : CAMERA_STALLED_MS;
  if (now - since < limit || now - lastReload < CAMERA_RELOAD_EVERY_MS) return "wait";
  return "reload";
}

export function keepLiveRetryMs(failures: number) {
  return Math.min(KEEP_LIVE_RETRY_MS * 2 ** (failures - 1), KEEP_LIVE_RETRY_MAX_MS);
}

export interface FrameSample {
  ts: number;
  netSkipped: number;
  netTotal: number;
  renderSkipped: number;
  renderTotal: number;
  encodeSkipped: number;
  encodeTotal: number;
  congestion: number;
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

/** Warnings for frames dropped between two samples of the same live stream. */
export function frameWarnings(from: FrameSample, to: FrameSample): HealthWarning[] {
  const out: HealthWarning[] = [];
  const secs = Math.round((to.ts - from.ts) / 1000);
  const check = (id: string, skipped: number, total: number, title: string, fix: string) => {
    if (total <= 0) return;
    const ratio = skipped / total;
    if (ratio >= DROP_WARN_RATIO)
      out.push({ id, level: "warning", title, detail: `${pct(ratio)} of frames dropped in the last ${secs}s. ${fix}` });
  };
  check(
    "quality-network",
    to.netSkipped - from.netSkipped,
    to.netTotal - from.netTotal,
    "OBS is dropping frames (network)",
    "The connection to the media server can't keep up; lower the bitrate in Settings.",
  );
  check(
    "quality-encoding",
    to.encodeSkipped - from.encodeSkipped,
    to.encodeTotal - from.encodeTotal,
    "OBS is dropping frames (encoding lag)",
    "The encoder is overloaded; pick a faster encoder preset or a lower frame rate under Settings → Stream output, or use a hardware encoder.",
  );
  check(
    "quality-rendering",
    to.renderSkipped - from.renderSkipped,
    to.renderTotal - from.renderTotal,
    "OBS is dropping frames (rendering lag)",
    "The GPU is overloaded; close other GPU-heavy programs or simplify the scene.",
  );
  if (to.congestion >= CONGESTION_WARN)
    out.push({
      id: "quality-congestion",
      level: "warning",
      title: "OBS's output is congested",
      detail: `Congestion is at ${pct(to.congestion)}; the stream may stutter. Lower the bitrate in Settings.`,
    });
  return out;
}

/** Warnings for a stream OBS would encode, or MediaMTX receives, in a codec browsers can't play. */
export function codecWarnings(encoderId: string | null, tracks: string[]): HealthWarning[] {
  const fromObs = encoderId ? encoderCodec(encoderId) : "H.264";
  const fromTrack = tracks.find((t) => ["H265", "AV1", "VP9"].includes(t));
  if (fromObs === "H.264" && !fromTrack) return [];
  const codec = fromObs !== "H.264" ? fromObs : fromTrack!.replace("H265", "H.265");
  return [
    {
      id: "codec",
      level: "error",
      title: `OBS encodes ${codec}, which browsers can't play`,
      detail:
        `${encoderId ? `Encoder "${encoderId}". ` : ""}In OBS open Settings → Output → Streaming and set Video Encoder ` +
        "to an H.264 option (x264, NVENC H.264, VAAPI H.264 or QuickSync H.264), then restart the stream.",
    },
  ];
}

// ---------------------------------------------------------------------------

class Supervisor {
  settings: AutomationSettings = loadAutomationSettings();
  events: AutomationEvent[] = [];
  obsConnected = false;
  private warningsById = new Map<string, HealthWarning>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private tickListeners = new Set<() => void>();
  private seq = 0;

  private keepLive = { failures: 0, nextAt: 0 };
  private cameras = new Map<string, { state: string; since: number; lastReload: number }>();
  private frames: FrameSample[] = [];
  private lastWhipAttempt = 0;
  private obsLaunch = { attempts: 0, nextAt: 0, connectedSince: 0 };
  /** For the logs: the last stream state, viewers' health and MediaMTX sessions seen. */
  private lastStream: { active: boolean; reconnecting: boolean } | null = null;
  private viewerHealth = new Map<string, ViewerInfo["health"]>();
  private sessions: Map<string, WebRTCSession> | null = null;
  private abr = {
    lastChangeAt: 0,
    lastStruggleAt: 0,
    lastDurationMs: 0,
    lastChange: null as AbrStatus["lastChange"],
    bytes: [] as { ts: number; bytes: number }[],
    status: null as AbrStatus | null,
  };

  ensureRunning() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  /** Called after every check; returns an unsubscribe function. */
  onTick(fn: () => void) {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  get warnings(): HealthWarning[] {
    return [...this.warningsById.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  }

  payload(): AutomationPayload {
    return {
      settings: this.settings,
      abr: this.abr.status,
      ingest: INGEST,
      obsConnected: this.obsConnected,
      warnings: this.warnings,
      events: this.events.toReversed(),
    };
  }

  async update(patch: Partial<AutomationSettings>) {
    const next = { ...this.settings, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (this.settings[k as keyof AutomationSettings] === v) continue;
      const label = LABELS[k as keyof AutomationSettings];
      this.event("info", typeof v === "boolean" ? `${label} turned ${v ? "on" : "off"}` : `${label} set to ${v}`);
    }
    this.settings = next;
    // Re-arm after an operator's change, e.g. after fixing whatever made keep-live give up.
    this.keepLive = { failures: 0, nextAt: 0 };
    this.lastWhipAttempt = 0;
    this.obsLaunch = { attempts: 0, nextAt: 0, connectedSince: 0 };
    await saveAutomationSettings(next);
    void this.tick();
  }

  /** Record an automation event; `obs` also puts it in the OBS log. */
  private event(level: AutomationEvent["level"], text: string, { obs = false } = {}) {
    this.events.push({ id: ++this.seq, ts: Date.now(), level, text });
    if (this.events.length > EVENTS_MAX) this.events.shift();
    eventLogs.automation.log(level, text);
    if (obs) eventLogs.obs.log(level, text);
    const log = level === "error" ? console.error : level === "warning" ? console.warn : console.log;
    log(`[automation] ${text}`);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const next = new Map<string, HealthWarning>();
      await this.check(next);
      // Record each warning once when it appears, and note when it clears.
      for (const w of next.values())
        if (!this.warningsById.has(w.id))
          this.event(w.level, `${w.title}${w.detail ? ` — ${w.detail}` : ""}`, { obs: isObsWarning(w.id) });
      for (const w of this.warningsById.values())
        if (!next.has(w.id)) this.event("info", `Resolved: ${w.title}`, { obs: isObsWarning(w.id) });
      this.warningsById = next;
    } catch (e) {
      console.error("[automation] check failed", e);
    } finally {
      this.ticking = false;
      for (const fn of this.tickListeners) fn();
    }
  }

  private async check(warn: Map<string, HealthWarning>) {
    const add = (w: HealthWarning) => warn.set(w.id, w);
    const [processes, paths] = await Promise.all([procman.status(), listPaths()]);

    for (const p of processes) {
      if (p.state === "crashed" && p.note)
        add({ id: `proc-${p.name}`, level: "error", title: `${p.label} is down`, detail: `Not restarting: ${p.note}.` });
    }

    const out = paths?.find((p) => p.name === OUTPUT_PATH);
    const mtxReady = paths !== null;
    if (mtxReady) this.logSessions(await listWebRTCSessions());

    try {
      await withObs((obs) => this.checkObs(obs, add, out, mtxReady));
      if (!this.obsConnected) eventLogs.obs.info("Connected to OBS");
      this.obsConnected = true;
      const l = this.obsLaunch;
      l.connectedSince ||= Date.now();
      if (Date.now() - l.connectedSince >= OBS_STABLE_MS) l.attempts = 0;
    } catch (e) {
      if (this.obsConnected) this.event("warning", `Lost contact with OBS: ${(e as Error).message}`, { obs: true });
      this.obsConnected = false;
      this.lastStream = null;
      this.obsLaunch.connectedSince = 0;
      this.abr.status = this.viewersWithoutObs(out, Date.now());
      if (this.settings.launchObs) await this.maybeLaunchObs(add, mtxReady, Date.now());
      this.frames = [];
      for (const w of codecWarnings(null, out?.ready ? out.tracks : [])) add(w);
      if (this.settings.keepStreamLive)
        add({
          id: "obs-unreachable",
          level: "error",
          title: "OBS is not reachable",
          detail: "Keep stream live can't start the stream until OBS is running with its WebSocket server enabled.",
        });
    }
  }

  /** Open OBS when MediaMTX is up and OBS is neither running nor reachable. */
  private async maybeLaunchObs(add: (w: HealthWarning) => void, mtxReady: boolean, now: number) {
    const l = this.obsLaunch;
    if (!mtxReady) return;
    if (await isObsRunning()) {
      // Give a freshly launched OBS time to open its WebSocket server before complaining.
      if (now >= l.nextAt)
        add({
          id: "obs-no-websocket",
          level: "warning",
          title: "OBS is running but the panel can't connect to it",
          detail: "In OBS open Tools → WebSocket Server Settings and tick Enable WebSocket server.",
        });
      return;
    }
    if (!(await displayEnv())) {
      add({
        id: "obs-launch",
        level: "error",
        title: "Can't launch OBS",
        detail: "There is no desktop session to open it on. Log in to the desktop.",
      });
      return;
    }
    if (l.attempts >= OBS_LAUNCH_GIVE_UP) {
      add({
        id: "obs-launch",
        level: "error",
        title: "OBS keeps closing",
        detail: `Launch OBS gave up after ${OBS_LAUNCH_GIVE_UP} attempts. Open OBS by hand to see what's wrong, or turn the setting off and on to try again.`,
      });
      return;
    }
    if (now < l.nextAt) return;
    l.attempts++;
    l.nextAt = now + OBS_LAUNCH_WAIT_MS;
    try {
      const how = await launchObs({ startStreaming: this.settings.keepStreamLive });
      this.event("info", `Launched OBS (attempt ${l.attempts}): ${how}`);
    } catch (e) {
      this.event("error", `Could not launch OBS: ${(e as Error).message}`);
    }
  }

  private async checkObs(
    obs: ObsSession,
    add: (w: HealthWarning) => void,
    out: PathInfo | undefined,
    mtxReady: boolean,
  ) {
    let stream = await getStreamStatus(obs);
    const now = Date.now();
    this.logStreamChange(stream);

    // Codec: what OBS is set to encode, and what MediaMTX actually receives.
    for (const w of codecWarnings(await getEncoderId(obs), out?.ready ? out.tracks : [])) add(w);

    // Keep OBS on WHIP. OBS can't change its service while live, so only act when idle.
    if (INGEST === "whip" && this.settings.keepWhip) {
      const service = await getStreamService(obs);
      if (!isWhipService(service)) {
        if (!stream.active && !isRestarting() && now - this.lastWhipAttempt >= WHIP_RETRY_MS) {
          this.lastWhipAttempt = now;
          try {
            await switchToWhip(obs);
            this.event("info", `Pointed OBS back at the WHIP endpoint (was ${service.server ?? service.type})`);
          } catch (e) {
            if (!(e instanceof ObsBusyError)) this.event("error", `Could not switch OBS to WHIP: ${(e as Error).message}`);
          }
        } else if (stream.active) {
          add({
            id: "whip-service",
            level: "warning",
            title: "OBS is not streaming to this panel",
            detail: `It publishes to ${service.server ?? service.type}. It will be switched to WHIP once the stream stops.`,
          });
        }
      }
    }

    if (this.settings.reconnectCameras) await this.checkCameras(obs, add, now);
    else this.cameras.clear();

    if (this.settings.keepStreamLive) {
      await this.keepStreamLive(obs, stream, mtxReady, add, now);
      stream = await getStreamStatus(obs);
    }

    await this.checkQuality(obs, stream, add, now);
    await this.checkBitrate(obs, stream, out, add, now);
  }

  get abrStatus(): AbrStatus | null {
    return this.abr.status;
  }

  /** Adaptive bitrate: measure viewers, then recommend or (in auto mode) apply a new bitrate. */
  private async checkBitrate(
    obs: ObsSession,
    stream: StreamStatus,
    out: PathInfo | undefined,
    add: (w: HealthWarning) => void,
    now: number,
  ) {
    const a = this.abr;
    // A stream that stopped or restarted starts over at the profile's bitrate.
    if (!stream.active || stream.durationMs < a.lastDurationMs) {
      a.bytes = [];
      a.lastChangeAt = 0;
      a.lastStruggleAt = now;
      await clearBitrateRequest();
    }
    a.lastDurationMs = stream.active ? stream.durationMs : 0;

    let outputKbps: number | null = null;
    if (stream.active) {
      a.bytes.push({ ts: now, bytes: stream.bytes });
      while (a.bytes.length > 1 && now - a.bytes[1].ts >= OUTPUT_RATE_WINDOW_MS) a.bytes.shift();
      const [first, last] = [a.bytes[0], a.bytes.at(-1)!];
      if (last.ts > first.ts) outputKbps = Math.round(((last.bytes - first.bytes) * 8) / (last.ts - first.ts));
    }

    const [script, ceiling] = await Promise.all([readScriptStatus(), getSavedBitrate(obs).catch(() => null)]);
    const scriptLive = script?.active ? script : null;
    const current = scriptLive?.bitrate ?? ceiling;
    const encoder = script?.encoder ?? null;
    const canApply = !!scriptLive && isLiveCapable(encoder);

    const measured = viewers.metrics(now);
    const infos = measured.map(viewerInfo);
    this.logViewerHealth(infos);
    if (infos.some((v) => v.health === "network")) a.lastStruggleAt = now;
    const device = infos.filter((v) => v.health === "device");
    if (device.length)
      add({
        id: "viewer-device",
        level: "warning",
        title: `${device.length} ${device.length === 1 ? "viewer's device" : "viewers' devices"} can't keep up with the video`,
        detail:
          "They drop frames without losing packets, which a lower bitrate won't fix. Lowering OBS's output " +
          "resolution (Settings → Video → Output (Scaled) Resolution) helps; it applies when the stream restarts.",
      });

    const mode = this.settings.adaptiveBitrate;
    let recommendation: AbrStatus["recommendation"] = null;
    if (mode !== "off" && stream.active && current && ceiling) {
      const d = decide({
        now,
        current,
        ceiling,
        min: this.settings.minBitrate,
        health: infos.map((v) => v.health),
        lastChangeAt: a.lastChangeAt,
        lastStruggleAt: a.lastStruggleAt,
      });
      if (d.action !== "hold") {
        if (mode === "auto" && canApply) await this.applyBitrate(current, d.target, d.reason, true);
        else recommendation = { direction: d.action, target: d.target, reason: d.reason };
      }
    }
    if (mode === "auto" && stream.active && !canApply)
      add({
        id: "abr-script",
        level: "warning",
        title: "Automatic bitrate can't change the bitrate",
        detail: !scriptLive
          ? `Add the live bitrate script in OBS (Tools → Scripts → +): ${SCRIPT_PATH}. Until then it only recommends.`
          : `The encoder "${encoder}" doesn't change bitrate while streaming. Use x264 or NVENC, or set Adaptive bitrate to Recommend.`,
      });

    a.status = {
      mode,
      streamActive: stream.active,
      current: stream.active ? current : ceiling,
      ceiling,
      min: this.settings.minBitrate,
      outputKbps,
      script: { state: script ? "ok" : "missing", path: SCRIPT_PATH, encoder, liveCapable: isLiveCapable(encoder) },
      viewers: infos,
      unmeasured: Math.max(0, (out?.readers ?? 0) - measured.length),
      recommendation,
      lastChange: a.lastChange,
    };
  }

  private logStreamChange(stream: StreamStatus) {
    const prev = this.lastStream;
    this.lastStream = { active: stream.active, reconnecting: stream.reconnecting };
    const log = eventLogs.obs;
    if (!prev) {
      log.info(stream.active ? `Stream is live (for ${formatDuration(stream.durationMs)})` : "Stream is off");
      return;
    }
    if (stream.active && !prev.active) log.info("Stream started");
    if (!stream.active && prev.active)
      log.warn(`Stream stopped${stoppedByPanel(stream) ? ` and could not be restarted: ${stoppedByPanel(stream)}` : ""}`);
    if (stream.reconnecting && !prev.reconnecting) log.warn("OBS lost its connection to the media server and is reconnecting");
    if (!stream.reconnecting && prev.reconnecting && stream.active) log.info("OBS reconnected");
  }

  /** Log each viewer's first verdict and every change after it. */
  private logViewerHealth(infos: ViewerInfo[]) {
    const seen = new Set<string>();
    for (const v of infos) {
      seen.add(v.id);
      const prev = this.viewerHealth.get(v.id);
      if (v.health === "unknown" || v.health === prev) continue;
      this.viewerHealth.set(v.id, v.health);
      const picture = [v.resolution, v.fps != null ? `${Math.round(v.fps)} fps` : null].filter(Boolean).join(" @ ");
      const log = eventLogs.clients;
      if (v.health === "good")
        log.info(`${v.label}: ${prev ? "playing smoothly again" : "playing smoothly"} (${picture || "picture size unknown"}, ${v.kbps} kbps)`);
      else if (v.health === "network")
        log.warn(`${v.label}: losing packets (${v.lossPct.toFixed(1)}% lost, ${v.freezeSec.toFixed(1)} s frozen, ${v.kbps} kbps)`);
      else
        log.warn(`${v.label}: device can't keep up (${v.dropPct.toFixed(1)}% of frames dropped, ${v.freezeSec.toFixed(1)} s frozen)`);
    }
    for (const id of this.viewerHealth.keys()) if (!seen.has(id)) this.viewerHealth.delete(id);
  }

  /** Log WebRTC players and publishers as MediaMTX sees them, including ones outside the panel. */
  private logSessions(list: WebRTCSession[] | null) {
    if (!list) return;
    const now = new Map(list.map((s) => [s.id, s]));
    const first = this.sessions === null;
    const describe = (s: WebRTCSession) =>
      s.state === "publish" ? `Publisher ${s.remoteAddr} (WHIP → /${s.path})` : `Player ${s.remoteAddr} (WebRTC, /${s.path})`;
    for (const s of list) {
      if (this.sessions?.has(s.id) || !s.state) continue;
      eventLogs.clients.info(`${describe(s)} ${first ? "is connected" : "connected"} [MediaMTX session ${s.id.slice(0, 8)}]`);
    }
    for (const [id, s] of this.sessions ?? []) {
      if (now.has(id) || !s.state) continue;
      eventLogs.clients.info(`${describe(s)} disconnected after ${formatDuration(Date.now() - s.created)}`);
    }
    this.sessions = now;
  }

  /** Viewer health while OBS is unreachable: players still report, bitrate is unknown. */
  private viewersWithoutObs(out: PathInfo | undefined, now: number): AbrStatus {
    const measured = viewers.metrics(now);
    this.logViewerHealth(measured.map(viewerInfo));
    return {
      mode: this.settings.adaptiveBitrate,
      streamActive: !!out?.ready,
      current: null,
      ceiling: null,
      min: this.settings.minBitrate,
      outputKbps: null,
      script: { state: "missing", path: SCRIPT_PATH, encoder: null, liveCapable: false },
      viewers: measured.map(viewerInfo),
      unmeasured: Math.max(0, (out?.readers ?? 0) - measured.length),
      recommendation: null,
      lastChange: this.abr.lastChange,
    };
  }

  private async applyBitrate(from: number, to: number, reason: string, auto: boolean) {
    await requestBitrate(to);
    const a = this.abr;
    a.lastChangeAt = Date.now();
    a.lastChange = { ts: a.lastChangeAt, from, to, reason, auto };
    // Keep the recommendation from reappearing before the next check.
    if (a.status) a.status = { ...a.status, current: to, recommendation: null, lastChange: a.lastChange };
    this.event(
      "info",
      `${auto ? "Automatically " : ""}${to < from ? "lowered" : "raised"} the bitrate ${from} → ${to} kbps: ${reason}`,
      { obs: true },
    );
  }

  /** Apply a bitrate now through the OBS script, without restarting the stream. */
  async setLiveBitrate(kbps: number) {
    const s = this.abr.status;
    if (!s?.streamActive || !s.current) throw new Error("The stream isn't live");
    if (s.script.state !== "ok") throw new Error("The live bitrate script isn't loaded in OBS");
    if (!s.script.liveCapable) throw new Error(`The encoder "${s.script.encoder}" can't change bitrate while streaming`);
    if (!isValidBitrate(kbps) || (s.ceiling && kbps > s.ceiling))
      throw new Error(`Choose a bitrate up to the configured ${s.ceiling} kbps`);
    await this.applyBitrate(s.current, kbps, "set by the operator", false);
  }

  private async checkCameras(obs: ObsSession, add: (w: HealthWarning) => void, now: number) {
    const seen = new Set<string>();
    for (const src of await listNetworkSources(obs)) {
      if (!src.url || !(await isSourceActive(obs, src.name))) continue;
      seen.add(src.name);
      const mediaState = await getMediaState(obs, src.name);
      const prev = this.cameras.get(src.name);
      const cam =
        prev && prev.state === mediaState ? prev : { state: mediaState, since: now, lastReload: prev?.lastReload ?? 0 };
      this.cameras.set(src.name, cam);

      const action = cameraAction(mediaState, cam.since, cam.lastReload, now);
      if (action === "ok") continue;
      const state = mediaState.replace("OBS_MEDIA_STATE_", "").toLowerCase();
      if (now - cam.since >= CAMERA_FAILED_MS)
        add({
          id: `camera-${src.name}`,
          level: "warning",
          title: `Camera "${src.name}" is not playing`,
          detail: `Its media source is ${state}; the panel reloads it automatically.`,
        });
      if (action === "reload") {
        cam.lastReload = now;
        cam.since = now;
        try {
          await reloadMediaSource(obs, src.name);
          this.event("info", `Reloaded camera "${src.name}" (it was ${state})`, { obs: true });
        } catch (e) {
          this.event("error", `Could not reload camera "${src.name}": ${(e as Error).message}`, { obs: true });
        }
      }
    }
    for (const name of this.cameras.keys()) if (!seen.has(name)) this.cameras.delete(name);
  }

  private async keepStreamLive(
    obs: ObsSession,
    stream: StreamStatus,
    mtxReady: boolean,
    add: (w: HealthWarning) => void,
    now: number,
  ) {
    const kl = this.keepLive;
    if (stream.active) {
      kl.failures = 0;
      kl.nextAt = 0;
      return;
    }
    if (kl.failures >= KEEP_LIVE_GIVE_UP) {
      add({
        id: "keep-live",
        level: "error",
        title: "The stream is off and could not be restarted",
        detail: `Keep stream live gave up after ${KEEP_LIVE_GIVE_UP} attempts. Fix the cause, then start the stream or turn the setting off and on.`,
      });
      return;
    }
    if (stream.reconnecting || isRestarting() || now < kl.nextAt) return;
    // OBS publishes to MediaMTX; starting before it listens would just fail.
    if (!mtxReady) {
      add({
        id: "keep-live",
        level: "warning",
        title: "The stream is off",
        detail: "Keep stream live will start it once MediaMTX is running.",
      });
      return;
    }
    this.event("warning", "The stream is off; starting it");
    try {
      await ensureStreamLive(obs);
      this.event("info", "Stream started");
    } catch (e) {
      if (e instanceof ObsBusyError) return;
      kl.failures++;
      kl.nextAt = Date.now() + keepLiveRetryMs(kl.failures);
      this.event(
        "error",
        kl.failures >= KEEP_LIVE_GIVE_UP
          ? `Could not start the stream; giving up after ${kl.failures} attempts: ${(e as Error).message}`
          : `Could not start the stream (attempt ${kl.failures}): ${(e as Error).message}`,
      );
    }
  }

  private async checkQuality(obs: ObsSession, stream: StreamStatus, add: (w: HealthWarning) => void, now: number) {
    if (!stream.active) {
      this.frames = [];
      return;
    }
    const f = await getFrameStats(obs);
    const sample: FrameSample = {
      ts: now,
      netSkipped: stream.skippedFrames,
      netTotal: stream.totalFrames,
      renderSkipped: f.renderSkipped,
      renderTotal: f.renderTotal,
      encodeSkipped: f.encodeSkipped,
      encodeTotal: f.encodeTotal,
      congestion: stream.congestion,
    };
    // A restarted stream resets its counters; start the window over.
    const last = this.frames.at(-1);
    if (last && sample.netTotal < last.netTotal) this.frames = [];
    this.frames.push(sample);
    while (this.frames.length > 1 && now - this.frames[1].ts >= QUALITY_WINDOW_MS) this.frames.shift();
    if (this.frames.length > 1) for (const w of frameWarnings(this.frames[0], sample)) add(w);
  }
}

/** Warnings about OBS's output that also belong in the OBS log. */
function isObsWarning(id: string) {
  return id.startsWith("quality-") || id === "codec" || id === "whip-service" || id.startsWith("obs-");
}

const LABELS: Record<keyof AutomationSettings, string> = {
  keepStreamLive: "Keep stream live",
  reconnectCameras: "Reconnect cameras",
  keepWhip: "Keep OBS on WHIP",
  launchObs: "Launch OBS",
  adaptiveBitrate: "Adaptive bitrate",
  minBitrate: "Minimum bitrate (kbps)",
};

const g = globalThis as unknown as { __avSupervisor?: Supervisor };
export const supervisor = (g.__avSupervisor ??= new Supervisor());
