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
  getStreamStatus,
  isRestarting,
  isSourceActive,
  isWhipService,
  listNetworkSources,
  reloadMediaSource,
  switchToWhip,
  withObs,
  type ObsSession,
  type StreamStatus,
} from "./obs";
import { procman } from "./procman";
import { loadAutomationSettings, saveAutomationSettings } from "./automation-settings";
import type { AutomationEvent, AutomationPayload, AutomationSettings, HealthWarning } from "./shared";

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
    "The encoder is overloaded; use a hardware encoder or a faster preset, or lower the resolution.",
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
  private seq = 0;

  private keepLive = { failures: 0, nextAt: 0 };
  private cameras = new Map<string, { state: string; since: number; lastReload: number }>();
  private frames: FrameSample[] = [];
  private lastWhipAttempt = 0;

  ensureRunning() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  get warnings(): HealthWarning[] {
    return [...this.warningsById.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  }

  payload(): AutomationPayload {
    return {
      settings: this.settings,
      ingest: INGEST,
      obsConnected: this.obsConnected,
      warnings: this.warnings,
      events: this.events.toReversed(),
    };
  }

  async update(patch: Partial<AutomationSettings>) {
    const next = { ...this.settings, ...patch };
    for (const [k, v] of Object.entries(patch)) {
      if (this.settings[k as keyof AutomationSettings] !== v)
        this.event("info", `${LABELS[k as keyof AutomationSettings]} turned ${v ? "on" : "off"}`);
    }
    this.settings = next;
    // Re-arm after an operator's change, e.g. after fixing whatever made keep-live give up.
    this.keepLive = { failures: 0, nextAt: 0 };
    this.lastWhipAttempt = 0;
    await saveAutomationSettings(next);
    void this.tick();
  }

  private event(level: AutomationEvent["level"], text: string) {
    this.events.push({ id: ++this.seq, ts: Date.now(), level, text });
    if (this.events.length > EVENTS_MAX) this.events.shift();
    const log = level === "error" ? console.error : level === "warning" ? console.warn : console.log;
    log(`[automation] ${text}`);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const next = new Map<string, HealthWarning>();
      await this.check(next);
      // Record each warning once, when it appears.
      for (const w of next.values())
        if (!this.warningsById.has(w.id)) this.event(w.level, `${w.title}${w.detail ? ` — ${w.detail}` : ""}`);
      this.warningsById = next;
    } catch (e) {
      console.error("[automation] check failed", e);
    } finally {
      this.ticking = false;
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

    try {
      await withObs((obs) => this.checkObs(obs, add, out, mtxReady));
      this.obsConnected = true;
    } catch (e) {
      if (this.obsConnected) this.event("warning", `Lost contact with OBS: ${(e as Error).message}`);
      this.obsConnected = false;
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

  private async checkObs(
    obs: ObsSession,
    add: (w: HealthWarning) => void,
    out: PathInfo | undefined,
    mtxReady: boolean,
  ) {
    let stream = await getStreamStatus(obs);
    const now = Date.now();

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
          this.event("info", `Reloaded camera "${src.name}" (it was ${state})`);
        } catch (e) {
          this.event("error", `Could not reload camera "${src.name}": ${(e as Error).message}`);
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

const LABELS: Record<keyof AutomationSettings, string> = {
  keepStreamLive: "Keep stream live",
  reconnectCameras: "Reconnect cameras",
  keepWhip: "Keep OBS on WHIP",
};

const g = globalThis as unknown as { __avSupervisor?: Supervisor };
export const supervisor = (g.__avSupervisor ??= new Supervisor());
