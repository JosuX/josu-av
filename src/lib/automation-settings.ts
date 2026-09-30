import "server-only";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AUTOMATION_KEYS, type AutomationSettings } from "./shared";

// Operator choices persist across restarts, in AV_STATE_DIR (default ~/.local/state/av-control).

const STATE_DIR =
  process.env.AV_STATE_DIR ?? `${process.env.XDG_STATE_HOME ?? `${process.env.HOME}/.local/state`}/av-control`;
const FILE = path.join(STATE_DIR, "automation.json");

export const DEFAULT_AUTOMATION: AutomationSettings = {
  keepStreamLive: false,
  reconnectCameras: true,
  keepWhip: true,
};

/** Defaults overlaid with every boolean setting found in `raw`. */
export function parseAutomationSettings(raw: unknown): AutomationSettings {
  const out = { ...DEFAULT_AUTOMATION };
  if (raw && typeof raw === "object") {
    for (const k of AUTOMATION_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

export function loadAutomationSettings(): AutomationSettings {
  try {
    return parseAutomationSettings(JSON.parse(readFileSync(FILE, "utf8")));
  } catch {
    return { ...DEFAULT_AUTOMATION };
  }
}

export async function saveAutomationSettings(settings: AutomationSettings) {
  await mkdir(STATE_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2));
  await rename(tmp, FILE);
}
