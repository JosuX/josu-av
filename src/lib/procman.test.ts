import { afterEach, describe, expect, it } from "vitest";
import type { ProcSpec } from "./config";
import { ManagedProcess, splitLines, type ProcState } from "./procman";

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

/** A spec that runs `script` in Node, which works the same on every platform (unlike sh). */
function node(script: string, over: Partial<ProcSpec> = {}): ProcSpec {
  return {
    name: "ffmpeg",
    label: "test",
    shortLabel: "test",
    description: "",
    bin: process.execPath,
    args: ["-e", script],
    stopSignal: "SIGTERM",
    autoRestart: false,
    externalPattern: "^$",
    windowsExternal: { image: "av-test.exe" },
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
    const p = make(node('console.log("hello"); console.error("oops")'));
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
    const p = make(node("process.exit(3)"));
    p.start();
    await waitFor(p, "crashed");
    expect(p.exitCode).toBe(3);
  });

  it("restarts on exit when autoRestart is set", async () => {
    const p = make(node("process.exit(1)", { autoRestart: true }), 50);
    p.start();
    await waitFor(p, "restarting");
    await waitFor(p, "running");
    expect(p.restarts).toBeGreaterThanOrEqual(1);
  });

  it("stops a running process with its stop signal", async () => {
    const p = make(node("setTimeout(() => {}, 30_000)"));
    p.start();
    await waitFor(p, "running");
    await p.stop();
    expect(p.state).toBe("stopped");
    expect(p.exitSignal).toBe("SIGTERM");
  });
});

describe("ManagedProcess watchdog", () => {
  const procs: ManagedProcess[] = [];
  afterEach(async () => {
    await Promise.all(procs.splice(0).map((p) => p.stop()));
  });

  it("gives up after too many crashes in a row", async () => {
    const p = new ManagedProcess(node("process.exit(1)", { autoRestart: true, watchdog: { maxDelayMs: 40, giveUpAfter: 2 } }), 10);
    procs.push(p);
    p.start();
    await waitFor(p, "crashed");
    expect(p.restarts).toBe(2);
    expect(p.note).toMatch(/crashed 3 times in a row/);
  });

  it("backs off between restarts", async () => {
    const p = new ManagedProcess(node("process.exit(1)", { autoRestart: true, watchdog: { maxDelayMs: 1000, giveUpAfter: 5 } }), 10);
    procs.push(p);
    const delays: string[] = [];
    p.on("line", (l: { text: string }) => {
      const m = /restarting in (\S+)s/.exec(l.text);
      if (m) delays.push(m[1]);
    });
    p.start();
    await waitFor(p, "crashed");
    expect(delays).toEqual(["0.01", "0.02", "0.04", "0.08", "0.16"]);
  });

  it("does not restart a binary that cannot be started", async () => {
    const p = new ManagedProcess({ ...node("", { autoRestart: true }), bin: "/nonexistent/av-test-bin" }, 10);
    procs.push(p);
    p.start();
    await waitFor(p, "crashed");
    expect(p.restarts).toBe(0);
    expect(p.note).toMatch(/could not be started/);
  });
});
