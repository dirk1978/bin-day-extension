// End-to-end check against the LIVE council site: loads the unpacked
// extension into Chromium, runs setup for a postcode, and checks the toolbar
// state the service worker produces. Screenshots go to ./dist/.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright CHROME=/path/to/chrome \
//     node scripts/e2e.mjs [POSTCODE] [HOUSE-NUMBER] [none|yes|Green|Grey]
//
// "yes" ticks garden waste and takes the council's round; Green/Grey also pick
// that fallback when the street isn't in the council's list.

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const [postcode = "DY9 0LU", house = "3", garden = "yes"] = process.argv.slice(2);
const extension = fileURLToPath(new URL("../extension/", import.meta.url));
const out = fileURLToPath(new URL("../dist/", import.meta.url));
mkdirSync(out, { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "binday-")), {
  executablePath: process.env.CHROME || undefined,
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  console.log(`extension id ${id}`);

  // First install opens the setup tab by itself.
  const setup = context.pages().find((p) => p.url().includes("popup.html"))
    || (await context.waitForEvent("page", { predicate: (p) => p.url().includes("popup.html") }));
  await setup.waitForSelector("#postcode");
  console.log("badge before setup:", await worker.evaluate(() => chrome.action.getBadgeText({})));

  await setup.fill("#postcode", postcode);
  await setup.click("#find");
  await setup
    .waitForSelector("#settings-form:not([hidden])", { timeout: 30000 })
    .catch(async (err) => {
      await setup.screenshot({ path: join(out, "setup-failed.png") });
      throw new Error(`address lookup failed: ${await setup.textContent("#setup-error")}`, { cause: err });
    });
  const options = await setup.$$eval("#address option", (os) => os.map((o) => o.textContent));
  console.log(`${options.length} addresses, first: ${options.slice(0, 3).join(" | ")}`);
  const match = await setup.$$eval(
    "#address option",
    (os, house) => os.find((o) => o.textContent.startsWith(`${house} `))?.value,
    house,
  );
  await setup.selectOption("#address", match);
  if (garden !== "none") {
    await setup.check("#has-garden");
    await setup.waitForSelector("input[name=garden-round]");
    console.log("garden:", await setup.textContent("#garden-found"));
    const choices = await setup.$$eval("#garden-choices label", (ls) => ls.map((l) => l.textContent.trim()));
    console.log("garden choices:", choices.join(" | "));
    if (garden === "Green" || garden === "Grey") {
      // Only offered when the street isn't in the council's list.
      const fallback = setup.locator(`input[name=garden-round][value*='"${garden}"']`);
      if (await fallback.count()) await fallback.check();
    }
  }
  await setup.screenshot({ path: join(out, "setup.png") });
  await setup.click("#settings-form button[type=submit]");

  await setup.waitForFunction(() => {
    const t = document.getElementById("hero-text")?.textContent || "";
    return t && !t.includes("Fetching");
  }, null, { timeout: 30000 });
  console.log("hero:", await setup.textContent("#hero-when"), "/", await setup.textContent("#hero-text"), "/", await setup.textContent("#hero-date"));
  console.log("upcoming:", (await setup.$$eval("#upcoming li", (ls) => ls.map((l) => l.textContent.trim()))).join(" | "));
  await setup.screenshot({ path: join(out, "tab-after-save.png") });

  // Toolbar state, as the service worker set it.
  await setup.waitForTimeout(500);
  const state = await worker.evaluate(async () => ({
    badge: await chrome.action.getBadgeText({}),
    title: await chrome.action.getTitle({}),
    alarms: (await chrome.alarms.getAll()).map((a) => `${a.name}@${new Date(a.scheduledTime).toString()}`),
  }));
  console.log("toolbar:", JSON.stringify(state, null, 2));

  // The popup as it renders from the toolbar (narrow, not the setup tab).
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 520 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForSelector("#view-main:not([hidden]) #hero-text");
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: join(out, "popup.png") });
  console.log(`screenshots in ${out}`);

  // Reminder: pretend 7pm is midnight so we're inside the "evening before"
  // window now, and check the notification is raised exactly once.
  const notified = await worker.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({ settings: { ...settings, remindHour: 0 } });
    await new Promise((r) => setTimeout(r, 3000));
    const { cache } = await chrome.storage.local.get("cache");
    return { notifiedFor: cache.notifiedFor || null, ids: Object.keys(await chrome.notifications.getAll()) };
  });
  console.log("reminder:", JSON.stringify(notified));
} finally {
  await context.close();
}
