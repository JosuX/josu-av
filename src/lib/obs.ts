import "server-only";
import { createHash } from "node:crypto";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { OBS_CONFIG_DIR, OBS_WS_PASSWORD, OBS_WS_URL } from "./config";

// Minimal obs-websocket v5 client. One connection is opened on first use and shared by
// every request until OBS closes it (e.g. OBS quits); the next request then reconnects.

const TIMEOUT_MS = 5000;

export class ObsError extends Error {}

/** The request conflicts with an operation already in progress. */
export class ObsBusyError extends ObsError {}

type Json = Record<string, unknown>;

async function wsPassword(): Promise<string | undefined> {
  if (OBS_WS_PASSWORD !== undefined) return OBS_WS_PASSWORD;
  try {
    const raw = await readFile(path.join(OBS_CONFIG_DIR, "plugin_config/obs-websocket/config.json"), "utf8");
    return (JSON.parse(raw) as { server_password?: string }).server_password;
  } catch {
    return undefined;
  }
}

const sha256b64 = (s: string) => createHash("sha256").update(s).digest("base64");

export interface ObsSession {
  call<T = Json>(requestType: string, requestData?: Json): Promise<T>;
}

/** Connect and identify; resolves once the session is ready for requests. */
async function connect(onClosed: () => void): Promise<ObsSession> {
  const password = await wsPassword();
  const ws = new WebSocket(OBS_WS_URL, "obswebsocket.json");
  const pending = new Map<string, { resolve: (v: Json) => void; reject: (e: Error) => void }>();
  let seq = 0;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ObsError(`Timed out connecting to OBS at ${OBS_WS_URL}`));
      ws.close();
    }, TIMEOUT_MS);
    ws.onerror = () => {
      clearTimeout(timer);
      reject(
        new ObsError(
          `Cannot reach OBS at ${OBS_WS_URL}. Is OBS running with the WebSocket server enabled (Tools → WebSocket Server Settings)?`,
        ),
      );
    };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      const reason = ev.code === 4009 ? "OBS rejected the WebSocket password" : `OBS closed the connection (${ev.code})`;
      reject(new ObsError(reason));
      for (const p of pending.values()) p.reject(new ObsError(reason));
      pending.clear();
      onClosed();
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { op: number; d: Json };
      if (msg.op === 0) {
        const auth = msg.d.authentication as { challenge: string; salt: string } | undefined;
        const d: Json = { rpcVersion: 1, eventSubscriptions: 0 };
        if (auth) {
          if (!password) {
            reject(new ObsError("OBS requires a WebSocket password; set AV_OBS_WS_PASSWORD"));
            ws.close();
            return;
          }
          d.authentication = sha256b64(sha256b64(password + auth.salt) + auth.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (msg.op === 2) {
        clearTimeout(timer);
        resolve();
      } else if (msg.op === 7) {
        const id = msg.d.requestId as string;
        const status = msg.d.requestStatus as { result: boolean; code: number; comment?: string };
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (status.result) p.resolve((msg.d.responseData as Json) ?? {});
        else p.reject(new ObsError(`${msg.d.requestType} failed: ${status.comment ?? `code ${status.code}`}`));
      }
    };
  });

  return {
    call: (requestType, requestData) =>
      new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) return reject(new ObsError("OBS connection is closed"));
        const requestId = String(++seq);
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new ObsError(`${requestType} timed out`));
          // A silent OBS is likely a dead socket; drop it so the next request reconnects.
          ws.close();
        }, TIMEOUT_MS);
        pending.set(requestId, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v as never);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      }),
  };
}

// Shared across hot reloads and route bundles, like the process manager.
const g = globalThis as unknown as { __avObs?: Promise<ObsSession> };

function session(): Promise<ObsSession> {
  if (!g.__avObs) {
    const p = connect(() => {
      if (g.__avObs === p) g.__avObs = undefined;
    });
    // A failed attempt must not stick; the next request tries again.
    p.catch(() => {
      if (g.__avObs === p) g.__avObs = undefined;
    });
    g.__avObs = p;
  }
  return g.__avObs;
}

/** Run `fn` against the shared OBS connection, connecting first if needed. */
export async function withObs<T>(fn: (obs: ObsSession) => Promise<T>): Promise<T> {
  return fn(await session());
}

// ---------------------------------------------------------------------------
// Network sources (IP camera)

/** Input kinds whose source is a URL. */
const URL_INPUT_KEYS: Record<string, string> = { ffmpeg_source: "input" };

export interface NetworkSource {
  name: string;
  kind: string;
  url: string;
}

