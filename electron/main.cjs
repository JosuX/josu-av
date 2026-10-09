// Desktop shell for AV Control. Runs the Next.js standalone server (which in turn supervises
// MediaMTX and FFmpeg) as a child of this app and shows the panel in a window. The server
// still listens on 0.0.0.0 so phones and tablets on the LAN can use it while the app is open.

const { app, BrowserWindow, dialog, shell } = require("electron");
const { fork, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.AV_PORT ?? 3000);
const HOST = process.env.AV_HOST ?? "0.0.0.0";
const URL = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 60_000;

/** @type {import("node:child_process").ChildProcess | null} */
let server = null;
let quitting = false;
let logStream = null;

function serverDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "server")
    : path.join(__dirname, "..", ".next", "standalone");
}

function log(text) {
  logStream?.write(text);
}

function startServer() {
  const dir = serverDir();
  const entry = path.join(dir, "server.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`Server not found at ${entry}. Run "pnpm electron:build" (or build:standalone) first.`);
  }
  const logFile = path.join(app.getPath("userData"), "server.log");
  logStream = fs.createWriteStream(logFile, { flags: "w" });

  server = fork(entry, [], {
    cwd: dir,
    env: {
      ...process.env,
      // Run this executable as plain Node for the server.
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: HOST,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  server.stdout.on("data", (c) => log(c));
  server.stderr.on("data", (c) => log(c));
  server.once("exit", (code, signal) => {
    log(`\n[server exited: ${signal ?? code}]\n`);
    server = null;
    if (quitting) return;
    dialog.showErrorBox(
      "AV Control server stopped",
      `The panel's server exited (${signal ?? `code ${code}`}).\n\n${tail(logFile)}\n\nFull log: ${logFile}`,
    );
    app.quit();
  });
}

function tail(file, lines = 15) {
  try {
    return fs.readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Stop the server and everything it spawned (MediaMTX, FFmpeg). */
function stopServer() {
  if (!server?.pid) return;
  const pid = server.pid;
  if (process.platform === "win32") {
    // Windows has no signals to forward; end the whole tree so no child is left orphaned.
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Already gone.
    }
  } else {
    server.kill("SIGTERM");
  }
}

function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (!server) return reject(new Error("server exited during startup"));
      const req = http.get(URL, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(2000, () => req.destroy());
      req.once("error", () => {
        if (Date.now() > deadline) reject(new Error(`server did not answer on ${URL} within 60s`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "AV Control",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // The live feed should start with sound without a click.
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  // Keep the app on the panel; open anything else (e.g. the MediaMTX player link) in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.once("ready-to-show", () => win.show());
  await win.loadURL(URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      startServer();
      await waitForServer();
      await createWindow();
    } catch (e) {
      if (quitting) return;
      dialog.showErrorBox("AV Control failed to start", String(e?.message ?? e));
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });
}
