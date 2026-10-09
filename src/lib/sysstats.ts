import "server-only";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
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
 * Received and sent byte totals across all interfaces, from `netstat -e` (Windows). The
 * "Bytes" label is localised, so take the first row that is a label followed by two numbers.
 */
export function parseNetstatE(txt: string): { rx: number; tx: number } | null {
  const m = /^\s*\S[^\d\r\n]*?\s+(\d+)\s+(\d+)\s*$/m.exec(txt);
  return m ? { rx: Number(m[1]), tx: Number(m[2]) } : null;
}

interface Reading {
  iface: string;
  net: { rx: number; tx: number } | null;
  mem: { total: number; used: number };
}

async function readLinux(): Promise<Reading> {
  // Literal paths: a computed path makes Turbopack trace the whole project.
  const [route, dev, meminfo] = await Promise.all([
    readFile("/proc/net/route", "utf8"),
    readFile("/proc/net/dev", "utf8"),
    readFile("/proc/meminfo", "utf8"),
  ]);
  const iface = parseDefaultIface(route) ?? "lo";
  return { iface, net: parseNetDev(dev, iface), mem: parseMeminfo(meminfo) };
}

async function readWindows(): Promise<Reading> {
  const out = await new Promise<string>((resolve, reject) => {
    execFile("netstat", ["-e"], { windowsHide: true, timeout: 5000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
  // os.freemem() is the "available" figure on Windows, matching MemAvailable on Linux.
  const total = os.totalmem();
  return { iface: "all", net: parseNetstatE(out), mem: { total, used: total - os.freemem() } };
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
      const { iface, net, mem } = await (process.platform === "win32" ? readWindows() : readLinux());
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
