export function formatBits(bps: number): string {
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let i = 0;
  while (bps >= 1000 && i < units.length - 1) {
    bps /= 1000;
    i++;
  }
  return `${bps < 10 && i > 0 ? bps.toFixed(1) : Math.round(bps)}\u00a0${units[i]}`;
}

export function formatBytes(b: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i >= 3 ? 1 : 0)}\u00a0${units[i]}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

/** e.g. "iPad · Safari", to tell viewers apart on the dashboard. */
export function deviceLabel(ua: string) {
  const device =
    [/iPad/, /iPhone/, /Android/, /Mac OS X/, /Windows/, /CrOS/, /Linux/]
      .find((re) => re.test(ua))
      ?.source.replace("Mac OS X", "Mac")
      .replace("CrOS", "Chromebook") ?? "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "browser";
  return `${device} · ${browser}`;
}
