import "server-only";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { freemem, totalmem } from "node:os";
import { IS_WINDOWS } from "./config";
import { STATS_HISTORY } from "./shared";

export interface StatSample {
  ts: number;
  iface: string;
  /** bits per second */
  rxBps: number;
  txBps: number;
  memUsed: number;
  memTotal: number;
}

const INTERVAL_MS = 1000;

/** Interface carrying the default route, from the contents of /proc/net/route. */
export function parseDefaultIface(txt: string): string | null {
  let best: { iface: string; metric: number } | null = null;
  for (const line of txt.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 8 || f[1] !== "00000000") continue;
    const metric = Number(f[6]);
    if (!best || metric < best.metric) best = { iface: f[0], metric };
  }
  return best?.iface ?? null;
}

/** Byte counters for `iface`, from the contents of /proc/net/dev. */
export function parseNetDev(txt: string, iface: string): { rx: number; tx: number } | null {
  for (const line of txt.split("\n")) {
    const [name, rest] = line.split(":");
    if (name?.trim() !== iface || !rest) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    return { rx: f[0], tx: f[8] };
  }
  return null;
}

/** Total and used (total − available) bytes, from the contents of /proc/meminfo. */
export function parseMeminfo(txt: string) {
  const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(txt)?.[1] ?? 0) * 1024;
  const total = kb("MemTotal");
  return { total, used: total - kb("MemAvailable") };
}

/**
 * Byte counters summed over all adapters, from `netstat -e` on Windows: the first row with two
 * numbers is Bytes (its label is translated, so it isn't matched).
 */
export function parseNetstatE(txt: string): { rx: number; tx: number } | null {
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\D*?\s(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) return { rx: Number(m[1]), tx: Number(m[2]) };
  }
  return null;
}

const WINDOWS_IFACE = "all adapters";

async function sampleWindows() {
  const out = await new Promise<string>((resolve, reject) =>
    execFile("netstat", ["-e"], { timeout: 5000, windowsHide: true }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    ),
  );
  const total = totalmem();
  return { iface: WINDOWS_IFACE, net: parseNetstatE(out), mem: { total, used: total - freemem() } };
}

async function sampleLinux() {
  // Literal paths: a computed path makes Turbopack trace the whole project.
  const [route, dev, meminfo] = await Promise.all([
    readFile("/proc/net/route", "utf8"),
    readFile("/proc/net/dev", "utf8"),
    readFile("/proc/meminfo", "utf8"),
  ]);
  const iface = parseDefaultIface(route) ?? "lo";
  return { iface, net: parseNetDev(dev, iface), mem: parseMeminfo(meminfo) };
}

class StatsSampler extends EventEmitter {
  history: StatSample[] = [];
  private timer: NodeJS.Timeout | null = null;
  private prev: { ts: number; iface: string; rx: number; tx: number } | null = null;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  ensureRunning() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  private async tick() {
    try {
      const { iface, net, mem } = await (IS_WINDOWS ? sampleWindows() : sampleLinux());
      const now = Date.now();
      if (!net) return;
      const prev = this.prev;
      this.prev = { ts: now, iface, ...net };
      if (!prev || prev.iface !== iface) return;
      const dt = (now - prev.ts) / 1000;
      const sample: StatSample = {
        ts: now,
        iface,
        rxBps: Math.max(0, ((net.rx - prev.rx) * 8) / dt),
        txBps: Math.max(0, ((net.tx - prev.tx) * 8) / dt),
        memUsed: mem.used,
        memTotal: mem.total,
      };
      this.history.push(sample);
      if (this.history.length > STATS_HISTORY) this.history.shift();
      this.emit("sample", sample);
    } catch (e) {
      console.error("stats sample failed", e);
    }
  }
}

const g = globalThis as unknown as { __avStats?: StatsSampler };
export const stats = (g.__avStats ??= new StatsSampler());
