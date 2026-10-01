import {
  daysUntil,
  describe,
  findAddresses,
  normalisePostcode,
  parseIso,
  upcoming,
} from "./lib.js";
import { drawBin } from "./icons.js";

const $ = (id) => document.getElementById(id);
const asTab = new URLSearchParams(location.search).has("setup");
if (asTab) document.body.classList.add("tab");

let settings = null;

init();

async function init() {
  ({ settings } = await chrome.storage.sync.get("settings"));
  if (settings?.uprn && !asTab) showMain();
  else showSetup();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.cache && !$("view-main").hidden) renderMain();
  });
}

// ---------- Main view ----------

async function showMain() {
  $("view-setup").hidden = true;
  $("view-main").hidden = false;
  await renderMain();
}

async function renderMain() {
  const { cache = {} } = await chrome.storage.local.get("cache");
  const today = new Date();
  const ready = cache.uprn === settings.uprn && cache.schedule;
  const list = ready ? upcoming(cache.schedule, today, settings.garden) : [];

  $("address-line").textContent = `${titleCase(settings.address)}, ${settings.postcode}`;
  $("error").hidden = !cache.error || cache.uprn !== settings.uprn;
  $("error").textContent = ready
    ? `Couldn't update from the council just now, so these are the last dates fetched. (${cache.error})`
    : `Couldn't reach the council's bin site: ${cache.error}`;
  $("updated").textContent = cache.fetchedAt && ready
    ? `Updated ${new Date(cache.fetchedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
    : "";

  const [next, ...rest] = list;
  if (!next) {
    $("hero-when").textContent = "";
    $("hero-text").textContent = cache.error ? "No dates available" : "Fetching dates…";
    $("hero-date").textContent = "";
    paint($("hero-icon"), []);
    $("upcoming").replaceChildren();
    return;
  }

  const days = daysUntil(next.date, today);
  const longDate = parseIso(next.date).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
  if (days === 1) {
    $("hero-when").textContent = "Tonight";
    $("hero-text").textContent = `Put out the ${describe(next.bins)}`;
    $("hero-date").textContent = `For tomorrow, ${longDate}`;
  } else if (days === 0) {
    $("hero-when").textContent = "Today";
    $("hero-text").textContent = capitalise(describe(next.bins));
    $("hero-date").textContent = longDate;
  } else {
    $("hero-when").textContent = "Next collection";
    $("hero-text").textContent = capitalise(describe(next.bins));
    $("hero-date").textContent = longDate;
  }
  paint($("hero-icon"), next.bins);

  $("upcoming").replaceChildren(
    ...rest.slice(0, 6).map(({ date, bins }) => {
      const li = document.createElement("li");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 48;
      paint(canvas, bins);
      const when = document.createElement("span");
      when.className = "date";
      when.textContent = parseIso(date).toLocaleDateString("en-GB", {
        weekday: "short", day: "numeric", month: "short",
      });
      const what = document.createElement("span");
      what.textContent = bins.join(" + ");
      li.append(canvas, when, what);
      return li;
    }),
  );
}

$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  $("refresh").textContent = "Refreshing…";
  try {
    await chrome.runtime.sendMessage({ type: "refresh" });
    await renderMain();
  } finally {
    $("refresh").disabled = false;
    $("refresh").textContent = "Refresh";
  }
});

$("change").addEventListener("click", () => showSetup());

// ---------- Setup view ----------

function showSetup() {
  $("view-main").hidden = true;
  $("view-setup").hidden = false;
  $("cancel").hidden = !settings?.uprn || asTab;
  if (settings) {
    $("postcode").value = settings.postcode || "";
    $("remind").checked = settings.remind !== false;
    const garden = document.querySelector(`input[name=garden][value="${settings.garden || "none"}"]`);
    if (garden) garden.checked = true;
  }
  $("postcode").focus();
}

$("postcode-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setupError("");
  $("find").disabled = true;
  $("find").textContent = "Finding…";
  try {
    const addresses = await findAddresses($("postcode").value);
    $("postcode").value = normalisePostcode($("postcode").value);
    const select = $("address");
    select.replaceChildren(
      ...addresses.map(({ uprn, address }) => {
        const option = new Option(titleCase(address), uprn);
        option.dataset.address = address;
        return option;
      }),
    );
    if (settings?.uprn) select.value = settings.uprn;
    $("settings-form").hidden = false;
    select.focus();
  } catch (err) {
    $("settings-form").hidden = true;
    setupError(err.message || String(err));
  } finally {
    $("find").disabled = false;
    $("find").textContent = "Find";
  }
});

$("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const option = $("address").selectedOptions[0];
  if (!option) return;
  settings = {
    postcode: normalisePostcode($("postcode").value),
    uprn: option.value,
    address: option.dataset.address,
    garden: document.querySelector("input[name=garden]:checked").value,
    remind: $("remind").checked,
    remindHour: 19,
  };
  // The service worker sees this change and fetches the new schedule; the
  // cache listener above re-renders when it lands.
  await chrome.storage.sync.set({ settings });
  $("tip").hidden = !asTab;
  showMain();
});

$("cancel").addEventListener("click", () => showMain());

function setupError(message) {
  $("setup-error").hidden = !message;
  $("setup-error").textContent = message;
}

// ---------- Helpers ----------

function paint(canvas, bins) {
  drawBin(canvas.getContext("2d"), canvas.width, bins);
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "3 WILLOW CLOSE" -> "3 Willow Close". */
function titleCase(text = "") {
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
