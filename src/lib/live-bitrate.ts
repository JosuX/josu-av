import "server-only";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "./config";
import { replaceFile } from "./files";

// The bridge to obs/av-live-bitrate.lua, which runs inside OBS: the panel writes the bitrate it
// wants to `obs-bitrate`, and the script applies it to the running encoder and reports what it
// runs at in `obs-bitrate-status` (every second, so a stale file means the script isn't loaded).

const REQUEST_FILE = path.join(STATE_DIR, "obs-bitrate");
const STATUS_FILE = path.join(STATE_DIR, "obs-bitrate-status");
const STATUS_FRESH_MS = 10_000;

/**
 * Absolute path of the script, for the operator to add under Tools → Scripts. The desktop app
 * sets AV_OBS_SCRIPT to a copy outside its install folder, which the portable .exe replaces on
 * every start.
 */
export const SCRIPT_PATH = process.env.AV_OBS_SCRIPT ?? path.join(process.cwd(), "obs", "av-live-bitrate.lua");

export interface ScriptStatus {
  active: boolean;
  encoder: string | null;
  bitrate: number | null;
}

export function parseScriptStatus(txt: string, now: number): ScriptStatus | null {
  const kv = Object.fromEntries(
    txt
      // The script writes CRLF on Windows.
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  const ts = Number(kv.ts) * 1000;
  if (!ts || now - ts > STATUS_FRESH_MS) return null;
  return {
    active: kv.active === "true",
    encoder: kv.encoder || null,
    bitrate: kv.bitrate ? Number(kv.bitrate) : null,
  };
}

/** The script's latest report, or null when it isn't running. */
export async function readScriptStatus(): Promise<ScriptStatus | null> {
  const txt = await readFile(STATUS_FILE, "utf8").catch(() => null);
  return txt === null ? null : parseScriptStatus(txt, Date.now());
}

/** Encoders that apply a new bitrate while streaming. Others (e.g. VAAPI) only take it on restart. */
export function isLiveCapable(encoderId: string | null) {
  return !!encoderId && /x264|nvenc/i.test(encoderId);
}

export async function requestBitrate(kbps: number) {
  await mkdir(STATE_DIR, { recursive: true });
  await replaceFile(REQUEST_FILE, `${kbps}\n`);
}

/** Drop any pending request so a new stream starts at the profile's bitrate. */
export async function clearBitrateRequest() {
  await unlink(REQUEST_FILE).catch(() => {});
}