export async function listNetworkSources(obs: ObsSession): Promise<NetworkSource[]> {
  const { inputs } = await obs.call<{ inputs: { inputName: string; inputKind: string }[] }>("GetInputList");
  const found = await Promise.all(
    inputs
      .filter((i) => URL_INPUT_KEYS[i.inputKind])
      .map(async (i): Promise<NetworkSource | null> => {
        const { inputSettings } = await obs.call<{ inputSettings: Json }>("GetInputSettings", {
          inputName: i.inputName,
        });
        if (inputSettings.is_local_file === true) return null;
        return { name: i.inputName, kind: i.inputKind, url: String(inputSettings[URL_INPUT_KEYS[i.inputKind]] ?? "") };
      }),
  );
  return found.filter((s) => s !== null);
}

export async function setSourceUrl(obs: ObsSession, inputName: string, url: string) {
  const { inputKind } = await obs.call<{ inputKind: string }>("GetInputSettings", { inputName });
  const key = URL_INPUT_KEYS[inputKind];
  if (!key) throw new ObsError(`${inputName} is not a network media source`);
  // Changing the settings makes OBS reopen the source with the new URL.
  await obs.call("SetInputSettings", { inputName, inputSettings: { [key]: url, is_local_file: false }, overlay: true });
}

// ---------------------------------------------------------------------------
// Stream encoder. OBS has no websocket request for encoder settings, but in Advanced
// output mode it re-reads the profile's streamEncoder.json every time a stream starts.

export interface EncoderInfo {
  profile: string;
  outputMode: string;
  encoder: string;
  /** Bitrate saved in the profile (what the next stream start will use). */
  bitrate: number;
  /** Bitrate OBS logged when the stream last started, if found. */
  effectiveBitrate: number | null;
  rateControl: string;
  /** Why the bitrate cannot be changed from here, if it cannot. */
  unsupported: string | null;
}

// obs_x264's default since OBS 32 (was 2500 before).
const DEFAULT_BITRATE = 6000;

/**
 * The video bitrate of every stream-encoder settings block in an OBS log, oldest first; OBS
 * logs one each time the stream encoder starts. Best effort: only encoders that log a
 * "bitrate:" line are recognised.
 */
export function parseEncoderStarts(log: string): number[] {
  const re = /encoder: '(?:advanced|simple)_video_stream'\] settings:\n(?:.*\n){0,8}?.*\tbitrate:\s*(\d+)/g;
  return Array.from(log.matchAll(re), (m) => Number(m[1]));
}

export function parseEffectiveBitrate(log: string): number | null {
  return parseEncoderStarts(log).at(-1) ?? null;
}

interface EncoderLog {
  file: string | null;
  starts: number[];
}

// Logs grow to megabytes and the settings page polls, so only re-read when the file changes.
let logCache: { file: string; mtimeMs: number; size: number; starts: number[] } | null = null;

async function readEncoderLog(): Promise<EncoderLog> {
  const dir = path.join(OBS_CONFIG_DIR, "logs");
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".txt")).sort();
  const latest = files.at(-1);
  if (!latest) return { file: null, starts: [] };
  const file = path.join(dir, latest);
  const st = await stat(file).catch(() => null);
  if (!st) return { file: null, starts: [] };
  if (logCache?.file === file && logCache.mtimeMs === st.mtimeMs && logCache.size === st.size) return logCache;
  const starts = parseEncoderStarts(await readFile(file, "utf8").catch(() => ""));
  logCache = { file, mtimeMs: st.mtimeMs, size: st.size, starts };
  return logCache;
}

/** The video bitrate OBS actually used when the stream encoder last started. */
export async function getEffectiveBitrate(): Promise<number | null> {
  return (await readEncoderLog()).starts.at(-1) ?? null;
}

/** A position in the OBS log to wait past with waitForEncoderStart. */
export async function markEncoderLog(): Promise<EncoderLog> {
  return readEncoderLog();
}

/**
 * The bitrate of the first encoder start logged after `mark`, or null if none shows up in
 * time. OBS writes its log with a delay, so it can lag the stream becoming active.
 */
