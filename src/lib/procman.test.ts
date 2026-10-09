import { afterEach, describe, expect, it } from "vitest";
import type { ProcSpec } from "./config";
import { ManagedProcess, parsePidCommandLines, parseTasklist, splitLines, type ProcState } from "./procman";

describe("splitLines", () => {
  it("carries an unterminated tail over to the next chunk", () => {
    const a = splitLines("", "one\ntw");
    expect(a).toEqual({ lines: ["one"], rest: "tw" });
    expect(splitLines(a.rest, "o\n")).toEqual({ lines: ["two"], rest: "" });
  });

  it("treats \\r (ffmpeg progress) and \\r\\n as line breaks and drops blank lines", () => {
    expect(splitLines("", "frame=1\rframe=2\r\n\n  \nend")).toEqual({ lines: ["frame=1", "frame=2"], rest: "end" });
  });
});

/** A Node script as the managed command, so the tests run wherever the suite does (no sh on Windows). */
function script(code: string, over: Partial<ProcSpec> = {}): ProcSpec {
  return {
    name: "ffmpeg",
    label: "test",
    shortLabel: "test",
    description: "",
    bin: process.execPath,
    args: ["-e", code],
    stopSignal: "SIGTERM",
    autoRestart: false,
    externalPattern: "^$",
    ...over,
  };
}

function waitFor(p: ManagedProcess, state: ProcState, timeoutMs = 3000) {
  return new Promise<void>((resolve, reject) => {
    if (p.state === state) return resolve();
    const t = setTimeout(() => reject(new Error(`still ${p.state}, wanted ${state}`)), timeoutMs);
    const on = (s: ProcState) => {
      if (s !== state) return;
      clearTimeout(t);
      p.off("state", on);
      resolve();
    };
    p.on("state", on);
  });
}

describe("ManagedProcess", () => {
  const procs: ManagedProcess[] = [];
  const make = (spec: ProcSpec, delay?: number) => {
    const p = new ManagedProcess(spec, delay);
    procs.push(p);
    return p;
  };
  afterEach(async () => {
    await Promise.all(procs.splice(0).map((p) => p.stop()));
  });

  it("captures output and ends stopped after a clean exit", async () => {
    const p = make(script("console.log('hello'); console.error('oops')"));
    p.start();
    await waitFor(p, "running");
    await waitFor(p, "stopped");
    expect(p.exitCode).toBe(0);
    expect(p.lines.filter((l) => l.stream !== "system").map((l) => [l.stream, l.text])).toEqual(
      expect.arrayContaining([
        ["stdout", "hello"],
        ["stderr", "oops"],
      ]),
    );
  });

  it("reports crashed on a non-zero exit", async () => {
    const p = make(script("process.exit(3)"));
    p.start();
    await waitFor(p, "crashed");
    expect(p.exitCode).toBe(3);
  });

  it("restarts on exit when autoRestart is set", async () => {
    const p = make(script("process.exit(1)", { autoRestart: true }), 50);
    p.start();
    await waitFor(p, "restarting");
    await waitFor(p, "running");
    expect(p.restarts).toBeGreaterThanOrEqual(1);
  });

  it("stops a running process with its stop signal", async () => {
    const p = make(script("setTimeout(() => {}, 30000)"));
    p.start();
    await waitFor(p, "running");
    await p.stop();
    expect(p.state).toBe("stopped");
    expect(p.exitSignal).toBe("SIGTERM");
  });
});

describe("Windows process lookup parsing", () => {
  it("reads PIDs from tasklist CSV output", () => {
    const csv = `"ffmpeg.exe","4120","Console","1","52,344 K"\r\n"ffmpeg.exe","9001","Console","1","12,004 K"\r\n`;
    expect(parseTasklist(csv)).toEqual([4120, 9001]);
    expect(parseTasklist("INFO: No tasks are running which match the specified criteria.\r\n")).toEqual([]);
  });

  it("reads pid/command line rows", () => {
    expect(parsePidCommandLines('12\t"C:\\mtx\\mediamtx.exe" C:\\mtx\\mediamtx.yml\r\n34\t\r\n')).toEqual([
      { pid: 12, cmd: '"C:\\mtx\\mediamtx.exe" C:\\mtx\\mediamtx.yml' },
      { pid: 34, cmd: "" },
    ]);
  });
});
