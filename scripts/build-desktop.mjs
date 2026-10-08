// Builds the desktop app (electron/): a standalone Next build of the panel, flattened so it
// runs from any folder, plus the Electron shell, packaged with electron-builder.
//
//   node scripts/build-desktop.mjs --stage-only     build/desktop only (run: electron build/desktop/app)
//   node scripts/build-desktop.mjs --win portable   dist/AV-Control-<version>-portable.exe
//   node scripts/build-desktop.mjs --linux AppImage
//
// --win/--linux and the targets after them go to electron-builder.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "build", "desktop");
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** sharp only serves next/image, which the panel doesn't use, and its binaries are per-platform. */
const SKIP = /^(sharp|detect-libc|@img\/.*)$/;

const version = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version ?? "0";
const newer = (a, b) => a.localeCompare(b, undefined, { numeric: true }) > 0;

/**
 * pnpm's standalone node_modules is a tree of symlinks into .pnpm, which doesn't survive
 * packaging. Copy every package to the top level instead, the newest version where two differ.
 */
function hoist(fromModules, toModules) {
  const store = path.join(fromModules, ".pnpm");
  const found = new Map();
  for (const entry of readdirSync(store)) {
    const mods = path.join(store, entry, "node_modules");
    if (!existsSync(mods)) continue;
    for (const name of readdirSync(mods)) {
      const names = name.startsWith("@") ? readdirSync(path.join(mods, name)).map((n) => `${name}/${n}`) : [name];
      for (const n of names) {
        const dir = path.join(mods, n);
        if (SKIP.test(n) || lstatSync(dir).isSymbolicLink()) continue;
        const prev = found.get(n);
        if (!prev || newer(version(dir), version(prev))) found.set(n, dir);
      }
    }
  }
  for (const [name, dir] of found) cpSync(dir, path.join(toModules, name), { recursive: true, dereference: true });
  return found.size;
}

const stageOnly = process.argv.includes("--stage-only");

/** `--win portable --linux AppImage` → { win: ["portable"], linux: ["AppImage"] }. */
function targets(argv) {
  const out = {};
  let platform = null;
  for (const a of argv) {
    if (["--win", "--linux", "--mac"].includes(a)) out[(platform = a.slice(2))] = [];
    else if (platform && !a.startsWith("-")) out[platform].push(a);
  }
  return out;
}

console.log("› next build (standalone)");
run(require.resolve("next/dist/bin/next"), ["build"], { AV_STANDALONE: "1" });

console.log("› staging build/desktop");
rmSync(out, { recursive: true, force: true });
const standalone = path.join(root, ".next", "standalone");
const server = path.join(out, "server");
cpSync(standalone, server, {
  recursive: true,
  dereference: true,
  filter: (src) => src !== path.join(standalone, "node_modules") && src !== path.join(standalone, "src"),
});
const count = hoist(path.join(standalone, "node_modules"), path.join(server, "node_modules"));
cpSync(path.join(root, ".next", "static"), path.join(server, ".next", "static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(server, "public"), { recursive: true });
cpSync(path.join(root, "obs"), path.join(server, "obs"), { recursive: true });
console.log(`  server: ${count} packages`);

const appDir = path.join(out, "app");
mkdirSync(appDir, { recursive: true });
for (const f of ["main.cjs", "server-host.cjs", "icon.png"]) cpSync(path.join(root, "electron", f), path.join(appDir, f));
writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    {
      name: "av-control",
      productName: "AV Control",
      version: pkg.version,
      description: "Control panel for the assembly stream",
      author: "AV Control",
      main: "main.cjs",
      // Window class on Linux, so the desktop links windows to the launcher entry.
      desktopName: "av-control.desktop",
    },
    null,
    2,
  ),
);

if (stageOnly) process.exit(0);

// Package a copy of the app from the temp folder: from inside this project electron-builder
// finds the workspace and packs its node_modules (React, Next, ...), which the server already
// carries. The server goes in after packing, as electron-builder drops node_modules from
// extra resources.
const packDir = path.join(tmpdir(), "av-control-desktop-app");
rmSync(packDir, { recursive: true, force: true });
cpSync(appDir, packDir, { recursive: true });

const { build } = require("electron-builder");
await build({
  projectDir: packDir,
  ...targets(process.argv.slice(2)),
  config: {
    appId: "local.avcontrol.panel",
    productName: "AV Control",
    electronVersion: JSON.parse(readFileSync(require.resolve("electron/package.json"), "utf8")).version,
    directories: { output: path.join(root, "dist"), buildResources: path.join(root, "electron") },
    asar: true,
    npmRebuild: false,
    afterPack: async ({ appOutDir }) => {
      cpSync(server, path.join(appOutDir, "resources", "server"), { recursive: true });
    },
    win: { target: "portable", icon: path.join(root, "electron", "icon.ico") },
    portable: { artifactName: "AV-Control-${version}-portable.exe" },
    linux: { target: "AppImage", icon: path.join(root, "electron", "icon.png"), category: "AudioVideo" },
    appImage: { artifactName: "AV-Control-${version}.${ext}" },
  },
});
