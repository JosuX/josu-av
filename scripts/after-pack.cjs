// electron-builder hook: copy the Next.js standalone server into resources/server. Done here
// rather than with extraResources, which always leaves out node_modules (and the server needs
// its traced modules).
const { cpSync, existsSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, ".next", "standalone");
  if (!existsSync(path.join(src, "server.js"))) {
    throw new Error(`${src} has no server.js; run "pnpm build:standalone" first`);
  }
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  cpSync(src, path.join(resources, "server"), { recursive: true });
};
