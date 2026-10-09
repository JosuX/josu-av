import "server-only";
import { spawn, execFile, execFileSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { IS_WINDOWS, PDEATHSIG, PROCS, PROC_NAMES, type ProcName, type ProcSpec } from "./config";
import { LOG_MAX_LINES } from "./shared";

export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  id: number;
  ts: number;
  stream: LogStream;
  text: string;
}

export type ProcState = "stopped" | "starting" | "running" | "stopping" | "restarting" | "crashed";

export interface ProcStatus {
  name: ProcName;
  label: string;
  shortLabel: string;
  description: string;
  autoRestart: boolean;
  state: ProcState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  exitSignal: string | null;
  restarts: number;
  command: string;
  externalPids: number[];
}

const RESTART_DELAY_MS = 3000;
const KILL_TIMEOUT_MS = 5000;
/** How long a pgrep result is reused; status is polled by every open dashboard. */
const EXTERNAL_CACHE_MS = 1000;

/**
 * Split a chunk of output into complete lines, carrying the unterminated tail over.
 * ffmpeg rewrites its progress line with \r, so that counts as a line break too.
 */
export function splitLines(partial: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (partial + chunk).split(/\r\n|\r|\n/);
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((p) => p.trim()), rest };
}

let setprivAvailable: boolean | undefined;

/** The argv to spawn, wrapped so the kernel stops the child if this server dies. */
function spawnArgv(spec: ProcSpec): [string, string[]] {
  if (PDEATHSIG) {
    if (setprivAvailable === undefined) {
      try {
        execFileSync("setpriv", ["--version"], { stdio: "ignore" });
        setprivAvailable = true;
      } catch {
        setprivAvailable = false;
      }
    }
    // setpriv execs the target, so the pid and command line are the target's own.
    if (setprivAvailable) return ["setpriv", ["--pdeathsig", "TERM", "--", spec.bin, ...spec.args]];
  }
  return [spec.bin, spec.args];
}

export class ManagedProcess extends EventEmitter {
  child: ChildProcess | null = null;
  state: ProcState = "stopped";
  startedAt: number | null = null;
  exitCode: number | null = null;
  exitSignal: string | null = null;
  restarts = 0;
  lines: LogLine[] = [];
  private seq = 0;
  private wantRunning = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private partial: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };

  constructor(
    readonly spec: ProcSpec,
    private readonly restartDelayMs = RESTART_DELAY_MS,
  ) {
    super();
    this.setMaxListeners(100);
  }

  get name() {
    return this.spec.name;
  }

  log(stream: LogStream, text: string) {
    const line: LogLine = { id: ++this.seq, ts: Date.now(), stream, text };
    this.lines.push(line);
    if (this.lines.length > LOG_MAX_LINES) this.lines.splice(0, this.lines.length - LOG_MAX_LINES);
    this.emit("line", line);
  }

  clearLogs() {
    this.lines = [];
    this.emit("clear");
  }

  private setState(state: ProcState) {
    this.state = state;
    this.emit("state", state);
  }

  private onData(stream: "stdout" | "stderr", chunk: Buffer) {
    const { lines, rest } = splitLines(this.partial[stream], chunk.toString("utf8"));
    this.partial[stream] = rest;
    for (const l of lines) this.log(stream, l);
  }

  start() {
    this.wantRunning = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) return;
    this.spawnChild();
  }

  private spawnChild() {
    const { bin, args, env } = this.spec;
    this.log("system", `$ ${[bin, ...args].join(" ")}`);
    this.setState("starting");
    this.exitCode = null;
    this.exitSignal = null;

    const child = spawn(...spawnArgv(this.spec), {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      // Console programs would otherwise each open a console window on Windows.
      windowsHide: true,
    });
    this.child = child;

    child.once("spawn", () => {
      this.startedAt = Date.now();
      this.log("system", `started (pid ${child.pid})`);
      this.setState("running");
    });
    child.stdout?.on("data", (c: Buffer) => this.onData("stdout", c));
    child.stderr?.on("data", (c: Buffer) => this.onData("stderr", c));
    child.once("error", (err) => {
      this.log("system", `failed to start: ${err.message}`);
    });
    child.once("close", (code, signal) => {
      for (const s of ["stdout", "stderr"] as const) {
        if (this.partial[s].trim()) this.log(s, this.partial[s]);
        this.partial[s] = "";
      }
      this.child = null;
      this.exitCode = code;
      this.exitSignal = signal;
      this.startedAt = null;
      this.log("system", `exited (${signal ? `signal ${signal}` : `code ${code}`})`);

      if (this.wantRunning && this.spec.autoRestart) {
        this.restarts++;
        this.setState("restarting");
        this.log("system", `restarting in ${this.restartDelayMs / 1000}s…`);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.wantRunning) this.spawnChild();
        }, this.restartDelayMs);
      } else {
        const clean = !this.wantRunning || code === 0;
        this.wantRunning = false;
        this.setState(clean ? "stopped" : "crashed");
      }
    });
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.setState("stopped");
      this.log("system", "pending restart cancelled");
    }
    const child = this.child;
    if (!child) return;
    this.setState("stopping");
    this.log("system", `stopping (${this.spec.stopSignal})`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.log("system", "did not exit in time, sending SIGKILL");
        child.kill("SIGKILL");
      }, KILL_TIMEOUT_MS);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill(this.spec.stopSignal);
    });
  }

  async restart() {
    await this.stop();
    this.start();
  }
}

