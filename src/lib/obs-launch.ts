import "server-only";
import { execFile, spawn } from "node:child_process";
import { readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { IS_WINDOWS, OBS_BIN, OBS_CONFIG_DIR, OBS_EXTRA_ARGS, OBS_PROCESS } from "./config";
import { findWindowsProcesses } from "./winproc";

// Opens OBS on the desktop. OBS must outlive this server (a panel restart mid-meeting must not
// close it), so on Linux it is started as its own systemd unit rather than as a child process.
// Windows doesn't stop a process's children when it exits, so there it is started directly.

export class ObsLaunchError extends Error {}

type Launcher = "uwsm" | "systemd-run" | "direct";

function run(bin: string, args: string[], timeout = 10_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr }));
  });
}

export async function isObsRunning(): Promise<boolean> {
  if (IS_WINDOWS) {
    const image = /\.exe$/i.test(OBS_PROCESS) ? OBS_PROCESS : `${OBS_PROCESS}.exe`;
    return (await findWindowsProcesses(image)).length > 0;
  }
  return (await run("pgrep", ["-x", OBS_PROCESS])).ok;
}

const DISPLAY_VARS = ["WAYLAND_DISPLAY", "DISPLAY"];

/**
 * The graphical session's display variables, or null without one. When the panel started at
 * boot (lingering) its own environment has none, but the systemd user manager gains them once
 * the desktop session starts.
 */
export async function displayEnv(): Promise<Record<string, string> | null> {
  // Windows has no display variables; a panel started in the user's session has the desktop.
  if (IS_WINDOWS) return {};
  const own = Object.fromEntries(DISPLAY_VARS.filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
  if (Object.keys(own).length) return own;
  const { ok, stdout } = await run("systemctl", ["--user", "show-environment"]);
  if (!ok) return null;
  const found = Object.fromEntries(
    stdout
      .split("\n")
      .map((l) => l.split("=", 2) as [string, string])
      .filter(([k, v]) => DISPLAY_VARS.includes(k) && v),
  );
  return Object.keys(found).length ? found : null;
}

let launcher: Launcher | undefined;

async function pickLauncher(): Promise<Launcher> {
  if (launcher) return launcher;
  if (IS_WINDOWS) launcher = "direct";
  else if ((await run("uwsm", ["check", "is-active"])).ok) launcher = "uwsm";
  else if (!["", "offline"].includes((await run("systemctl", ["--user", "is-system-running"])).stdout.trim()))
    launcher = "systemd-run";
  else launcher = "direct";
  return launcher;
}

/** The command that starts OBS with `obsArgs` through `via`. */
export function launchArgv(via: Launcher, obsArgs: string[]): string[] {
  const obs = [OBS_BIN, ...obsArgs];
  switch (via) {
    case "uwsm":
      return ["uwsm", "app", "-t", "service", "-a", "obs", "--", ...obs];
    case "systemd-run":
      return ["systemd-run", "--user", "--collect", "--quiet", "--", ...obs];
    case "direct":
      return obs;
  }
}

/**
 * After a crash OBS asks whether to start in Safe Mode, which disables the WebSocket server,
 * and waits for an answer. It decides from run_* marker files it leaves while running, so
 * remove any left behind. Only call this while OBS is not running.
 */
async function clearCrashMarkers(): Promise<number> {
  const dir = path.join(OBS_CONFIG_DIR, ".sentinel");
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.startsWith("run_"));
  await Promise.all(files.map((f) => unlink(path.join(dir, f)).catch(() => {})));
  return files.length;
}

/** Launch OBS; resolves with a description of what was run. */
export async function launchObs({ startStreaming }: { startStreaming: boolean }): Promise<string> {
  if (await isObsRunning()) throw new ObsLaunchError("OBS is already running");
  const display = await displayEnv();
  if (!display) throw new ObsLaunchError("No desktop session to open OBS on; log in to the desktop first");

  const cleared = await clearCrashMarkers();
  const args = ["--disable-missing-files-check", ...(startStreaming ? ["--startstreaming"] : []), ...OBS_EXTRA_ARGS];
  const via = await pickLauncher();
  const argv = launchArgv(via, args);

  if (via === "direct") {
    // On Linux a last resort: OBS stays in this server's process group and cgroup, so stopping
    // the panel's systemd service would stop OBS too.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, ...display },
        // OBS on Windows finds its locale and data files relative to the working directory, and
        // won't start from anywhere but its own bin folder.
        cwd: IS_WINDOWS && path.isAbsolute(OBS_BIN) ? path.dirname(OBS_BIN) : homedir(),
      });
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      child.once("error", (e) => reject(new ObsLaunchError(`Could not start ${OBS_BIN}: ${e.message}`)));
    });
  } else {
    const r = await run(argv[0], argv.slice(1));
    if (!r.ok) throw new ObsLaunchError(`${argv[0]} failed: ${(r.stderr || r.stdout).trim() || "no output"}`);
  }
  return `${argv.join(" ")}${cleared ? " (cleared a crash marker so OBS skips its Safe Mode prompt)" : ""}`;
}
