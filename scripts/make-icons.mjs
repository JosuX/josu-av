// Renders the app icon (electron/icon.svg, and electron/icon-small.svg for 16-32 px) into every
// file that uses it. Run after changing either SVG: `node scripts/make-icons.mjs`. Needs an
// installed Chrome or Edge, like the e2e tests (E2E_CHROMIUM overrides the browser).
//
//   electron/icon.png             512   window icon, Linux AppImage
//   electron/icon.ico      16-256       Windows .exe (electron-builder)
//   electron/tray.png, tray@2x.png      tray (16, 32)
//   src/app/favicon.ico    16-48        browsers
//   src/app/icon.svg                    browsers that take SVG favicons
//   src/app/apple-icon.png 180          iOS home screen (square: iOS rounds it)

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (f) => readFileSync(path.join(root, f), "utf8");
const big = read("electron/icon.svg");
const small = read("electron/icon-small.svg");
// Full-bleed tile for iOS, which applies its own mask and shows transparency as black.
const square = big.replace(/<rect id="bg"[^>]*\/>/, '<rect id="bg" width="512" height="512" fill="url(#tile)"/>');

const browser = await chromium.launch(
  process.env.E2E_CHROMIUM
    ? { executablePath: process.env.E2E_CHROMIUM }
    : { channel: process.platform === "win32" ? "msedge" : "chrome" },
);
const page = await browser.newPage();

/** PNG of `svg` at size×size, with a transparent background. */
async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${src}" width="${size}" height="${size}">`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

const pick = (size) => (size <= 32 ? small : big);

/** An .ico holding PNG images (Windows Vista and later), largest last. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); // no palette
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

async function icoOf(sizes) {
  const images = [];
  for (const size of sizes) images.push({ size, png: await render(pick(size), size) });
  return ico(images);
}

const out = (f, data) => {
  writeFileSync(path.join(root, f), data);
  console.log(`  ${f}`);
};

out("electron/icon.png", await render(big, 512));
out("electron/icon.ico", await icoOf([16, 24, 32, 48, 64, 128, 256]));
out("electron/tray.png", await render(small, 16));
out("electron/tray@2x.png", await render(small, 32));
out("src/app/favicon.ico", await icoOf([16, 32, 48]));
out("src/app/icon.svg", small);
out("src/app/apple-icon.png", await render(square, 180));

await browser.close();
