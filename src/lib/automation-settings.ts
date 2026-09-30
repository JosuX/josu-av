import "server-only";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { STATE_DIR } from "./config";
import { DEFAULT_AUTOMATION, parseAutomationPatch, type AutomationSettings } from "./shared";

// Operator choices persist across restarts, in AV_STATE_DIR (default ~/.local/state/av-control).

const FILE = path.join(STATE_DIR, "automation.json");

export { DEFAULT_AUTOMATION };

/** Defaults overlaid with every valid setting found in `raw`; invalid ones are ignored. */
export function parseAutomationSettings(raw: unknown): AutomationSettings {
  const out = { ...DEFAULT_AUTOMATION };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      const one = parseAutomationPatch({ [k]: v });
      if ("patch" in one) Object.assign(out, one.patch);
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
