import {
  collectionState,
  daysUntil,
  describe,
  describeRound,
  fetchGardenStreets,
  findAddresses,
  gardenRoundsFor,
  normalisePostcode,
  parseIso,
  resolveGardenRound,
  upcoming,
} from "./lib.js";
import { drawBin, drawVan } from "./icons.js";

const $ = (id) => document.getElementById(id);
const asTab = new URLSearchParams(location.search).has("setup");
if (asTab) document.body.classList.add("tab");

let settings = null;
// The council's garden waste street table: fetched alongside the address
// search, null until then, [] if it couldn't be loaded.
let gardenRows = null;

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
  const round = ready ? resolveGardenRound(cache.schedule, settings.garden) : null;
  $("garden-line").hidden = !round;
  $("garden-line").textContent = round ? `Brown bin: ${describeRound(round)}` : "";
  $("error").hidden = !cache.error || cache.uprn !== settings.uprn;
  $("error").textContent = ready
    ? `Couldn't update from the council just now, so these are the last dates fetched. (${cache.error})`
    : `Couldn't reach the council's bin site: ${cache.error}`;
  $("updated").textContent = cache.fetchedAt && ready
    ? `Updated ${new Date(cache.fetchedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
    : "";

  const { collected } = ready
    ? collectionState(cache.schedule, today, settings.garden)
    : { collected: null };
  const [next, ...rest] = collected ? list.slice(1) : list;

  if (collected) {
    $("hero-when").textContent = "Done for today";
    $("hero-text").textContent = "The van's been";
    $("hero-date").textContent = next
      ? `Next: ${describe(next.bins)}, ${longDay(next.date)}`
      : `Today's ${describe(collected.bins)} collected`;
    drawVan($("hero-icon").getContext("2d"), $("hero-icon").width);
    renderUpcoming(rest);
    return;
  }

  if (!next) {
    $("hero-when").textContent = "";
    $("hero-text").textContent = cache.error ? "No dates available" : "Fetching dates…";
    $("hero-date").textContent = "";
    paint($("hero-icon"), []);
    $("upcoming").replaceChildren();
    return;
  }

  const days = daysUntil(next.date, today);
  const longDate = longDay(next.date);
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
  renderUpcoming(rest);
}

function renderUpcoming(rest) {
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
    $("has-garden").checked = Boolean(settings.garden && settings.garden !== "none");
  }
  $("postcode").focus();
}

$("postcode-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  setupError("");
  $("find").disabled = true;
  $("find").textContent = "Finding…";
  try {
    const [addresses, rows] = await Promise.all([
      findAddresses($("postcode").value),
      fetchGardenStreets().catch(() => []),
    ]);
    gardenRows = rows;
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
    renderGarden();
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
    garden: chosenGarden(),
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
$("has-garden").addEventListener("change", () => renderGarden());
$("address").addEventListener("change", () => renderGarden());

/**
 * Garden waste choices for the selected address. The council's street table
 * gives the brown bin's day and calendar; only if the street isn't in it do we
 * fall back to asking which bin it goes out with.
 */
function renderGarden() {
  const on = $("has-garden").checked;
  $("garden-detail").hidden = !on;
  if (!on) return;

  const address = $("address").selectedOptions[0]?.dataset.address || "";
  const rounds = gardenRoundsFor(gardenRows || [], $("postcode").value, address);
  const saved = settings?.garden;
  let choices;

  if (rounds.length) {
    $("garden-found").textContent = rounds.length === 1
      ? "From the council's garden waste list, your brown bin is collected on:"
      : "The council lists more than one garden waste round for this postcode. Choose yours:";
    choices = rounds.map((r) => ({
      label: describeRound(r),
      value: { calendar: r.calendar, day: r.day },
    }));
  } else {
    $("garden-found").textContent = gardenRows?.length
      ? "Your street isn't in the council's garden waste list. Which bin does your brown bin go out with?"
      : "Couldn't load the council's garden waste list. Which bin does your brown bin go out with?";
    choices = ["Green", "Grey"].map((c) => ({ label: `With my ${c} bin`, value: { pairWith: c } }));
  }

  const savedKey = JSON.stringify(typeof saved === "string" ? { pairWith: saved } : saved);
  const hasSaved = choices.some((c) => JSON.stringify(c.value) === savedKey);
  $("garden-choices").replaceChildren(
    ...choices.map((choice, i) => {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "garden-round";
      input.value = JSON.stringify(choice.value);
      input.checked = hasSaved ? input.value === savedKey : i === 0;
      label.append(input, ` ${choice.label}`);
      return label;
    }),
  );
}

function chosenGarden() {
  if (!$("has-garden").checked) return "none";
  const picked = document.querySelector("input[name=garden-round]:checked");
  return picked ? JSON.parse(picked.value) : "none";
}

function setupError(message) {
  $("setup-error").hidden = !message;
  $("setup-error").textContent = message;
}

// ---------- Helpers ----------

function paint(canvas, bins) {
  drawBin(canvas.getContext("2d"), canvas.width, bins);
}

/** "2026-10-09" -> "Friday 9 October". */
function longDay(isoDay) {
  return parseIso(isoDay).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "3 WILLOW CLOSE" -> "3 Willow Close". */
function titleCase(text = "") {
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
