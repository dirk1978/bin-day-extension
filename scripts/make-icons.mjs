// Renders the static PNG icons (manifest, notifications, Web Store) from the
// same drawBin() the extension uses at runtime, so they always match.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright CHROME=/path/to/chrome node scripts/make-icons.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const root = new URL("../extension/", import.meta.url);
const lib = readFileSync(new URL("lib.js", root), "utf8");
const icons = readFileSync(new URL("icons.js", root), "utf8");

// Inline both modules into one classic script: file:// blocks module imports.
const source = [lib, icons]
  .join("\n")
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "");

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage();
await page.setContent("<!doctype html><body></body>");
await page.addScriptTag({ content: `${source}\nwindow.drawBin = drawBin;` });

for (const size of [16, 32, 48, 128]) {
  const dataUrl = await page.evaluate((size) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    window.drawBin(canvas.getContext("2d"), size, ["Green", "Grey", "Brown"]);
    return canvas.toDataURL("image/png");
  }, size);
  const file = new URL(`icons/icon-${size}.png`, root);
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(`wrote ${file.pathname}`);
}

await browser.close();
