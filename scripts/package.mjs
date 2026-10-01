// Builds dist/bin-day-<version>.zip from extension/: the file you hand to
// friends (unzip, then "Load unpacked") or upload to the Chrome Web Store.

import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}extension/manifest.json`, "utf8"));
const zip = `${root}dist/bin-day-${version}.zip`;

mkdirSync(`${root}dist`, { recursive: true });
rmSync(zip, { force: true });
execFileSync("zip", ["-r", "-X", zip, "."], { cwd: `${root}extension`, stdio: "inherit" });
console.log(`\nwrote ${zip}`);
