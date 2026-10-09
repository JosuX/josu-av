// Build the self-contained Next.js server that the Electron app bundles. Standalone output
// leaves out public/ and .next/static, which server.js serves when they sit beside it.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const standalone = ".next/standalone";
rmSync(standalone, { recursive: true, force: true });

const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next");
const build = spawnSync(process.execPath, [nextCli, "build"], {
  stdio: "inherit",
  env: { ...process.env, AV_STANDALONE: "1" },
});
if (build.status !== 0) process.exit(build.status ?? 1);

cpSync(".next/static", `${standalone}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${standalone}/public`, { recursive: true });
console.log(`Standalone server ready in ${standalone}`);