export async function waitForEncoderStart(mark: EncoderLog, timeoutMs = 5000): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const now = await readEncoderLog();
    if (now.file !== mark.file) {
      if (now.starts.length) return now.starts.at(-1)!;
    } else if (now.starts.length > mark.starts.length) {
      return now.starts.at(-1)!;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function profileDir(profileName: string): Promise<string> {
  const root = path.join(OBS_CONFIG_DIR, "basic/profiles");
  for (const dir of await readdir(root)) {
    const ini = await readFile(path.join(root, dir, "basic.ini"), "utf8").catch(() => "");
    if (/^Name=(.*)$/m.exec(ini)?.[1]?.trim() === profileName) return path.join(root, dir);
  }
  throw new ObsError(`Profile "${profileName}" not found under ${root}`);
}

async function profileParam(obs: ObsSession, category: string, name: string) {
  const r = await obs.call<{ parameterValue: string | null; defaultParameterValue: string | null }>(
    "GetProfileParameter",
    { parameterCategory: category, parameterName: name },
  );
  return r.parameterValue ?? r.defaultParameterValue ?? "";
}

async function encoderFile(obs: ObsSession) {
  const { currentProfileName } = await obs.call<{ currentProfileName: string }>("GetProfileList");
  const file = path.join(await profileDir(currentProfileName), "streamEncoder.json");
  const settings = JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as Json;
  return { profile: currentProfileName, file, settings };
}

export async function getEncoder(obs: ObsSession): Promise<EncoderInfo> {
  const outputMode = await profileParam(obs, "Output", "Mode");
  const advanced = outputMode === "Advanced";
  const [encoder, simpleBitrate, { profile, settings }, effectiveBitrate] = await Promise.all([
    advanced ? profileParam(obs, "AdvOut", "Encoder") : profileParam(obs, "SimpleOutput", "StreamEncoder"),
    advanced ? null : profileParam(obs, "SimpleOutput", "VBitrate"),
    encoderFile(obs),
    getEffectiveBitrate(),
  ]);
  const rateControl = String(settings.rate_control ?? "CBR");
  return {
    profile,
    outputMode,
    encoder,
    bitrate: advanced ? Number(settings.bitrate ?? effectiveBitrate ?? DEFAULT_BITRATE) : Number(simpleBitrate),
    effectiveBitrate,
    rateControl,
    unsupported: !advanced
      ? "OBS is in Simple output mode; switch to Advanced (Settings → Output) to change bitrate from here."
      : !["CBR", "VBR", "ABR"].includes(rateControl.toUpperCase())
        ? `The encoder uses ${rateControl} rate control, which ignores bitrate.`
        : null,
  };
}

export async function setBitrate(obs: ObsSession, kbps: number) {
  const info = await getEncoder(obs);
  if (info.unsupported) throw new ObsError(info.unsupported);
  const { file, settings } = await encoderFile(obs);
  settings.bitrate = kbps;
  const tmp = `${file}.av-tmp`;
  await writeFile(tmp, JSON.stringify(settings));
  await rename(tmp, file);
}

/**
 * The bitrate currently in the profile's streamEncoder.json. OBS rewrites that file when it
 * saves the profile (e.g. its Settings dialog is closed with OK), which can undo setBitrate.
 */
export async function getSavedBitrate(obs: ObsSession): Promise<number | null> {
  const { settings } = await encoderFile(obs);
  return settings.bitrate == null ? null : Number(settings.bitrate);
}

// ---------------------------------------------------------------------------
// Streaming output

export interface StreamStatus {
  active: boolean;
  reconnecting: boolean;
  durationMs: number;
  bytes: number;
}

export async function getStreamStatus(obs: ObsSession): Promise<StreamStatus> {
  const s = await obs.call<{
    outputActive: boolean;
    outputReconnecting: boolean;
    outputDuration: number;
    outputBytes: number;
  }>("GetStreamStatus");
  return { active: s.outputActive, reconnecting: s.outputReconnecting, durationMs: s.outputDuration, bytes: s.outputBytes };
}

async function waitForStream(obs: ObsSession, active: boolean, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await getStreamStatus(obs)).active === active) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new ObsError(`Stream did not ${active ? "start" : "stop"} within ${timeoutMs / 1000}s`);
}

let restarting = false;

/** Stop the stream if it is live, then start it (which picks up new encoder settings). */
export async function restartStream(obs: ObsSession) {
  if (restarting) throw new ObsBusyError("A stream restart is already in progress");
  restarting = true;
  try {
    if ((await getStreamStatus(obs)).active) {
      await obs.call("StopStream");
      await waitForStream(obs, false);
    }
    await obs.call("StartStream");
    await waitForStream(obs, true);
  } finally {
    restarting = false;
  }
}

// ---------------------------------------------------------------------------

export type ObsPayload =
  | { connected: false; error: string }
  | { connected: true; sources: NetworkSource[]; encoder: EncoderInfo; stream: StreamStatus };
