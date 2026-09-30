import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { E2E } from "./env";

// A MediaMTX of its own with a synthetic stream (test pattern + tone, H.264 + Opus) on the
// panel's path, so the tests exercise real WebRTC playback without OBS.

async function waitForStream(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${E2E.mediamtxApi}/v3/paths/list`);
      const { items } = (await res.json()) as { items: { name: string; ready: boolean }[] };
      if (items.some((p) => p.name === "assembly" && p.ready)) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The test stream never became ready; check that mediamtx and ffmpeg (libx264, libopus) are installed");
}

/**
 * Output goes to a file in the temp dir (av-e2e-<name>.log), to diagnose a failed run; an unread
 * pipe could also fill up and block the process.
 */
function run(bin: string, args: string[]): ChildProcess {
  const out = openSync(path.join(tmpdir(), `av-e2e-${path.basename(bin)}.log`), "w");
  const child = spawn(bin, args, { stdio: ["ignore", out, out] });
  child.on("error", (e) => console.error(`[e2e] could not start ${bin}: ${e.message}`));
  return child;
}

export default async function globalSetup() {
  rmSync(E2E.stateDir, { recursive: true, force: true });
  mkdirSync(E2E.stateDir, { recursive: true });

  // Run MediaMTX under another name: a real panel on this machine treats any process called
  // "mediamtx" as an outside copy of its own (blocking its Start button and offering to stop
  // it), which is exactly what happened to a test run.
  const binDir = path.join(tmpdir(), "av-e2e-bin");
  rmSync(binDir, { recursive: true, force: true });
  mkdirSync(binDir);
  const real = execFileSync("sh", ["-c", "command -v mediamtx"], { encoding: "utf8" }).trim();
  symlinkSync(real, path.join(binDir, "mediamtx-e2e"));
  const mediamtx = run(path.join(binDir, "mediamtx-e2e"), [path.join(process.cwd(), "e2e", "fixtures", "mediamtx.yml")]);
  await new Promise((r) => setTimeout(r, 1000));
  const ffmpeg = run("ffmpeg", [
    ...["-hide_banner", "-loglevel", "error", "-re"],
    ...["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30"],
    ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"],
    ...["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p"],
    ...["-c:a", "libopus", "-b:a", "64k"],
    ...["-f", "rtsp", "-rtsp_transport", "tcp", `${E2E.rtsp}/assembly`],
  ]);

  try {
    await waitForStream(15_000);
  } catch (e) {
    ffmpeg.kill();
    mediamtx.kill();
    throw e;
  }

  return async () => {
    ffmpeg.kill("SIGINT");
    mediamtx.kill("SIGTERM");
    rmSync(E2E.stateDir, { recursive: true, force: true });
  };
}