/** PIDs from `tasklist /FO CSV /NH` output ("image","pid",...); "INFO: No tasks" yields none. */
export function parseTasklist(csv: string): number[] {
  return Array.from(csv.matchAll(/^"[^"]*","(\d+)"/gm), (m) => Number(m[1]));
}

/** Parse "pid<TAB>command line" rows. */
export function parsePidCommandLines(txt: string): { pid: number; cmd: string }[] {
  return txt
    .split(/\r?\n/)
    .map((l) => /^(\d+)\t(.*)$/.exec(l))
    .filter((m) => m !== null)
    .map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000 }, (_err, stdout) => resolve(stdout ?? ""));
  });
}

/**
 * Windows has no pgrep. tasklist is quick but has no command lines, so it narrows the search
 * by image name and the much slower PowerShell CIM query only runs when it finds a process
 * other than our own child.
 */
async function findWindowsPids(spec: ProcSpec, ownPid: number | undefined): Promise<number[]> {
  const image = `${path.basename(spec.bin).replace(/\.exe$/i, "")}.exe`;
  const candidates = parseTasklist(
    await run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"]),
  ).filter((pid) => pid !== ownPid);
  if (!candidates.length) return [];
  const filter = candidates.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const out = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`,
  ]);
  const re = new RegExp(spec.externalPattern, "i");
  return parsePidCommandLines(out)
    .filter((p) => re.test(p.cmd.trim()))
    .map((p) => p.pid);
}

class ProcessManager {
  readonly procs: Record<ProcName, ManagedProcess>;
  private pgrepCache = new Map<ProcName, { at: number; pids: Promise<number[]> }>();

  constructor() {
    this.procs = Object.fromEntries(PROC_NAMES.map((n) => [n, new ManagedProcess(PROCS[n])])) as Record<
      ProcName,
      ManagedProcess
    >;
    // Next turns SIGINT/SIGTERM into process.exit(), so this covers graceful shutdowns;
    // the pdeathsig wrapper covers the server being killed outright (on Windows, the Electron
    // shell kills the server's whole process tree instead).
    const shutdown = () => {
      for (const p of Object.values(this.procs)) p.child?.kill("SIGTERM");
    };
    process.once("exit", shutdown);
    for (const p of Object.values(this.procs)) p.on("state", () => this.pgrepCache.delete(p.name));
  }

  get(name: ProcName) {
    return this.procs[name];
  }

  private pgrep(name: ProcName): Promise<number[]> {
    const cached = this.pgrepCache.get(name);
    if (cached && Date.now() - cached.at < EXTERNAL_CACHE_MS) return cached.pids;
    const pids = IS_WINDOWS
      ? findWindowsPids(PROCS[name], this.procs[name].child?.pid)
      : new Promise<number[]>((resolve) => {
          execFile("pgrep", ["-f", PROCS[name].externalPattern], (_err, stdout) => {
            resolve(stdout.split("\n").map((s) => Number(s.trim())).filter(Boolean));
          });
        });
    this.pgrepCache.set(name, { at: Date.now(), pids });
    return pids;
  }

  /** Instances matching the process pattern that this app did not spawn. */
  async findExternal(name: ProcName, { fresh = false } = {}): Promise<number[]> {
    if (fresh) this.pgrepCache.delete(name);
    const pids = await this.pgrep(name);
    const own = this.procs[name].child?.pid;
    return pids.filter((pid) => pid !== own && pid !== process.pid);
  }

  async killExternal(name: ProcName) {
    const pids = await this.findExternal(name, { fresh: true });
    for (const pid of pids) {
      try {
        process.kill(pid, PROCS[name].stopSignal);
        this.procs[name].log("system", `sent ${PROCS[name].stopSignal} to external pid ${pid}`);
      } catch (e) {
        this.procs[name].log("system", `could not signal external pid ${pid}: ${(e as Error).message}`);
      }
    }
    this.pgrepCache.delete(name);
    return pids;
  }

  async status(): Promise<ProcStatus[]> {
    return Promise.all(
      PROC_NAMES.map(async (name) => {
        const p = this.procs[name];
        return {
          name,
          label: p.spec.label,
          shortLabel: p.spec.shortLabel,
          description: p.spec.description,
          autoRestart: p.spec.autoRestart,
          state: p.state,
          pid: p.child?.pid ?? null,
          startedAt: p.startedAt,
          exitCode: p.exitCode,
          exitSignal: p.exitSignal,
          restarts: p.restarts,
          command: [p.spec.bin, ...p.spec.args].join(" "),
          externalPids: await this.findExternal(name),
        };
      }),
    );
  }
}

// Keep a single instance across hot reloads and route bundles.
const g = globalThis as unknown as { __avProcMan?: ProcessManager };
export const procman = (g.__avProcMan ??= new ProcessManager());
