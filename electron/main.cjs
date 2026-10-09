// AV Control as a desktop app: runs the panel's server (the standalone Next build) in a
// utility process and shows the panel in a window. The server keeps serving the LAN and the
// viewer port while the window is closed to the tray; Quit stops it, and MediaMTX with it.
//
// Settings are the usual AV_* environment variables. They can also go in an `av-control.env`
// file (KEY=value lines) next to the app or in its user-data folder, and a mediamtx/ffmpeg
// binary or mediamtx.yml placed next to the app is used when the variables don't say otherwise.

const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const WINDOWS = process.platform === "win32";
const ICON = path.join(__dirname, "icon.png");

/** The folder the user sees the app in: next to the portable .exe or the AppImage. */
function appDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);
  return app.isPackaged ? path.dirname(process.execPath) : process.cwd();
}

/** KEY=value lines; # comments and surrounding quotes allowed. */
function parseEnvFile(txt) {
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Fill in settings the environment doesn't already set. */
function loadSettings() {
  const loaded = [];
  for (const dir of [appDir(), app.getPath("userData")]) {
    const file = path.join(dir, "av-control.env");
    let txt;
    try {
      txt = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parseEnvFile(txt))) if (process.env[k] === undefined) process.env[k] = v;
    loaded.push(file);
  }
  const exe = WINDOWS ? ".exe" : "";
  for (const [key, name] of [
    ["AV_MEDIAMTX_BIN", `mediamtx${exe}`],
    ["AV_MEDIAMTX_CONFIG", "mediamtx.yml"],
    ["AV_FFMPEG_BIN", `ffmpeg${exe}`],
  ]) {
    const p = path.join(appDir(), name);
    // Only set when found: assigning undefined to process.env stores the string "undefined".
    if (process.env[key] === undefined && fs.existsSync(p)) process.env[key] = p;
  }
  return loaded;
}

const PORT = () => Number(process.env.PORT || 3000);
const VIEWER_PORT = () => Number(process.env.AV_VIEWER_PORT ?? 8080);
const panelUrl = (p = "/") => `http://127.0.0.1:${PORT()}${p}`;

function get(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(0));
  });
}

const panelAnswers = async () => (await get(panelUrl("/api/watch"))) === 200;

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "0.0.0.0", () => srv.close(() => resolve(true)));
  });
}

let server = null;
let win = null;
let tray = null;
let quitting = false;
let logFile = null;

function startServer() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", "server");
  const entry = path.join(dir, "server.js");
  if (!fs.existsSync(entry)) throw new Error(`The panel's server is missing (${entry}).`);

  // The portable .exe unpacks to a new temp folder on every start, so OBS gets a copy of the
  // live-bitrate script at a path that stays put. Refreshed each start to follow app updates.
  const script = path.join(dir, "obs", "av-live-bitrate.lua");
  if (process.env.AV_OBS_SCRIPT === undefined && fs.existsSync(script)) {
    const stable = path.join(app.getPath("userData"), "obs", "av-live-bitrate.lua");
    try {
      fs.mkdirSync(path.dirname(stable), { recursive: true });
      fs.copyFileSync(script, stable);
      process.env.AV_OBS_SCRIPT = stable;
    } catch {
      // Keep the bundled path; it works until the next start.
    }
  }

  const logs = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logs, { recursive: true });
  logFile = path.join(logs, "server.log");
  const log = fs.createWriteStream(logFile);

  server = utilityProcess.fork(path.join(__dirname, "server-host.cjs"), [], {
    cwd: dir,
    serviceName: "AV Control server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT()),
      // Linux shells set HOSTNAME to the machine name, which Next would bind to.
      HOSTNAME: "0.0.0.0",
      AV_SERVER_ENTRY: entry,
    },
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.once("exit", (code) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox("AV Control stopped", `The panel's server exited (code ${code}).\n\nIts log: ${logFile}`);
    app.quit();
  });
}

async function waitForPanel(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!server) return false;
    if (await panelAnswers()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const LOADING = `data:text/html;charset=utf-8,${encodeURIComponent(
  `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#a1a1aa;font:15px system-ui,sans-serif">Starting AV Control…</body></html>`,
)}`;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 380,
    title: "AV Control",
    icon: ICON,
    backgroundColor: "#0b0b0c",
    autoHideMenuBar: true,
    webPreferences: { autoplayPolicy: "no-user-gesture-required" },
  });
  win.loadURL(LOADING);
  // Links that open a new tab (the watch page, share links) go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(panelUrl()) || url.startsWith("data:")) return;
    e.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // Closing hides to the tray: viewers and other devices still rely on the server.
  win.on("close", (e) => {
    if (quitting || !tray) return;
    e.preventDefault();
    win.hide();
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    void win.loadURL(panelUrl());
  }
  win.show();
  win.focus();
}

function createTray(attached) {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  } catch {
    tray = null; // No tray on this desktop: closing the window quits.
    return;
  }
  tray.setToolTip("AV Control");
  const viewer = VIEWER_PORT();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open panel", click: showWindow },
      ...(viewer ? [{ label: "Open viewer page", click: () => shell.openExternal(`http://127.0.0.1:${viewer}/`) }] : []),
      ...(logFile ? [{ label: "Show server log", click: () => shell.showItemInFolder(logFile) }] : []),
      { type: "separator" },
      { label: attached ? "Quit" : "Quit (stops the stream server)", click: () => app.quit() },
    ]),
  );
  tray.on("click", showWindow);
}

async function main() {
  const settings = loadSettings();
  createWindow();

  // A panel already running on this machine (e.g. the systemd service): just show it.
  const attached = await panelAnswers();
  if (!attached) {
    if (!(await portFree(PORT()))) {
      dialog.showErrorBox("AV Control", `Port ${PORT()} is in use by another program. Set PORT in av-control.env to use another.`);
      return app.quit();
    }
    startServer();
    if (!(await waitForPanel(60_000))) {
      if (quitting) return;
      dialog.showErrorBox("AV Control", `The panel didn't start within a minute.\n\nIts log: ${logFile}`);
      return app.quit();
    }
  }
  createTray(attached);
  await win.loadURL(panelUrl());
  if (settings.length) console.log(`settings from ${settings.join(", ")}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("window-all-closed", () => {
    if (!tray) app.quit();
  });
  // Stop the server cleanly so it stops MediaMTX and FFmpeg too.
  app.on("before-quit", (e) => {
    quitting = true;
    if (!server) return;
    e.preventDefault();
    const child = server;
    const force = setTimeout(() => child.kill(), 5000);
    child.once("exit", () => {
      clearTimeout(force);
      app.quit();
    });
    child.postMessage("quit");
  });
  app.whenReady().then(main);
}
