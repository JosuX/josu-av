import "server-only";
import { execFile } from "node:child_process";

// Windows stand-ins for pgrep: Windows has none, and no /proc to read command lines from.

function run(bin: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true }, (_err, stdout) => resolve(stdout ?? ""));
  });
}

/** PIDs of `image` in `tasklist /FO CSV /NH` output. */
export function parseTasklist(csv: string, image: string): number[] {
  const pids: number[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m && m[1].toLowerCase() === image.toLowerCase()) pids.push(Number(m[2]));
  }
  return pids;
}

/** PIDs from "<pid> <command line>" lines whose command line matches `cmdline`. */
export function parsePidCommandLines(txt: string, cmdline: RegExp): number[] {
  const pids: number[] = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = /^(\d+) ?(.*)$/.exec(line.trim());
    if (m && cmdline.test(m[2])) pids.push(Number(m[1]));
  }
  return pids;
}

/**
 * PIDs of running processes whose executable is `image` (e.g. "mediamtx.exe") and, when given,
 * whose command line matches `cmdline`. Command lines need PowerShell, which takes about half
 * a second to start, so the fast tasklist is used when the name is enough.
 */
export async function findWindowsProcesses(image: string, cmdline?: RegExp): Promise<number[]> {
  if (!cmdline) return parseTasklist(await run("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/FO", "CSV", "/NH"]), image);
  const script =
    `Get-CimInstance Win32_Process | Where-Object Name -eq '${image.replace(/'/g, "''")}' | ` +
    `ForEach-Object { [string]$_.ProcessId + ' ' + $_.CommandLine }`;
  // -EncodedCommand sidesteps quoting the script through cmd-style argument parsing.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
  return parsePidCommandLines(out, cmdline);
}
