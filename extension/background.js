// Service worker: keeps the schedule fresh, the toolbar icon accurate, and
// sends the evening-before reminder.
//
// Storage:
//   sync  settings  {postcode, uprn, address, garden, remind, remindHour}
//   local cache     {uprn, schedule, fetchedAt, error, notifiedFor}

import { badgeText, describe, fetchSchedule, nextCollection, whenLabel } from "./lib.js";
import { iconImageData } from "./icons.js";

const REFRESH_MINUTES = 6 * 60;
const STALE_MS = REFRESH_MINUTES * 60 * 1000;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarms();
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?setup=1") });
  }
  await refresh();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  await refresh({ ifStale: true });
});

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === "refresh") await refresh();
  else await update(); // "tick" and "remind": no network, just re-evaluate
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refresh") {
    refresh().then(() => sendResponse({ ok: true }));
    return true; // keep the channel open for the async reply
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) refresh();
});

async function ensureAlarms() {
  await chrome.alarms.create("refresh", { periodInMinutes: REFRESH_MINUTES });
  // Hourly re-evaluation rolls the badge over at midnight and catches the
  // reminder if the exact alarm was missed while Chrome was closed.
  await chrome.alarms.create("tick", { periodInMinutes: 60 });
}

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return settings || null;
}

async function getCache() {
  const { cache } = await chrome.storage.local.get("cache");
  return cache || {};
}

/** Fetch the schedule from the council, then update the icon. */
async function refresh({ ifStale = false } = {}) {
  const settings = await getSettings();
  let cache = await getCache();

  if (settings?.uprn) {
    const sameHouse = cache.uprn === settings.uprn;
    const fresh = sameHouse && cache.fetchedAt && Date.now() - cache.fetchedAt < STALE_MS;
    if (!(ifStale && fresh)) {
      try {
        const schedule = await fetchSchedule(settings.uprn);
        cache = { ...cache, uprn: settings.uprn, schedule, fetchedAt: Date.now(), error: null };
      } catch (err) {
        // Keep the last good schedule for this house; just record the failure.
        cache = sameHouse
          ? { ...cache, error: String(err.message || err) }
          : { uprn: settings.uprn, error: String(err.message || err) };
      }
      await chrome.storage.local.set({ cache });
    }
  }
  await update();
}

/** Recompute the icon, badge, tooltip and reminder from cached data. */
async function update() {
  const settings = await getSettings();
  const cache = await getCache();
  const now = new Date();

  if (!settings?.uprn) {
    await setIcon([], "SET", "Bin Day: click to choose your address");
    return;
  }

  const next = cache.uprn === settings.uprn && cache.schedule
    ? nextCollection(cache.schedule, now, settings.garden)
    : null;

  if (!next) {
    const why = cache.error ? `couldn't reach the council (${cache.error})` : "no dates yet";
    await setIcon([], "?", `Bin Day: ${why}`);
    return;
  }

  const when = whenLabel(next.date, now);
  await setIcon(next.bins, badgeText(next.date, now), `Bin Day: ${describe(next.bins)} ${when}`);
  await scheduleReminder(settings, next, now);
  await maybeNotify(settings, cache, next, now);
}

async function setIcon(bins, badge, title) {
  await chrome.action.setIcon({ imageData: iconImageData(bins) });
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({ color: badge === "Now" ? "#b91c1c" : "#374151" });
  await chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
  await chrome.action.setTitle({ title });
}

/** Exact alarm for remindHour on the evening before the next collection. */
async function scheduleReminder(settings, next, now) {
  await chrome.alarms.clear("remind");
  if (!settings.remind) return;
  const [y, m, d] = next.date.split("-").map(Number);
  const at = new Date(y, m - 1, d - 1, settings.remindHour ?? 19, 0, 0);
  if (at > now) await chrome.alarms.create("remind", { when: at.getTime() });
}

/** Notify once per collection, any time from remindHour on the eve onwards. */
async function maybeNotify(settings, cache, next, now) {
  if (!settings.remind || cache.notifiedFor === next.date) return;
  const [y, m, d] = next.date.split("-").map(Number);
  const from = new Date(y, m - 1, d - 1, settings.remindHour ?? 19, 0, 0);
  const until = new Date(y, m - 1, d, 0, 0, 0);
  if (now < from || now >= until) return;

  await chrome.notifications.create(`bins-${next.date}`, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Bin night",
    message: `Put the ${describe(next.bins)} out tonight for tomorrow's collection.`,
    priority: 2,
  });
  await chrome.storage.local.set({ cache: { ...cache, notifiedFor: next.date } });
}
