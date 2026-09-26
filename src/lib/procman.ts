import "server-only";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PROCS, PROC_NAMES, type ProcName } from "./config";

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
  state: ProcState;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  exitSignal: string | null;
  restarts: number;
  command: string;
  externalPids: number[];
}

const MAX_LINES = 3000;
const RESTART_DELAY_MS = 3000;
const KILL_TIMEOUT_MS = 5000;

class ManagedProcess extends EventEmitter {
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

  constructor(readonly name: ProcName) {
    super();
    this.setMaxListeners(100);
  }

  get spec() {
    return PROCS[this.name];
  }

  log(stream: LogStream, text: string) {
    const line: LogLine = { id: ++this.seq, ts: Date.now(), stream, text };
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
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
    // ffmpeg rewrites its progress line with \r, so treat it as a line break too.
    const parts = (this.partial[stream] + chunk.toString("utf8")).split(/\r\n|\r|\n/);
    this.partial[stream] = parts.pop() ?? "";
    for (const p of parts) if (p.trim()) this.log(stream, p);
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

    const child = spawn(bin, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
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
        this.log("system", `restarting in ${RESTART_DELAY_MS / 1000}s…`);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.wantRunning) this.spawnChild();
        }, RESTART_DELAY_MS);
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

class ProcessManager {
  readonly procs: Record<ProcName, ManagedProcess>;

  constructor() {
    this.procs = Object.fromEntries(PROC_NAMES.map((n) => [n, new ManagedProcess(n)])) as Record<
      ProcName,
      ManagedProcess
    >;
    const shutdown = () => {
      for (const p of Object.values(this.procs)) p.child?.kill("SIGTERM");
    };
    process.once("exit", shutdown);
  }

  get(name: ProcName) {
    return this.procs[name];
  }

  /** Instances matching the process pattern that this app did not spawn. */
  findExternal(name: ProcName): Promise<number[]> {
    const own = this.procs[name].child?.pid;
    return new Promise((resolve) => {
      execFile("pgrep", ["-f", PROCS[name].externalPattern], (_err, stdout) => {
        const pids = stdout
          .split("\n")
          .map((s) => Number(s.trim()))
          .filter((pid) => pid && pid !== own && pid !== process.pid);
        resolve(pids);
      });
    });
  }

  async killExternal(name: ProcName) {
    const pids = await this.findExternal(name);
    for (const pid of pids) {
      try {
        process.kill(pid, PROCS[name].stopSignal);
        this.procs[name].log("system", `sent ${PROCS[name].stopSignal} to external pid ${pid}`);
      } catch (e) {
        this.procs[name].log("system", `could not signal external pid ${pid}: ${(e as Error).message}`);
      }
    }
    return pids;
  }

  async status(): Promise<ProcStatus[]> {
    return Promise.all(
      PROC_NAMES.map(async (name) => {
        const p = this.procs[name];
        return {
          name,
          label: p.spec.label,
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
